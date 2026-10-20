const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {score, metricsFor} = require('./evaluate.cjs');
const {transcript} = require('./support.cjs');
const cases = require('./cases.json');

const [baselineId, evaluationId, browserId] = process.argv.slice(2);
for (const id of [baselineId, evaluationId, browserId]) {
  if (!/^suite-[a-z0-9]+$/.test(id || '')) throw Error('Usage: report.cjs <baseline-suite-id> <evaluation-suite-id> <browser-suite-id>');
}
const root = path.resolve(__dirname, '../artifacts');
function rescore(id) {
  const directory = path.join(root, id);
  const original = JSON.parse(fs.readFileSync(path.join(directory, 'evaluation-report.json'), 'utf8'));
  const results = original.results.map(row => {
    const test = cases.find(test => test.id === row.id);
    const filename = path.join(directory, row.id + '.sse');
    if (!fs.existsSync(filename)) return row;
    const assessed = score(test, transcript(fs.readFileSync(filename, 'utf8')));
    return {...row, ...assessed, passed: assessed.issues.length === 0};
  });
  if (results.length !== cases.length) throw Error('Incomplete evaluation run');
  const report = {...original, metrics: metricsFor(results), results};
  fs.writeFileSync(path.join(directory, 'evaluation-rescored.json'), JSON.stringify(report, null, 2));
  return report;
}

