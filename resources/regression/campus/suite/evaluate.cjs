const fs = require('node:fs');
const path = require('node:path');
const {chat} = require('./support.cjs');
const cases = require('./cases.json');
const writeTools = ['enroll_course', 'register_course_retake', 'apply_student_leave'];

function compact(value) {
  return value.replace(/[\s*`#_]/g, '');
}

function conclusion(answer) {
  const lead = compact(answer).slice(0, 180);
  if (/暂不能判断|暂无法判断|无法判断|不能确定|暂不能确定|尚不能判断|规则冲突|规则缺失/.test(lead)) return 'UNKNOWN';
  if (/不可选|不能选|不符合|不满足|不能报名|不具备|无法选修|不可报名/.test(lead)) return 'INELIGIBLE';
  if (/可以选|可选|符合.{0,8}条件|可以报名|具备.{0,8}资格/.test(lead)) return 'ELIGIBLE';
  return 'UNCLASSIFIED';
}

function containsGroups(answer, groups) {
  const value = compact(answer);
  return (groups || []).every(group => group.some(word => value.includes(compact(word))));
}

function score(test, output) {
  const issues = [];
  const normal = output.finish?.messageStatus === 'NORMAL' && !output.errored;
  const noWrites = !output.completed.some(v => writeTools.includes(v.name));
  if (!normal) issues.push('conversation_not_completed');
  if (!noWrites) issues.push('unexpected_write_tool');
  const facts = containsGroups(output.answer, test.required);
  if (!facts) issues.push('missing_expected_answer_facts');
  const checks = {normal, noWrites, facts};
  if (test.category === 'eligibility') {
    const profileIndex = output.completed.findIndex(v => v.name === 'get_student_profile' && v.ok === true);
    const decisionIndex = output.completed.findIndex(v => v.name === 'check_course_eligibility' && v.ok === true);
    let decision;
    try { decision = JSON.parse(output.completed[decisionIndex]?.result); } catch {}
    checks.profileBeforeRule = profileIndex >= 0 && decisionIndex > profileIndex;
    checks.toolDecision = decision?.status === test.expectedStatus;
    checks.answerDecision = conclusion(output.answer) === test.expectedStatus;
    checks.qualification = checks.profileBeforeRule && checks.toolDecision && checks.answerDecision;
    if (!checks.qualification) issues.push('qualification_or_profile_order_mismatch');
    if (test.expectedPlan) {
      checks.planVersion = decision?.student?.planVersion === test.expectedPlan && decision?.rule?.planVersion === test.expectedPlan;
      checks.ruleSource = decision?.rule?.sourceTitle === '教务评测培养方案 ' + test.expectedPlan;
      checks.answerEvidence = checks.ruleSource && compact(output.answer).includes(compact(decision.rule.sourceTitle))
        && compact(output.answer).includes(compact(decision.rule.sourceSection.split(' ')[0]));
      if (!checks.planVersion) issues.push('wrong_plan_version');
      if (!checks.answerEvidence) issues.push('missing_or_wrong_rule_citation');
    } else {
      checks.abstention = decision?.rule == null && conclusion(output.answer) === 'UNKNOWN';
      if (!checks.abstention) issues.push('did_not_abstain_without_single_rule');
    }
    return {checks, issues, matchedPlan: decision?.rule?.planVersion, predictedStatus: conclusion(output.answer)};
  }
  if (test.category === 'knowledge') {
    checks.knowledgeTool = output.completed.some(v => v.name === 'search_knowledge' && v.ok === true);
    // 标题既要出现在最终回答，也必须真实存在于本轮工具结果，不能仅凭模型写出一个标题。
    checks.answerEvidence = compact(output.answer).includes(compact(test.sourceTitle)) &&
      output.completed.some(v => v.ok && typeof v.result === 'string' && compact(v.result).includes(compact(test.sourceTitle)));
    if (!checks.knowledgeTool) issues.push('knowledge_search_not_used');
    if (!checks.answerEvidence) issues.push('missing_document_title');
  } else if (test.category === 'clarification') {
    checks.noGuessedCourse = !output.completed.some(v => ['check_course_eligibility', 'search_academic_rules'].includes(v.name));
    if (!checks.noGuessedCourse) issues.push('guessed_a_course');
  } else {
    checks.noInventedEligibility = !output.completed.some(v => v.name === 'check_course_eligibility' && v.ok === true);
    if (!checks.noInventedEligibility) issues.push('invented_eligibility');
  }
  return {checks, issues};
}

function ratio(rows, key) {
  const applicable = rows.filter(row => typeof row.checks?.[key] === 'boolean');
  const passed = applicable.filter(row => row.checks[key]).length;
  return {passed, total: applicable.length, percent: applicable.length ? Number((100 * passed / applicable.length).toFixed(2)) : null};
}

async function runEvaluation(context) {
  const results = [];
  for (const test of cases) {
    const course = test.course ? context.courses[test.course] : null;
    let question = test.question + (course ? `\n课程代码：${course.code}。` : '');
    if (test.category === 'eligibility') {
      question += '\n请先明确结论（可选、不可选或暂不能判断），再说明当前系统档案、未满足条件及规则文档标题和条款。只查询，不提交报名。';
    } else if (test.category === 'knowledge') {
      question += '\n请给出依据文档的完整标题；只问流程，不提交申请。';
    }
    let row;
    try {
      const output = await chat(context.users[test.user], question, context.directory, test.id);
      const assessment = score(test, output);
      row = {...test, question, ...assessment, answer: output.answer,
        completedTools: output.completed.map(v => v.name), failedTools: output.failed.map(v => v.name),
        elapsedMs: output.elapsedMs, passed: assessment.issues.length === 0};
    } catch (error) {
      // 请求失败也计入原定分母，不能靠排除超时抬高正确率。
      const checks = {normal: false, noWrites: false, facts: false};
      if (test.category === 'eligibility') checks.qualification = false;
      if (test.expectedPlan) checks.planVersion = false;
      if (test.expectedPlan || test.category === 'knowledge') checks.answerEvidence = false;
      if (test.category === 'eligibility' && !test.expectedPlan) checks.abstention = false;
      if (test.category === 'knowledge') checks.knowledgeTool = false;
      row = {...test, question, passed: false, checks, issues: ['request_failed'], error: error.message};
    }
    results.push(row);
    fs.writeFileSync(path.join(context.directory, 'evaluation-results.json'), JSON.stringify({results}, null, 2));
    console.log(`[evaluation] ${row.passed ? 'PASS' : 'FAIL'} ${test.id}: ${row.issues.join(', ') || 'ok'}`);
  }
  const metrics = metricsFor(results);
  const report = {runId: context.runId, model: 'existing configured DeepSeek model',
    methodology: '固定28题；标准答案在运行前人工定义；确定性检查模型实际工具轨迹、最终回答、版本与出处，不使用另一个模型打分。规则级判断与RAG检索排名是不同指标。',
    metrics, results};
  fs.writeFileSync(path.join(context.directory, 'evaluation-report.json'), JSON.stringify(report, null, 2));
  return report;
}

function metricsFor(results) {
  return {
    casePassRate: {passed: results.filter(v => v.passed).length, total: results.length},
    qualification: ratio(results, 'qualification'),
    planVersion: ratio(results, 'planVersion'),
    answerEvidence: ratio(results, 'answerEvidence'),
    answerFacts: ratio(results.filter(row => row.required?.length), 'facts'),
    abstention: ratio(results, 'abstention'),
    noWrites: ratio(results, 'noWrites'),
    knowledgeTool: ratio(results, 'knowledgeTool')
  };
}

module.exports = {runEvaluation, score, conclusion, metricsFor};
