[根目录](../../CLAUDE.md) > [src](./) > **server**

# Server 模块

## 模块职责

Express 后端服务层，提供 REST API、WebSocket 实时推送、AI Bridge 通信管理、文件系统持久化、MCP 协议集成、沙箱管理、任务调度等核心能力。

## 入口与启动

- **入口**：`index.ts` -- `createServer(port)` 工厂函数，组装中间件、服务实例、路由，创建 HTTP + WebSocket 服务器
- **开发入口**：`../dev-server.ts` -- 固定端口 3000 启动
- **编译**：`tsconfig.server.json`，CommonJS 模块，输出到 `dist/server/` + `dist/cli/`

## 对外接口

通过 Express Router 挂载到 `/api/*` 前缀，共 15 组业务路由 + 2 个平台 API 面（`/api/mcp` HTTP MCP、`/api/platform` REST，详见根级 CLAUDE.md 路由总览）。

## 内部结构

### routes/ -- 路由层（15 个文件）

| 文件 | 前缀 | 说明 |
|------|------|------|
| `requirements.ts` | `/api/requirements` | 需求 CRUD + agent 中介拉取/搜索 + 图片服务 |
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
| `model-providers.ts` | `/api/model-providers` | 自定义模型供应商（models.json）增删查、检测、导入、拉取模型列表 |
| `prompts.ts` | `/api/prompts` | AI Prompt 优化 |
| `wallpapers.ts` | `/api/wallpapers` | 壁纸库：清单、上传（octet-stream 原始字节流）、媒体流（sendFile Range 206）、缩略图、隐藏/恢复/删除、设置持久化 |

### services/ -- 服务层

**核心服务**：

| 文件 | 类名 | 说明 |
|------|------|------|
| `cli-runner-service.ts` | `CLIRunnerService` | CLI Provider Facade，统一代理 Claude/Codex/Pi |
| `cli-providers/types.ts` | -- | CLI Provider 接口定义（`CLIProvider`、`CLIProviderInput` 等） |
| `cli-providers/index.ts` | -- | Provider 注册表与自动检测 |
| `cli-providers/claude-provider.ts` | `ClaudeProvider` | Claude Code CLI Provider 实现（SDK） |
| `cli-providers/codex-provider.ts` | `CodexProvider` | OpenAI Codex CLI Provider 实现（SDK） |
| `cli-providers/pi-provider.ts` | `PiProvider` | Pi Provider——RPC 子进程 harness（`pi --mode rpc`），process-per-run，会话文件续接 |
| `cli-providers/pi-rpc-process.ts` | `PiRpcProcess` | pi RPC 子进程管理：JSONL 命令/应答（id 关联）、事件流回调、优雅退出/强杀、rpc-entry 解析 |
| `config-service.ts` | `ConfigService` | 全局配置管理（`~/.ai-dev-workbench/config.json`） |
| `requirement-agent-fetch.ts` | `RequirementAgentFetchService` | agent 中介需求拉取/搜索（标准 MCP 消费模式：AI 引擎动态面对已挂载 MCP 工具，读 schema → 自主选择与调用，JSON 契约输出；零源硬编码，新增需求源只需配置 MCP server） |
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
| `ones-image-service.ts` | `OnesImageService` | ONES 平台图片下载（PKCE 认证插件；`createAttachmentImageService` 按 server env 检测构建） |
| `memory/memory-service.ts` | `MemoryService` | 记忆子系统（项目事实/反馈日志/用户画像） |
| `memory/project-facts-store.ts` | `ProjectFactsStore` | 项目事实存储 |
| `memory/feedback-log-store.ts` | `FeedbackLogStore` | 反馈日志存储 |
| `memory/user-profile-store.ts` | `UserProfileStore` | 用户画像存储 |
| `analytics-service.ts` | `AnalyticsService` | 数据分析服务 |
| `skill-derivation-service.ts` | `SkillDerivationService` | （已废弃）技能自动派生 — 不再实例化 |

