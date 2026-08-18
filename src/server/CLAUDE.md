[根目录](../../CLAUDE.md) > [src](./) > **server**

# Server 模块

## 模块职责

Express 后端服务层，提供 REST API、WebSocket 实时推送、AI Bridge 通信管理、文件系统持久化、MCP 协议集成、沙箱管理、任务调度等核心能力。

## 入口与启动

- **入口**：`index.ts` -- `createServer(port)` 工厂函数，组装中间件、服务实例、路由，创建 HTTP + WebSocket 服务器
- **开发入口**：`../dev-server.ts` -- 固定端口 3000 启动
- **编译**：`tsconfig.server.json`，CommonJS 模块，输出到 `dist/server/` + `dist/cli/`

## 对外接口

通过 Express Router 挂载到 `/api/*` 前缀，共 13 组路由（详见根级 CLAUDE.md 路由总览）。

## 内部结构

### routes/ -- 路由层（14 个文件）

| 文件 | 前缀 | 说明 |
|------|------|------|
| `requirements.ts` | `/api/requirements` | 需求 CRUD + MCP 拉取 + 搜索 + 图片服务 |
| `workspace.ts` | `/api/workspace` | 工作区管理 + 文件浏览 + Git 全操作 |
| `plan.ts` | `/api/plan` | 计划生成/回复/暂停/恢复/重生成/技能队列/任务导出 xlsx |
| `execution.ts` | `/api/execution` | 代码执行/暂停/中止/重试/跳步/技能队列 + 自动触发测试 |
| `tests.ts` | `/api/tests` | 三种测试模式 + 沙箱三阶段 + 变更文件定向测试 |
| `skills.ts` | `/api/skills` | 技能 CRUD（内置 + Provider 外部合并去重） |
| `mcp-servers.ts` | `/api/mcp-servers` | MCP 服务器配置 CRUD + 连接测试 |
| `pipelines.ts` | `/api/pipelines` | 工作流管线配置 CRUD |
| `system.ts` | `/api/system` | 系统状态 + CLI Provider 选择/检测 |
| `analytics.ts` | `/api/analytics` | 数据分析 |
| `mineru.ts` | `/api/mineru` | MinerU 文档解析 |
| `projects.ts` | `/api/tasks` | 多任务调度管理 |
| `agent-execution.ts` | `/api/agent-execution` | Agent 自主执行（create/start/abort/reply） |

### services/ -- 服务层

**核心服务**：

| 文件 | 类名 | 说明 |
|------|------|------|
| `cli-runner-service.ts` | `CLIRunnerService` | CLI Provider Facade，统一代理 Claude/Codex/Pi |
| `cli-providers/types.ts` | -- | CLI Provider 接口定义（`CLIProvider`、`CLIProviderInput` 等） |
| `cli-providers/index.ts` | -- | Provider 注册表与自动检测 |
| `cli-providers/claude-provider.ts` | `ClaudeProvider` | Claude Code CLI Provider 实现 |
| `cli-providers/codex-provider.ts` | `CodexProvider` | OpenAI Codex CLI Provider 实现 |
| `config-service.ts` | `ConfigService` | 全局配置管理（`~/.ai-dev-workbench/config.json`） |
| `mcp-bridge-service.ts` | `MCPBridgeService` | MCP 桥接服务，与外部需求管理系统通信 |
| `mcp-config-service.ts` | `MCPConfigService` | MCP 服务器配置管理 |
| `workspace-service.ts` | `WorkspaceService` | 工作区文件系统操作 + Git 命令 |
| `task-scheduler-service.ts` | `TaskScheduler` | 多任务并行调度器（Coordinator 模式） |
| `agent-coordinator.ts` | `AgentCoordinator` | Agent 执行协调器（解析 thinking/tool_use/tool_result 事件） |

**存储服务**：

