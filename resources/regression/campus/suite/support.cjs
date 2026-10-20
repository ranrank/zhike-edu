const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');

const base = process.env.CAMPUS_APP_URL || 'http://127.0.0.1:9090/api/ragent';
const frontend = process.env.CAMPUS_FRONTEND_URL || 'http://127.0.0.1:5173';
for (const value of [base, frontend]) {
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname), 'Suite only supports local demo services');
}

async function api(endpoint, token, body) {
  const response = await fetch(base + endpoint, {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: token} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000)
  });
  const payload = await response.json();
  assert.equal(payload.code, '0', payload.message);
  return payload.data;
}

function sql(statement) {
  return execFileSync('docker', ['exec', '-i', process.env.CAMPUS_PG_CONTAINER || 'ragent-postgres',
    'psql', '-U', 'postgres', '-d', 'ragent_bit', '-v', 'ON_ERROR_STOP=1', '-qAt'],
  {input: statement, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024}).trim();
}

function literal(value) {
  return value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
}

function events(raw) {
  return raw.split(/\r?\n\r?\n/).flatMap(frame => {
    const lines = frame.split(/\r?\n/);
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
    if (!data || data === '[DONE]') return [];
    const eventType = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
    return [{...JSON.parse(data), eventType}];
  });
}

function transcript(raw) {
  const values = events(raw);
  return {
    events: values,
    completed: values.filter(v => v.kind === 'tool' && v.status === 'done'),
    failed: values.filter(v => v.kind === 'tool' && v.status === 'failed'),
    answer: values.filter(v => v.type === 'answer').map(v => v.delta).join(''),
    finish: values.findLast(v => v.messageStatus),
    conversationId: values.find(v => v.conversationId)?.conversationId,
    errored: values.some(v => v.type === 'error')
  };
}

async function chat(user, question, directory, name) {
  const start = Date.now();
  const response = await fetch(base + '/agent/v1/chat?question=' + encodeURIComponent(question), {
    headers: {Authorization: user.token, Accept: 'text/event-stream'}, signal: AbortSignal.timeout(120000)
  });
  assert(response.ok, `Chat HTTP ${response.status}`);
  const raw = await response.text();
  fs.writeFileSync(path.join(directory, name + '.sse'), raw);
  return {...transcript(raw), elapsedMs: Date.now() - start};
}