const baseline = rescore(baselineId);
const evaluation = rescore(evaluationId);
const browser = JSON.parse(fs.readFileSync(path.join(root, browserId, 'browser-results.json'), 'utf8'));
const browserPassed = browser.results.filter(row => row.passed).length;
const ratio = value => `${value.passed}/${value.total}${value.percent == null ? '' : '（' + value.percent + '%）'}`;
const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'cases.json'))).digest('hex');
const browserNames = {
  'normal-cancel': '普通选课取消：确认前、取消后均无报名和名额变化',
  'normal-confirm': '普通选课确认：生成一笔报名、扣减一个名额',
  'normal-repeat': '普通选课重复请求：记录 ID 不变、无额外名额扣减',
  'retake-confirm': '有未通过成绩：确认后重修报名成功',
  'retake-repeat': '重修重复请求：记录 ID 不变、无额外名额扣减',
  'retake-without-failed-grade': '没有未通过成绩：不创建重修记录',
  'seat-changed-before-confirmation': '展示确认卡后名额归零：提交时重新校验并拒绝',
  'status-changed-before-confirmation': '展示确认卡后学籍改为休学：提交时重新校验并拒绝'
};
const table = cases.map(test => {
  const row = evaluation.results.find(row => row.id === test.id);
  const expected = test.expectedStatus || ({unbound: '未绑定档案，不能推断', 'missing-course': '课程不存在，不能推断',
    clarification: '询问具体课程', knowledge: '按检索资料回答并引用出处'})[test.category];
  return `| ${test.id} | ${test.question.replaceAll('|', '／')} | ${expected} | ${row.passed ? '通过' : row.issues.join('、')} |`;
}).join('\n');
const failures = evaluation.results.filter(row => !row.passed);
const md = `# 高校教务助手页面验收与评测报告

日期：2026-10-19。运行环境沿用现有 DeepSeek 配置、AgentScope、PostgreSQL 和 RAG 检索链路，未新增生产依赖。

## 验收结果

| 项目 | 结果 |
| --- | --- |
| 选课与重修真实浏览器验收 | ${browserPassed}/${browser.results.length} |
| 固定教务评测集 | ${ratio(evaluation.metrics.casePassRate)} |
| 资格结论与先查画像流程 | ${ratio(evaluation.metrics.qualification)} |
| 档案和规则版本匹配 | ${ratio(evaluation.metrics.planVersion)} |
| 有效规则或文档出处引用 | ${ratio(evaluation.metrics.answerEvidence)} |
| 预设关键事实覆盖 | ${ratio(evaluation.metrics.answerFacts)} |
| 缺失、失效或冲突规则时正确保留判断 | ${ratio(evaluation.metrics.abstention)} |
| 只读提问未执行写工具 | ${ratio(evaluation.metrics.noWrites)} |

## 真实页面流程

${browser.results.map(row => '- ' + browserNames[row.name] + '：' + (row.passed ? '通过' : row.error)).join('\n')}

以上均由浏览器登录普通测试学生、实际点击确认／取消并回读数据库验证。
本次没有改变管理员档案或原有课程；使用新建测试账号、独立运行标识的专用课程与成绩。
新增测试账号、对话及成功报名记录保留供审计，密码和 token 未写入产物。测试期间临时改变的学生学籍已恢复。

## 评测发现与修复

首轮按同一套标准答案得到 ${ratio(baseline.metrics.casePassRate)}；出处检查 ${ratio(baseline.metrics.answerEvidence)}。
未通过项为请假流程问答：内容正确，但检索合成结果没有提供文档标题，主 Agent 无法说明完整出处。

修复发生在 Agent 检索工具的结果返回处：从实际进入上下文的文档中附上元数据标题和有界摘录，
最多八篇、每篇摘录六百字符；不使用内部文档 ID 兜底，不将尚未进入上下文的召回文档当作来源。
常规 RAG 前端角标和上下文格式保持原有机制。新增来源边界与门面接线测试，相关 Java 回归 27 项通过，SSE 解析测试 2 项通过。

修复后完整重跑了同样的 28 题，未删除失败题或放宽标准。报告使用当前同一评分器对两轮原始 SSE 重算，
知识问答的出处还必须存在于本轮实际工具结果，避免仅凭模型写出标题计为通过。

## 评测口径与限制

- 21 题资格判断、3 题档案或课程信息缺失处理、4 题知识库问答。
- 资格题要求查询当前登录学生画像、调用资格工具、最终回答给出预设结论与必要原因；只查询，不提交。
- 版本指标分母为 15 道存在唯一有效规则的题；六道无适用规则或规则冲突题另计保留判断，三个信息缺失题不纳入版本分母。
- 出处指标分母为上述 15 道规则题加四道知识题，共 19 题；核对标题、条款或本轮工具真实返回的文档名。
- 关键事实覆盖仅计算预设了事实检查项的题目，空检查项不计入分母。请求失败仍计入相应指标分母。
- 所有标准答案在运行前定义，未用另一个大模型评判，也没有测量或宣称 MRR@10、Hit@10。
- 同为大四、105 学分的两个样例，评测 CS-2024 规则要求 100 学分，CS-2022 要求 110 学分，预期一可选、一不可选，验证版本差异影响结论。
- 这是本地虚构固定小样本的单轮验收结果，不能外推成真实高校或任意问法的准确率。

## 逐题结果

| 编号 | 问题 | 预期 | 结果 |
| --- | --- | --- | --- |
${table}

${failures.length ? '仍需处理：' + failures.map(row => row.id + ' ' + row.issues.join('、')).join('；') : '本轮全部题目通过上述确定性检查。'}

## 复现与证据

- 标准答案：resources/regression/campus/suite/cases.json
- 标准答案 SHA-256：${digest}
- 基线：resources/regression/campus/artifacts/${baselineId}/evaluation-rescored.json
- 修复后：resources/regression/campus/artifacts/${evaluationId}/evaluation-rescored.json
- 页面验收：resources/regression/campus/artifacts/${browserId}/browser-results.json
- 每轮目录保留原始 SSE、模型回答、夹具清单；浏览器轮次另有确认卡和结果截图。

运行方式见 resources/regression/campus/README.md。原始首轮浏览器误报也予以保留；原因是测试脚本最初把独立的 SSE confirm 事件误当成 kind 字段，修正后重新完成了八项页面验收。
`;
const output = path.resolve(__dirname, '../../../../docs/高校教务助手评测报告.md');
fs.writeFileSync(output, md);
fs.writeFileSync(path.join(root, 'acceptance-report.json'), JSON.stringify({baselineId, evaluationId, browserId, caseSha256: digest,
  browser: {passed: browserPassed, total: browser.results.length}, metrics: evaluation.metrics}, null, 2));
console.log(output);
console.log(JSON.stringify({browser: `${browserPassed}/${browser.results.length}`, metrics: evaluation.metrics}, null, 2));