**需求文档模型**（源中立，`requirement-sources/`）：

| 文件 | 说明 |
|------|------|
| `requirement-sources/types.ts` | 中立数据模型（`Requirement`/`RequirementDetail`）与附件图片服务契约（`AttachmentImageService`） |
| `requirement-sources/parsers.ts` | 共享解析器（agent JSON 契约 → 数据模型映射，兼容驼峰/下划线） |
| `requirement-sources/index.ts` | 纯 re-export（types + parsers） |

需求拉取已全面 agent 中介化：`requirement-agent-fetch.ts` 让 AI 引擎动态面对已挂载的 MCP 工具（读 schema → 自主选择与调用 → JSON 契约输出），应用侧零源硬编码。原 per-source 适配器（ones/github/generic）与 `mcp-bridge-service.ts` 已删除——新增需求源（GitLab/Jira/任意 MCP）只需在 MCP 设置页配置 server，零代码。唯一源特定残留是附件图片认证插件（`createAttachmentImageService` 按 server env 检测，如 ONES PKCE）。

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
| `../platform/` | 引擎无关平台内核（工具分类目录/工具注册表/MCP 聚合网关 + `/api/platform` REST 面），见 `platform/README.md` |
| `../../resources/pi-extensions/` | adw 平台扩展（pi RPC 子进程内加载：权限门 + MCP 桥），零运行时依赖 |

## 关键数据模型

