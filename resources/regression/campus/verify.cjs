const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.CAMPUS_APP_URL || 'http://127.0.0.1:9090/api/ragent';
const mcpUrl = process.env.CAMPUS_MCP_URL || 'http://127.0.0.1:9099/mcp';
const out = path.join(__dirname, 'artifacts');
fs.mkdirSync(out, {recursive:true});

async function api(endpoint, token, body) {
  const response = await fetch(base + endpoint, {method:body ? 'POST':'GET', headers:{'Content-Type':'application/json', ...(token ? {Authorization:token}: {})}, ...(body ? {body:JSON.stringify(body)}:{})});
  const value = await response.json();
  assert.equal(value.code, '0', value.message);
  return value.data;
}
function rpcPayload(text) {
  if (text.trim().startsWith('{')) return JSON.parse(text);
  const values = text.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5).trim()));
  return values[values.length-1];
}
async function main() {
  const login = await api('/auth/login', null, {username:process.env.CAMPUS_USERNAME || 'admin',password:process.env.CAMPUS_PASSWORD || 'admin'});
  const token = login.token;
  const user = await api('/user/me', token);
  const userId = String(user.userId || user.id);
  const profiles = await api('/agents', token);
  assert(profiles.agents.some(agent=>agent.active && agent.name==='知课教务'));
  let rpcId = 0;
  let session;
  async function rpc(method, params, notification=false) {
    const response = await fetch(mcpUrl, {method:'POST', headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream', ...(session ? {'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-06-18'}:{})}, body:JSON.stringify({jsonrpc:'2.0',...(!notification ? {id:++rpcId}:{}),method,params})});
    assert(response.ok, `MCP HTTP ${response.status}`);
    session = response.headers.get('mcp-session-id') || session;
    if(notification) return;
    const value = rpcPayload(await response.text());
    assert(!value.error, JSON.stringify(value.error));
    return value.result;
  }
  await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'campus-verification',version:'1.0'}});
  await rpc('notifications/initialized',{},true);
  const listing = await rpc('tools/list',{});
  assert.equal(listing.tools.filter(tool=>['get_student_profile','search_academic_rules','check_course_eligibility','enroll_course','register_course_retake','apply_student_leave'].includes(tool.name)).length,6);
  async function call(name,args,userId) {
    return rpc('tools/call',{name,arguments:args,...(userId ? {_meta:{'com.nageoffer.ragent/userId':userId}}:{})});
  }
  const current = await call('get_student_profile',{},userId);
  assert.equal(current.isError,false);
  const cases=[];
  for(const [id,expected] of [['campus-demo-year2','INELIGIBLE'],['campus-demo-year4','ELIGIBLE'],['campus-demo-low-credit','INELIGIBLE'],['campus-demo-no-prereq','INELIGIBLE'],['campus-demo-unknown-plan','UNKNOWN']]) {
    const response = await call('check_course_eligibility',{courseCode:'CS401'},id);
    assert.equal(response.isError,false);
    const payload = JSON.parse(response.content[0].text);
    assert.equal(payload.status,expected);
    cases.push({student:id,expected,result:payload});
  }
  assert.equal((await call('get_student_profile',{},null)).isError,true);
  assert.equal((await call('get_student_profile',{studentId:'someone-else'},userId)).isError,true);
  fs.writeFileSync(path.join(out,'mcp-results.json'),JSON.stringify({activeProfile:'知课教务',currentProfile:JSON.parse(current.content[0].text),cases},null,2));
  console.log('MCP: 5 personalized cases passed; missing identity and identity override rejected.');
  if (process.argv.includes('--skip-chat')) {
    console.log('Model conversation was explicitly skipped, not verified.');
    return;
  }
  const question='我能选毕业设计 CS401 吗？请先查我的当前学生档案，再核对适用的培养方案，告诉我结论和原因。';
  const response = await fetch(base+'/agent/v1/chat?question='+encodeURIComponent(question),{headers:{Authorization:token,Accept:'text/event-stream'},signal:AbortSignal.timeout(120000)});
  assert(response.ok, 'Chat HTTP '+response.status);
  const text=await response.text();
  fs.writeFileSync(path.join(out,'eligibility-chat.sse'),text);
  if (text.includes('"type":"error"')) {
    fs.writeFileSync(path.join(out,'chat-status.json'),JSON.stringify({verified:false,reason:'Model conversation interrupted; inspect backend provider logs.'},null,2));
    throw new Error('Model conversation interrupted before completion; MCP checks passed but chat is unverified.');
  }
  assert(text.includes('get_student_profile'),'Agent did not query profile');
  assert(text.includes('check_course_eligibility'),'Agent did not check eligibility');
  assert(text.includes('INELIGIBLE'),'Agent did not use expected decision');
  assert(!text.includes('event:reject'),'Chat rejected');
  assert(text.includes('event:done'),'Chat did not finish');
  const events = text.split('\n').filter(line=>line.startsWith('data:') && line.slice(5).trim()!=='[DONE]')
    .map(line=>JSON.parse(line.slice(5)));
  const completed = events.filter(event=>event.kind==='tool' && event.status==='done');
  const profileIndex = completed.findIndex(event=>event.name==='get_student_profile' && event.ok===true);
  const decisionIndex = completed.findIndex(event=>event.name==='check_course_eligibility' && event.ok===true);
  assert(profileIndex>=0 && decisionIndex>profileIndex,'Profile must complete before the eligibility check');
  const decision = JSON.parse(completed[decisionIndex].result);
  assert.equal(decision.status,'INELIGIBLE');
  assert.equal(decision.student.planVersion,'CS-2024');
  assert.equal(decision.rule.planVersion,decision.student.planVersion,'Wrong curriculum version');
  assert(events.some(event=>event.messageStatus==='NORMAL'),'Conversation did not finish normally');
  const answer = events.filter(event=>event.type==='answer').map(event=>event.delta).join('');
  assert(answer.includes('100') && answer.includes('45'),'Answer did not explain the credit requirement');
  assert(!completed.some(event=>['enroll_course','register_course_retake','apply_student_leave'].includes(event.name)),
    'Read-only eligibility question must not execute a write');
  fs.writeFileSync(path.join(out,'chat-status.json'),JSON.stringify({verified:true,
    completedTools:completed.map(event=>event.name),matchedPlanVersion:decision.rule.planVersion,answer},null,2));
  console.log('Agent: actual conversation queried profile and eligibility, received INELIGIBLE.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
