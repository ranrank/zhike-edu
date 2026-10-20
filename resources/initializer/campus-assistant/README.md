# 知课教务 高校教务助手

基于开源 ragent 做业务改造，不新增 Maven / npm 依赖，不引入其他数据库、Agent 框架或中间件。
前端沿用 React；后端沿用 AgentScope、Spring Boot、现有 PostgreSQL / pgvector、Elasticsearch、Redis 与 MCP。

## 核心流程

“我能选毕业设计 CS401 吗？”先查当前登录学生档案，再匹配专业、培养方案版本及有效期对应的规则。
后端确定性检查学籍、年级、已修学分、先修课、选课开放期、剩余名额及是否已报名。
规则缺失或冲突时返回 UNKNOWN，不将“检索到了相似内容”等同于有资格。

培养方案解释走现有 RAG 混合检索；个人资格用 MCP 查询业务库。两条路径协作，未新增检索引擎。
培养方案分版本存入独立 Collection；提示词要求携带专业和版本检索。当前没有新增向量级学生权限过滤器，
最终资格结论依赖后端按专业、方案版本、有效期精确匹配的结构化规则，不能仅靠模型挑选检索片段。

## 本地启动与切换

需要现有 PostgreSQL、Redis、对象存储、Elasticsearch 等依赖已运行，以及百炼 / DeepSeek 密钥已在原有环境变量中配置。

1. 用原有 Maven 构建启动 bootstrap（9090）和 mcp-server（9099）。MCP 启动只创建 campus_* 表，不自动注入学生。
2. 用 JDK 17 或更新版本执行下面的离线校验。
3. 执行 Install 上传五篇虚构教务文档、增加十一项意图、四条示例问题并激活知课教务人设。

```powershell
$env:JAVA_HOME = 'D:\develop\jdk17'
& .\resources\initializer\campus-assistant\run.ps1 -Action Validate
& .\resources\initializer\campus-assistant\run.ps1 -Action Install
```

Install 不调用通用 cleanup，不删除已有知识库、文档、对话、订单或技能；切换前把意图和技能启用状态、人设保存到
`.state/before-campus.json`，然后停用旧场景意图及技能。保留已有日期工具。
初始化管理员账号若没有学生档案，绑定一份虚构大二档案；已有档案和成绩不会覆盖。
知识文档存在且成功入库时跳过；失败文档不会静默覆盖，需在后台修复后重新运行。

```powershell
# 恢复旧场景配置，新增教务业务记录和知识库仍保留
& .\resources\initializer\campus-assistant\run.ps1 -Action Restore
```

前端品牌是本次代码改造的一部分，Restore 仅恢复后端配置，不回退前端源码。

## 工具与数据

| 工具 | 行为 |
| --- | --- |
| get_student_profile | 查当前用户学院、专业、年级、学分、方案版本、已通过课程 |
| search_academic_rules | 查当前专业、方案版本、有效期对应的课程规则与出处 |
| check_course_eligibility | 只读判断资格，返回 ELIGIBLE / INELIGIBLE / UNKNOWN 和原因 |
| enroll_course | 确认后提交本地选课，事务占名额、同学期同课程幂等 |
| register_course_retake | 确认后提交重修，要求存在未通过成绩 |
| apply_student_leave | 确认后提交最多七天的请假，返回 PENDING，不等于批准 |

沿用现有 `_meta` 登录身份传递机制，工具不接受任意学生 ID。MCP 保持绑定 127.0.0.1，
这是现有受信应用内部调用方式，不能把客户端自报的元数据当成可对外开放的认证机制。
写操作的确认卡由现有 McpToolProxy 执行；直接访问本地受信 MCP 端口不会展示网页确认卡。

`db/campus-schema.sql` 是非破坏性建表脚本；`db/campus-demo.sql` 只插入缺失的虚构样例。
学生年级、学分以业务库为准；意向方向等偏好沿用现有长期记忆，不将旧记忆当成权威学籍。

## 验证

默认 Maven 测试包含资格判定、身份范围、MCP 读写声明与序列化；真实数据库测试默认跳过。
要跑数据库测试，先自行创建空的本机专用库，再显式设置环境变量，测试只接受下列命名范围：

```powershell
$env:CAMPUS_TEST_JDBC_URL = 'jdbc:postgresql://127.0.0.1:5432/ragent_campus_test_example'
mvn -B -pl mcp-server -am test
```

数据库测试只清空上述专用测试库中的教务表；不连接 ragent 或 ragent_bit。
覆盖同课不同年级、学分不足、缺先修课、未知方案、规则失效、专业不匹配、确认后状态变化、
重复报名、最后一席并发争抢、重修资格及请假幂等。

所有示例均不代表任何真实高校政策；接入真实数据前应由教务确认规则与业务办理接口。