| 文件 | 类名 | 说明 |
|------|------|------|
| `requirement-store-service.ts` | `RequirementStoreService` | 需求持久化（文件夹结构） |
| `plan-store-service.ts` | `PlanStoreService` | 计划持久化 |
| `execution-store-service.ts` | `ExecutionStoreService` | 执行记录持久化 |
| `test-store-service.ts` | `TestStoreService` | 测试结果持久化 |
| `task-store-service.ts` | `TaskStoreService` | 任务持久化 |
| `agent-execution-store.ts` | `AgentExecutionStore` | Agent 执行记录持久化 |
| `analytics-store-service.ts` | `AnalyticsStoreService` | 分析数据持久化 |
| `json-store.ts` | `JsonStore` | 通用 JSON 文件存储工具 |

**业务服务**：

| 文件 | 类名 | 说明 |
|------|------|------|
| `pipeline-service.ts` | `PipelineService` | 工作流管线配置管理 |
| `skills-service.ts` | `SkillsService` | AI 技能管理 |
| `test-executor-service.ts` | `TestExecutorService` | 测试执行器（多框架自动检测） |
| `sandbox-service.ts` | `SandboxService` | Daytona 沙箱管理 |
| `mineru-service.ts` | `MinerUService` | MinerU 文档解析 |
| `ones-image-service.ts` | `OnesImageService` | ONES 平台图片下载 |
| `memory/memory-service.ts` | `MemoryService` | 记忆子系统（项目事实/反馈日志/用户画像） |
| `memory/project-facts-store.ts` | `ProjectFactsStore` | 项目事实存储 |
| `memory/feedback-log-store.ts` | `FeedbackLogStore` | 反馈日志存储 |
| `memory/user-profile-store.ts` | `UserProfileStore` | 用户画像存储 |
| `analytics-service.ts` | `AnalyticsService` | 数据分析服务 |
| `skill-derivation-service.ts` | `SkillDerivationService` | （已废弃）技能自动派生 — 不再实例化 |

**测试 Provider**：

| 文件 | 说明 |
|------|------|
| `test-providers/types.ts` | 测试 Provider 接口 |
| `test-providers/index.ts` | Provider 注册表 |
| `test-providers/node-provider.ts` | Node.js (jest/vitest/mocha) |
| `test-providers/python-provider.ts` | Python (pytest/unittest) |
| `test-providers/java-provider.ts` | Java (junit/maven/gradle) |
| `test-providers/generic-provider.ts` | 通用（命令行） |

### middleware/ -- 中间件

| 文件 | 说明 |
|------|------|
| `logger.ts` | HTTP 请求日志 |
| `validation.ts` | 请求体验证 + 错误处理 + 路径安全校验 |

### utils/ -- 工具库

| 文件 | 说明 |
|------|------|
| `constants.ts` | 目录路径、超时、AI 参数等常量 |
| `error-utils.ts` | 错误消息提取 |
| `http-utils.ts` | HTTP 请求工具 |
| `lru-cache.ts` | LRU 缓存 |
| `markdown-utils.ts` | Markdown 解析 |
| `skill-utils.ts` | 技能/MCP 解析工具 |
| `prompt-enrichment.ts` | 提示词增强（注入记忆上下文） |

### 核心基础设施

| 文件 | 说明 |
|------|------|
| `websocket.ts` | WebSocket 服务（`/ws`），广播消息到所有客户端 |
| `event-bus.ts` | 服务端事件总线，基于 EventEmitter |

## 关键数据模型

数据存储在 `~/.ai-dev-workbench/` 目录下：
- `config.json` -- 全局配置
- `requirements/` -- 需求（每个需求一个文件夹）
- `plans/` -- 开发计划
- `executions/` -- 执行记录
- `tests/` -- 测试结果
- `tasks/` -- 多任务
- `agent-executions/` -- Agent 执行记录
- `memory/` -- 记忆子系统
- `analytics/` -- 分析数据
- `pipelines.json` -- 管线配置

## 测试覆盖

已有 10 个测试文件（`*.test.ts`），覆盖部分服务层。缺失：
- 路由层测试
- `cli-providers/claude-provider.ts` 和 `codex-provider.ts` 测试
- `agent-coordinator.ts` 测试
- `task-scheduler-service.ts` 测试
- 大部分存储服务测试
- 前端测试

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-07-21 | 创建 | 初始化模块文档 |
