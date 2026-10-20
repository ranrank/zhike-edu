# 知课教务 · 高校教务助手

基于 [Ragent](https://github.com/nageoffer/ragent) 改造的高校教务 AI 助手，包含 React 前端、Java 后端和 MCP 教务工具。将培养方案知识问答与学生档案、选课资格检查及办理流程连接起来。

## 功能

- 培养方案、选课、奖学金与请假规则问答，支持混合检索和回答溯源。
- 查询当前登录学生档案；按专业、方案版本、有效期、年级、学分和先修课判断选课资格。
- 通过现有确认卡办理选课、重修登记和请假；业务写入由后端校验并使用事务。
- 沿用 Ragent 的会话记忆、管理后台、知识库、意图识别及 MCP 工具能力。

本仓库包含虚构教务数据与规则，供学习和演示使用，不代表真实高校政策。

## 技术栈与目录

Java 17、Spring Boot 4.1、AgentScope、PostgreSQL / pgvector、Elasticsearch、Redis、React 18、TypeScript、Vite。

| 目录 | 内容 |
| --- | --- |
| `frontend/` | 知课教务前端与管理后台 |
| `bootstrap/` | 主应用入口与配置 |
| `agent/`、`rag/`、`infra-ai/` | Agent、检索、模型接入 |
| `mcp-server/` | 教务工具、资格校验、业务表与样例数据 |
| `system/`、`framework/` | 用户、权限与公共模块 |
| `resources/initializer/campus-assistant/` | 教务人设、知识文档、意图及初始化工具 |
| `resources/docker/` | 本地开发依赖服务 |
| `docs/` | 改造、评测与长期记忆验收说明 |

## 本地启动

1. 准备 JDK 17、Docker、Node.js 与 npm。
2. 启动本地依赖：

```bash
docker compose -f resources/docker/local-stack.compose.yaml up -d
```

首次运行时，等待 PostgreSQL 就绪，再创建 MCP 使用的独立业务库：

```bash
docker exec ragent-postgres createdb -U postgres ragent_bit
```

如果该库已经存在，可跳过建库步骤。MCP 首次启动会创建业务表。

3. 在终端或 IDE 中设置模型服务环境变量。根据 `bootstrap/src/main/resources/application.yaml` 中启用的模型配置填写，例如 `BAILIAN_API_KEY`、`DEEPSEEK_API_KEY`、`TOKENDANCE_API_KEY`；仅使用对应服务时才需提供凭证。
4. 在项目根目录构建，然后分别运行主应用与 MCP 服务：

```powershell
.\mvnw.cmd clean package -DskipTests
java -jar bootstrap/target/bootstrap-0.0.1-SNAPSHOT.jar
# 在另一个终端运行
java -jar mcp-server/target/mcp-server-0.0.1-SNAPSHOT.jar
```

主应用端口为 `9090`，MCP 端口为 `9099`。MCP 绑定本机地址，供主应用内部调用。

5. 按[教务场景说明](resources/initializer/campus-assistant/README.md)验证并安装场景：

```powershell
& .\resources\initializer\campus-assistant\run.ps1 -Action Validate
& .\resources\initializer\campus-assistant\run.ps1 -Action Install
```

6. 在另一个终端启动前端：

```bash
cd frontend
cp .env.example .env
npm ci
npm run dev
```

默认开发账号和基础设施口令仅供本地演示，详见初始化配置与 Docker Compose。真实部署前请配置自己的认证与服务凭证。

## 验证与文档

- [教务场景功能、初始化、恢复与测试说明](resources/initializer/campus-assistant/README.md)
- [高校教务助手改造与验证](docs/高校教务助手改造与验证.md)
- [高校教务助手评测报告](docs/高校教务助手评测报告.md)
- [高校教务助手长期记忆验收](docs/高校教务助手长期记忆验收.md)
- [上游项目说明](docs/README-upstream.md)

## 来源与许可

本项目基于 [nageoffer/ragent](https://github.com/nageoffer/ragent) 进行教务场景改造，保留原项目版权声明与 [Apache License 2.0](LICENSE)。