数据存储在 `~/.ai-dev-workbench/` 目录下：
- `config.json` -- 全局配置
- `requirements/` -- 需求（每个需求一个文件夹）
- `plans/` -- 开发计划
- `executions/` -- 执行记录
- `tests/` -- 测试结果
- `tasks/` -- 多任务
- `agent-executions/` -- Agent 执行记录（含 `sessionId` **与会话归属引擎** `sessionEngine`）
- `pi-sessions/<cwd 净化名>-<md5(cwd)>/` -- pi 引擎的原生会话文件（一会话一 jsonl，续接用）
- `claude-home/` -- Claude Code 的隔离配置目录（`CLAUDE_CONFIG_DIR`，其 `projects/<cwd编码>/<id>.jsonl` 即 Claude 会话）
- `codex-home/` -- Codex 的隔离配置目录（`CODEX_HOME`，其 `sessions/**/rollout-*.jsonl` 即 Codex thread）
- `memory/` -- 记忆子系统
- `analytics/` -- 分析数据
- `pipelines.json` -- 管线配置
- `wallpapers/` -- 壁纸库（uploads/ 文件、thumbs/ 缩略图、meta.json 元数据、settings.json 设置持久化，端口无关）

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
| 2026-09-24 | 修复 | **环境隔离补齐「工具执行能力」条目**（用户报「隔离后 shell/git 等默认工具不可用，只能靠浏览器工具干活」）：原隔离只搬了「配置/凭据」，漏掉让引擎自带工具能跑起来的条目，三个引擎逐一审计后修正 ——① **pi**：`~/.pi/agent` 的 `settings.json`（`shellPath` 是 bash 工具的 shell 解析首选，Git 装在非标准位置时**只有**这里能找到 bash）、`trust.json`（工作区信任）、`bin/`（`rg.exe`/`fd.exe`：grep/find 的二进制，缺失时 pi 会尝试联网下载）→ 新增 `seedIsolatedPiAgentHome()`；另发现 pi 默认激活工具集只有 `read,bash,edit,write`（`dist/core/sdk.js` 的 `defaultActiveToolNames`），grep/find/ls 默认不激活，而 `--tools` allowlist 会连带裁掉扩展工具（`agent-session.js`）→ 新增 `ensurePiDefaultTools()`：不动 `--tools`，改为在隔离 settings.json 里把 `defaultTools` 配全（与已有值取并集）；② **codex**：补 `.sandbox-bin/`（命令执行沙箱二进制 286MB）、`.sandbox/`、`.sandbox-secrets/`（没有这些 codex 无法执行命令）；③ **claude**：补 `CLAUDE.md`（用户全局指令）、`plugins/`（插件工具）。另将 `ensureIsolatedHome` 从「仅首次播种」改为「**既补缺失、绝不覆盖**」——存量安装（如本机）自动修复，无需删目录重来。真实端到端验证（隔离环境 + 真实 pi 子进程）：`write`→写入成功、`bash`→`git version 2.47.0.windows.1`、`grep`→`probe.txt:1: ok`、`find`→`probe.txt`，四个内置工具全部可用；确定性验证 20 项（播种/补缺/幂等/不覆盖/工具集并集）全过 |
| 2026-09-24 | 修复 | **codex 消息流按 SDK 真实契约重写**（三引擎一致性审计发现）：原实现判 `item.type === 'agentMessage'/'commandExecution'/'toolCall'`（camelCase），而 @openai/codex-sdk 的 ThreadItem 判别值是 **snake_case**（`agent_message`/`reasoning`/`command_execution`/`file_change`/`mcp_tool_call`/`web_search`/`todo_list`/`error`/`local_image`；事件 `thread.started`/`turn.started|completed|failed`/`item.started|updated|completed`）→ 一条都匹配不上，**codex 执行时消息流里既无助手文本也无工具行**。重写为两个归一化方法：`emitCodexItemStarted`（item 开始/更新 → tool_use，running）+ `emitCodexItemCompleted`（完成 → tool_result/文本/thinking，**先自愈补发漏掉的 tool_use**——file_change 等 item 只在补丁落定时发一次，没有 use 就没有行，结果会变孤儿）；映射：command_execution→bash（aggregated_output/exit_code→isError+退出码标注）、file_change→逐文件 write(add)/edit(其他)、mcp_tool_call→`server__tool`（前端渲染 MCP 行）、web_search/todo_list→web_search/todo_write、reasoning→thinking、agent_message→文本；同 id 去重（started/updated/completed 重复投递不重复出行）；turn.failed→exitCode 1 + stderr。验证：假 client/thread 驱动真实 provider 的端到端断言 15 项（thinking 恰一次、updated 不重复、失败命令带退出码、无 started 的 item 自愈、7 行工具全部配对、sessionId=threadId 等）+ 全量单测 27 文件 264 用例通过。pi 与 claude 侧同步复核：pi 的 tool_execution_start/end 同一 toolCallId 配对完整，claude 桥接逐 block 发射——三引擎现在同构 |
| 2026-09-24 | 新增 | **会话归属与跨引擎连续性**（用户报「历史任务再执行提示 pi 会话不存在或已失效」）：会话实体由各引擎自己托管（claude 项目目录 / pi 会话文件 / codex thread），应用此前只存一个不带引擎标记的 `sessionId`，换引擎后必然是无效指针。① `AgentExecution` 增 `sessionEngine`（产生会话的引擎 id），`updateSessionId(id, sid, engine)` 同步维护；② `CLIProvider` 增可选 `canResumeSession(sessionId, cwd)`，三个引擎各自判定（claude：隔离 home 的 `projects/*/<id>.jsonl`，缺失时从用户 CLI 目录**按需补迁**；pi：`resolvePiSessionFile` 三级查找；codex：threadId 的 rollout 文件 / 旧占位 id 的进程内映射）；③ 协调器 `resolveSessionForRun()`：引擎不匹配或会话已失效时**不再把无效 id 传下去静默开新会话**，改为写明确提示 + 用 `utils/transcript.js` 生成的对话摘要（≤12k 字符）注入本轮 prompt（`continuityBlock`），历史任务因此「带着上下文继续」而不是从头再来；④ codex 会话指针改为**真实 threadId**（此前是 `codex-<时间戳>`，只在进程内映射里 → 服务重启必定开新会话）；⑤ pi 会话目录键经 `normalizeWorkspacePath` 归一化（`D:/a/b` 与 `D:\a\b` 曾算出两个目录），并按 id 全库回退查找（工作区改名/移动后仍可续接）。确定性验证 38 项全过（含端到端断言：换引擎后下发的 prompt 含摘要且不带旧 sessionId） |
| 2026-09-24 | 修复 | 工具行永久转圈根因修复（claude-provider + agent-coordinator）：① `handleNotification` 改为 requestId → sessionId → 唯一在飞请求兜底三级归属，失配/兜底/丢弃都打日志（此前两处静默 `return` 直接吞事件，真实日志里 3 条结果因此找不到对应 tool_use 行）；会话映射删除加身份校验（避免旧请求清理掉新映射）；`sendAbort(requestId)` 按请求粒度中止。② 新增 `settlePendingToolCalls(executionId, reason)`：中断/中止**瞬间**收敛在飞工具（`synthetic:true, reason:'interrupted'`），轮末收敛未返回工具（`unsettled`），前端工具行因此立刻停止转圈；合成结果可被后到的真实结果覆盖。③ 新增 `runningExecutions` 单执行并发防护——重复 start/重放不再把同一执行跑成多个循环（日志曾出现 4 行重复「已中断」）。全部 18 个真实执行记录回放：344 个工具行 0 转圈 |
| 2026-09-20 | 更新 | 壁纸库服务端：新增 `services/wallpaper-store-service.ts`（WallpaperStoreService：uploads/thumbs/meta.json/settings.json，设置合并 + 数值夹取 + id 白名单防路径穿越）与 `routes/wallpapers.ts`（清单/上传/缩略图/媒体/更新/删除/设置读写）；上传走 `express.raw` octet-stream（与全局 express.json 互不干扰，2GB 上限），媒体流 `res.sendFile` 自动支持 Range 206（视频可拖动进度）；`index.ts` 注册 `/api/wallpapers`。全链路冒烟通过（上传/清单/Range/缩略图/设置/隐藏/删除/落盘） |
| 2026-07-23 | 修复 | 附件面板=解析输入清单：`requirement-store-service.downloadImages` 只保留「真实 http URL」或「已本地化且被文档引用」的附件；下载集=真实 URL 附件+`[Image:]` 引用（不再盲收全部无 URL hash 资源）；下载失败改写为明示未下载；`mcp-registry-service` 磁盘格式标准化 mcpServers 方言（兼容读旧格式，保存自动迁移） |
| 2026-07-23 | 修复 | ONES wiki 图片 0/N 全挂：任务描述 wiki 链接为 `/team/{t}/page/{uuid}`（无 space 段），`ones-image-service.getWikiPageUuids` 旧正则强制 space 段匹配不到 → 兜底拿任务 UUID 当 wiki 页必 404；放宽路由正则与 ai-dev-requirements 对齐（space 可选 + descriptionText 扫描 + URL 解码）。`requirement-store-service` 附件本地化范围收敛为图片 + Excel（xls/xlsx/xlsm），其他格式保留源链接；fetch prompt 加"图片标记原样保留"约束 |
| 2026-07-23 | 修复 | pi 引擎"agent 拉取看不到 MCP 工具"三重根因：① spawn 传 `--tools` 硬白名单静默禁用扩展平台工具（主因，已移除）；② 扩展工具注册从 `session_start` 挪到 async factory 顶层（pi 官方 await 语义，rpc 模式下 session_start 注册不进首轮模型工具清单）；③ 冷启动容错（网关 per-server 软超时 + 降级目录短冷却 + 扩展空目录重试 + `?servers=` 白名单定向枚举） |
| 2026-07-23 | 更新 | 需求拉取全面 agent 中介化：新增 `requirement-agent-fetch.ts`，删除 per-source 适配器（ones/github/generic）与 `mcp-bridge-service.ts`；pi 平台扩展读写权限分离 + servers 白名单 |
| 2026-07-21 | 创建 | 初始化模块文档 |
