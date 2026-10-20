const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {fixtures, chat, sql, literal, enrollment} = require('./support.cjs');
const {conclusion} = require('./evaluate.cjs');

// Read only, against the application's memory database, distinct from ragent_bit.
function memories(user) {
  assert(/^\d+$/.test(user.userId));
  const output = execFileSync('docker', ['exec', '-i', process.env.CAMPUS_PG_CONTAINER || 'ragent-postgres',
    'psql', '-U', 'postgres', '-d', 'ragent', '-v', 'ON_ERROR_STOP=1', '-qAt'], {
    input: `SELECT coalesce(json_agg(row_to_json(m)), '[]'::json) FROM
      (SELECT id,content,invalid_at,superseded_by FROM t_agent_memory WHERE user_id=${literal(user.userId)} ORDER BY create_time,id) m;`,
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

function active(rows) { return rows.filter(row => row.invalid_at == null); }
function includesWords(text, words) { return words.every(word => text.includes(word)); }
function flushSucceeded(output) {
  return output.completed.some(tool => tool.name === 'flush_memory' && tool.ok === true);
}
function decision(output) {
  const tool = output.completed.find(tool => tool.name === 'check_course_eligibility' && tool.ok === true);
  return tool ? JSON.parse(tool.result) : null;
}

async function run() {
  const context = await fixtures({browserOnly: true});
  const user = context.users.sophomore;
  const other = context.users.retake;
  const first = ['无人机', '森林巡检'];
  const second = ['数据库内核', '时序数据压缩'];
  const results = [];
  const conversations = new Set();
  let originalMemoryIds = [];
  const filename = path.join(context.directory, 'memory-report.json');
  const save = () => fs.writeFileSync(filename, JSON.stringify({
    runId: context.runId, model: 'existing configured DeepSeek model',
    methodology: '每轮创建独立会话；事先固定断言；同时检查真实工具结果、最终回答及 PostgreSQL 生效记忆。仅修改本次测试账号。',
    scope: '跨会话长期记忆；不覆盖短期上下文压缩、容量淘汰及高并发。',
    passed: results.filter(row => row.passed).length, total: 9, results
  }, null, 2));
  async function check(id, account, question, verify) {
    let row;
    try {
      const output = await chat(account, question, context.directory, id);
      const snapshot = memories(account);
      const checks = {
        normal: output.finish?.messageStatus === 'NORMAL' && !output.errored,
        newConversation: Boolean(output.conversationId) && !conversations.has(output.conversationId),
        noBusinessWrite: !output.events.some(event => event.eventType === 'confirm') &&
          !output.completed.some(tool => ['enroll_course', 'register_course_retake', 'apply_student_leave'].includes(tool.name)),
        ...verify(output, snapshot)
      };
      conversations.add(output.conversationId);
      row = {id, question, checks, passed: Object.values(checks).every(Boolean),
        conversationId: output.conversationId, answer: output.answer, memories: snapshot,
        completedTools: output.completed.map(tool => tool.name), elapsedMs: output.elapsedMs};
    } catch (error) {
      row = {id, question, passed: false, error: error.message};
    }
    results.push(row);
    save();
    console.log(`[memory] ${row.passed ? 'PASS' : 'FAIL'} ${id}: ${JSON.stringify(row.checks || row.error)}`);
  }
  await check('M01-remember', user,
    '我长期想修的方向是人工智能中的无人机森林巡检。请记住我的这个学习方向，今后选课时可以参考。',
    (out, rows) => {
      originalMemoryIds = active(rows).filter(row => includesWords(row.content, first)).map(row => row.id);
      return {flushed: flushSucceeded(out), persisted: originalMemoryIds.length > 0};
    });
  await check('M02-recall', user, '我之前告诉过你长期想修什么方向？请只根据你实际保存的信息回答，没有记录就说没有。',
    (out, rows) => ({recalled: includesWords(out.answer, first), persisted: includesWords(active(rows).map(v => v.content).join(' '), first)}));
  await check('M03-isolation', other, '我之前告诉过你长期想修什么方向？请只根据你实际保存的信息回答，没有记录就说没有。',
    (out, rows) => ({noLeakedAnswer: [...first, ...second].every(word => !out.answer.includes(word)),
      noInventedDirection: /没有|未.{0,4}记录|不.{0,4}保存|尚未|还没/.test(out.answer), noStoredMemory: active(rows).length === 0}));
  await check('M04-update', user, '我的长期学习方向已经改成数据库内核与时序数据压缩，之前的无人机森林巡检方向已经放弃。请更新记忆，只保留新的方向。',
    (out, rows) => ({flushed: flushSucceeded(out), newPersisted: includesWords(active(rows).map(v => v.content).join(' '), second),
      // The replacement may truthfully say "已放弃旧方向"; check lifecycle by ID, not keyword absence.
      oldNotActive: originalMemoryIds.length > 0 && originalMemoryIds.every(id => !active(rows).some(row => row.id === id)),
      oldInvalidated: rows.some(v => v.invalid_at != null && includesWords(v.content, first))}));
  await check('M05-recall-update', user, '我现在长期想修什么方向？请只说当前方向，没有记录就说没有。',
    out => ({newRecalled: includesWords(out.answer, second), oldNotRecalled: first.every(word => !out.answer.includes(word))}));
  const course = context.courses.ai;
  const eligibilityQuestion = `我能选课程 ${course.code} 吗？请先查当前学生档案，再查资格；说明当前学年和学分。只查询，不报名。`;
  const qualification = (year, credits, status) => out => {
    const value = decision(out);
    const names = out.completed.map(tool => tool.name);
    return {profileBeforeRule: names.indexOf('get_student_profile') >= 0 && names.indexOf('get_student_profile') < names.indexOf('check_course_eligibility'),
      liveYear: value?.student?.studyYear === year, liveCredits: Number(value?.student?.completedCredits) === credits,
      toolDecision: value?.status === status, answerDecision: conclusion(out.answer) === status,
      noEnrollment: enrollment(user, course).count === 0};
  };
  await check('M06-current-profile', user, eligibilityQuestion, qualification(2, 45, 'ELIGIBLE'));
  // This user and the course were created by this run. Restore its initial state even on failure.
  assert(user.username.startsWith('ce_' + context.runId + '_'));
  try {
    sql(`UPDATE campus_student SET study_year=1,completed_credits=10 WHERE user_id=${literal(user.userId)};`);
    await check('M07-changed-profile', user,
      '我记得我之前是大二、45学分；请以系统最新档案为准。' + eligibilityQuestion,
      qualification(1, 10, 'INELIGIBLE'));
  } finally {
    sql(`UPDATE campus_student SET study_year=2,completed_credits=45 WHERE user_id=${literal(user.userId)};`);
  }
  await check('M08-forget', user, '请忘掉我之前说过的长期学习方向，不要再保存这个偏好，也不要新增其他偏好。',
    (out, rows) => ({flushed: flushSucceeded(out), directionRemoved: active(rows).every(v => ![...first, ...second].some(word => v.content.includes(word))),
      newInvalidated: rows.some(v => v.invalid_at != null && includesWords(v.content, second))}));
  await check('M09-recall-forgotten', user, '我长期想修什么方向？只根据你保存的长期记忆回答，没有记录就说没有，不要推测。',
    out => ({noRecall: [...first, ...second].every(word => !out.answer.includes(word)),
      admitsMissing: /没有|未.{0,4}记录|不.{0,4}保存|尚未|还没/.test(out.answer)}));
  console.log(`Report: ${filename}`);
  if (results.some(row => !row.passed)) process.exitCode = 1;
}

run().catch(error => {console.error(error.message); process.exitCode = 1;});