async function fixtures(options = {}) {
  const runId = Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const coursePrefix = 'T' + runId.toUpperCase();
  const directory = path.resolve(__dirname, '../artifacts', 'suite-' + runId);
  fs.mkdirSync(directory, {recursive: true});
  const admin = await api('/auth/login', null, {
    username: process.env.CAMPUS_USERNAME || 'admin', password: process.env.CAMPUS_PASSWORD || 'admin'
  });
  const profiles = await api('/agents', admin.token);
  assert(profiles.agents.some(v => v.name === '知课教务' && v.active), 'Campus profile is not active');
  const password = process.env.CAMPUS_EVAL_PASSWORD || crypto.randomBytes(24).toString('hex');
  const definitions = {
    sophomore: {year: 2, credits: 45, plan: 'CS-2024'},
    senior: {year: 4, credits: 120, plan: 'CS-2022'},
    lowCredits: {year: 4, credits: 99, plan: 'CS-2022'},
    noPrerequisite: {year: 4, credits: 120, plan: 'CS-2022', noPrerequisite: true},
    unknownPlan: {year: 4, credits: 120, plan: 'CS-UNKNOWN'},
    suspended: {year: 4, credits: 120, plan: 'CS-2022', status: 'SUSPENDED'},
    graduated: {year: 4, credits: 120, plan: 'CS-2022', status: 'GRADUATED'},
    otherMajor: {year: 4, credits: 120, plan: 'CS-2022', major: '软件工程'},
    retake: {year: 2, credits: 45, plan: 'CS-2024'},
    belowThirty: {year: 2, credits: 29, plan: 'CS-2024'},
    alreadyPassed: {year: 2, credits: 45, plan: 'CS-2024'},
    unbound: {unbound: true},
    boundary2024: {year: 4, credits: 105, plan: 'CS-2024'},
    boundary2022: {year: 4, credits: 105, plan: 'CS-2022'}
  };
  const users = {};
  for (const [key, definition] of Object.entries(definitions)) {
    if (options.browserOnly && !['sophomore', 'retake'].includes(key)) continue;
    const username = 'ce_' + runId + '_' + Object.keys(users).length;
    const userId = String(await api('/users', admin.token, {username, password, role: 'user'}));
    assert(/^\d+$/.test(userId));
    const login = await api('/auth/login', null, {username, password});
    users[key] = {...definition, userId, username, password, token: login.token};
  }
  const courseDefinitions = {
    graduation: {suffix: 'G', name: '评测毕业设计', credits: 8, year: 4, minCredits: 100, section: '第4条 毕业设计'},
    ai: {suffix: 'A', name: '评测人工智能导论', credits: 3, year: 2, minCredits: 30, section: '第3条 人工智能导论'},
    full: {suffix: 'F', name: '评测满额课程', seats: 0},
    closed: {suffix: 'C', name: '评测未开放课程', open: false},
    conflict: {suffix: 'X', name: '评测冲突规则课程', conflict: true},
    expired: {suffix: 'E', name: '评测过期规则课程', from: '2020-01-01', until: '2020-01-02'},
    future: {suffix: 'U', name: '评测未来规则课程', from: '2099-01-01'},
    noRule: {suffix: 'Z', name: '评测缺失规则课程', noRule: true},
    normalWrite: {suffix: 'N', name: '页面联调普通选课'},
    retakeWrite: {suffix: 'R', name: '页面联调重修课程'},
    seatRace: {suffix: 'S', name: '页面联调名额变化', seats: 1},
    statusRace: {suffix: 'V', name: '页面联调学籍变化'},
    unknown: {suffix: 'M', absent: true}
  };
  const courses = {};
  const statements = ['BEGIN;'];
  for (const [key, user] of Object.entries(users)) {
    if (user.unbound) continue;
    statements.push(`INSERT INTO campus_student VALUES (${literal(user.userId)},'计算机学院',${literal(user.major || '计算机科学与技术')},${user.year},${literal(user.plan)},${user.credits},${literal(user.status || 'ACTIVE')});`);
    if (!user.noPrerequisite) statements.push(`INSERT INTO campus_transcript VALUES (${literal(user.userId)},'CS201','PASSED');`);
  }
  for (const [key, definition] of Object.entries(courseDefinitions)) {
    const code = coursePrefix + definition.suffix;
    courses[key] = {...definition, code, initialSeats: definition.seats ?? 8};
    if (definition.absent) continue;
    statements.push(`INSERT INTO campus_course VALUES (${literal(code)},${literal(definition.name)},${literal('EVAL-' + runId)},${definition.credits || 3},${definition.seats ?? 8},${definition.open === false ? 'FALSE' : 'TRUE'});`);
    if (definition.noRule) continue;
    for (const plan of ['CS-2024', 'CS-2022']) {
      const minimum = key === 'graduation' && plan === 'CS-2022' ? 110 : (definition.minCredits || 0);
      const ruleId = code + '-' + plan;
      const source = '教务评测培养方案 ' + plan;
      const section = definition.section || '第5条 选课开放与名额';
      const ruleText = `虚构教务评测规则：${code} ${definition.name}，第${definition.year || 1}至4学年，已修至少${minimum}学分${['graduation','ai'].includes(key) ? '，须通过CS201' : ''}。当前名额与开放状态另查业务库。`;
      statements.push(`INSERT INTO campus_course_rule VALUES (${literal(ruleId)},${literal(code)},'计算机科学与技术',${literal(plan)},${definition.year || 1},4,${minimum},${['graduation','ai'].includes(key) ? "'CS201'" : 'NULL'},${literal(source)},${literal(section)},${literal(ruleText)},${literal(definition.from || '2020-01-01')},${literal(definition.until || '2100-12-31')});`);
      if (definition.conflict) statements.push(`INSERT INTO campus_course_rule SELECT rule_id || '-CONFLICT', course_code,major,plan_version,min_year,max_year,min_credits+1,prerequisite_course_code,source_title,source_section,rule_text,valid_from,valid_until FROM campus_course_rule WHERE rule_id=${literal(ruleId)};`);
    }
  }
  statements.push(`INSERT INTO campus_transcript VALUES (${literal(users.retake.userId)},${literal(courses.retakeWrite.code)},'FAILED');`);
  if (users.alreadyPassed) statements.push(`INSERT INTO campus_transcript VALUES (${literal(users.alreadyPassed.userId)},${literal(courses.ai.code)},'PASSED');`);
  statements.push('COMMIT;');
  sql(statements.join('\n'));
  const manifest = {runId, coursePrefix, users: Object.fromEntries(Object.entries(users).map(([key, user]) =>
    [key, Object.fromEntries(Object.entries(user).filter(([name]) => !['password','token'].includes(name)))])), courses};
  fs.writeFileSync(path.join(directory, 'fixtures.json'), JSON.stringify(manifest, null, 2));
  return {runId, directory, users, courses, password, frontend, base};
}

function enrollment(user, course) {
  return JSON.parse(sql(`SELECT json_build_object('count',count(*),'ids',coalesce(json_agg(enrollment_id),'[]'::json)) FROM campus_enrollment WHERE user_id=${literal(user.userId)} AND course_code=${literal(course.code)};`));
}
function seats(course) {
  return Number(sql(`SELECT remaining_seats FROM campus_course WHERE course_code=${literal(course.code)};`));
}
function setSeats(context, course, value) {
  assert(course.code.startsWith('T' + context.runId.toUpperCase()));
  assert(Number.isInteger(value) && value >= 0);
  sql(`UPDATE campus_course SET remaining_seats=${value} WHERE course_code=${literal(course.code)};`);
}
function setStatus(context, key, status) {
  assert(Object.hasOwn(context.users, key) && ['ACTIVE','SUSPENDED'].includes(status));
  sql(`UPDATE campus_student SET student_status=${literal(status)} WHERE user_id=${literal(context.users[key].userId)};`);
}

module.exports = {api, sql, literal, events, transcript, chat, fixtures, enrollment, seats, setSeats, setStatus};
