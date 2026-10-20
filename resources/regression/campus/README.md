# 高校教务场景回归

先启动本地 bootstrap / mcp-server，并运行 campus-assistant 初始化器。需要支持 fetch 的现有 Node 运行时，无新增 npm 包。

```powershell
# 不调用模型：五组学生状态对照、身份缺失与越权参数、当前人设
node resources/regression/campus/verify.cjs --skip-chat

# 模型服务恢复后，追加实际 Agent 对话，检查画像查询与资格工具均被调用
node resources/regression/campus/verify.cjs
```

默认本机地址 9090 / 9099、演示账号 admin；可用 CAMPUS_APP_URL、CAMPUS_MCP_URL、CAMPUS_USERNAME、CAMPUS_PASSWORD 覆盖。
脚本不打印或保存登录 token，不执行选课或请假写操作；输出到已忽略的 artifacts 目录。
模型未完成对话时会失败退出，不把 MCP 单独通过当成模型联调通过。

真实 PostgreSQL 写入、幂等与并发测试见 mcp-server 的 CampusPostgresTest，需显式指定独立测试库。

## 选课与重修页面验收、28 题评测

`suite/cases.json` 在执行前定义标准答案，包含 21 个资格问题、3 个缺信息或无档案问题、4 个知识库问题。
其中两题都是大四、105 学分，但评测培养方案 CS-2024 要求 100 学分、CS-2022 要求 110 学分，预期结论相反。
该差异属于独立的虚构评测课程，不修改原有 CS401 及其示例规则。

```powershell
# 浏览器测试使用现有 Playwright 工具目录，不安装到项目、不新增 npm 依赖
$env:CAMPUS_PLAYWRIGHT_MODULE = '<现有 Playwright 模块的绝对路径>'
node resources/regression/campus/suite/run.cjs

# 两个阶段也可以分别运行
node resources/regression/campus/suite/run.cjs --browser-only
node resources/regression/campus/suite/run.cjs --evaluation-only
node --test resources/regression/campus/suite/support.test.cjs
```

仅接受本机应用地址。每次执行用管理员 API 新增带 `ce_` 前缀的普通测试账号，
在现有教务表中新增带独立运行标识的专用课程和档案。浏览器阶段只需两个测试账号。
不修改管理员档案、原有课程、订单或知识库；测试只会改变本次专用课程的名额及测试学生状态。
测试账号、报名和对话保留供审计；口令和登录 token 不写入评测产物，可在管理员后台重置测试账号口令。

页面验收会实际点击确认和取消，并回读数据库，覆盖普通选课、重修、重复提交、无未通过成绩、
确认前名额变动及确认前学籍变动。后者只临时改变本次测试学生，检查后恢复在读状态。

评分使用确定性规则，不另调模型打分：

- 资格正确：先查画像、实际资格工具结论和模型最终结论均与预设答案一致。
- 版本正确：档案与命中规则的版本均为题目预设版本，缺失或冲突规则不进入此分母。
- 出处正确：资格回答须引用实际工具返回的标题及条款；知识回答须引用本轮工具确实提供的文档标题。
- 事实覆盖：回答包含每题预设关键条件、材料或审批语义。
- 只读约束：只询问资格或流程时不执行选课、请假、重修写工具。

请求失败计入原定分母，不作为缺失值排除。所有 SSE、截图、逐题结果与指标保存在
`artifacts/suite-<运行标识>/`，失败记录保留。本地固定小样本的结果不能外推成真实教务问答准确率，
也不能替代 MRR@10 或 Hit@10 等检索排名指标。

## 跨会话长期记忆验收

```powershell
node resources/regression/campus/suite/memory.cjs
```

使用现有 DeepSeek、记忆工具及 PostgreSQL，不新增依赖。每次新增两个普通测试账号，
逐轮创建全新会话，执行九项检查：保存方向、跨会话召回、账号隔离、改口更新、
召回最新方向、变更前资格、变更后资格、明确遗忘、遗忘后不再召回。
召回问题本身不包含待回忆的方向；检查真实 `flush_memory` 结果、持久化条目状态及模型回答。
旧条目是否失效按数据库 ID 判断，避免把“已放弃旧方向”里的文字误判为仍使用旧偏好。

档案对照将本次专用学生从大二／45 学分临时改为大一／10 学分，查询同一课程后恢复。
同时验证先查画像、资格工具和回答结论一致，且不创建报名、不出现确认卡。
此脚本会在 `ragent` 中查询本次账号的记忆，并在 `ragent_bit` 中修改本次账号的教务档案；
管理员及原有学生档案不变。所有九题均计入分母，请求失败不会排除。

`artifacts/suite-<运行标识>/memory-report.json` 保存逐题断言、回答、记忆快照，旁边保留原始 SSE。
遗忘通过使条目失效来停止后续注入，原始对话和失效条目仍保留供审计，并非物理删除。
本组验证长期记忆，不涵盖短期上下文压缩、容量淘汰或高并发行为。
