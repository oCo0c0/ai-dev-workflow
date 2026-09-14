# Pi 引擎重构实施计划 —— pi 从 SDK 嵌入切换为底层 harness（RPC 子进程）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 pi 引擎「执行开始后卡死（工具执行完无响应）」的问题，消除 SDK 进程内嵌入带来的结构性风险，将 pi 改造为与 Claude/Codex SDK 并存的「子进程 harness」形态（对标 DeepSeek Harness / OpenCode 的底层接入方式）。

**Architecture:** adw 服务进程不再 `import('@earendil-works/pi-coding-agent')` 在进程内跑 agent 循环，而是按工作区托管长驻 `pi --mode rpc` 子进程（stdin/stdout JSONL 双向协议），事件归一化层（thinking/tool_use/tool_result）保持 `CLIProviderOptions.onOutput` 契约不变；权限确认走 pi 官方扩展 `tool_call` + `extension_ui_request(confirm)` 协议；MCP 由平台网关新增内部 REST 面，经 pi 扩展 `registerTool` 投影。Claude / Codex 两个 Provider 保持 SDK 兼容不动。

**Tech Stack:** TypeScript (ES2022/CommonJS 服务端)、pi `--mode rpc` 官方 JSONL 协议（`@earendil-works/pi-coding-agent/rpc-entry` 入口）、pi 扩展 API（`pi.on("tool_call")` / `pi.registerTool()` / `pi.ui.confirm()`）、现有 `platform/`（tool-catalog / mcp-gateway）、Vitest。

---

## 0. 背景分析报告（现状 + 根因，已核实）

### 0.1 本次未提交改动盘点（21 文件，+1553/-733，分支 feature/adw-dsh-plugin）

| 改动 | 内容 | 评价 |
| --- | --- | --- |
| **新增 `src/server/platform/`**（4 源文件 + 2 测试 + README） | 引擎无关内核：`ToolCategory` 分类目录、平台工具注册表、MCP 聚合网关（上游连接池/熔断/懒连接；Claude 走 HTTP 挂载、pi 走 customTools 投影） | ✅ 方向正确，测试齐全，保留 |
| **`pi-provider.ts` 重写**（+567 行级） | in-memory 会话 → 文件会话（`~/.ai-dev-workbench/pi-sessions/`）；`supportsPermission` false→true（`beforeToolCall` 权限门）；MCP customTools 注入；10 分钟工具看门狗；模型错误（stopReason=error）透传；启用 grep/find/ls | ⚠️ 功能对齐了，但引入 4 处不规范用法（见 0.3）与卡死风险（见 0.2） |
| **`agent-coordinator.ts`** | STEP_TOOLS 硬编码 Claude 工具名 → `isStepWorthyTool` 分类判定；新增「排队回复自动续跑」+「立即处理中断续跑」外层循环 | ✅ 保留 |
| **`types.ts` / `bridge-json-runner.ts` / `cli-runner-service.ts`** | `McpStdioMap` → `McpServerMap`（stdio 直挂 \| http 网关，网关未启动回退 stdio） | ✅ 保留 |
| **`mcp-config-service/registry`** | 上游 server 可选 `cwd` 字段（防误认项目目录） | ✅ 保留 |
| **前端 6 文件 + MessageJumpBar 新组件** | 权限弹窗、思考面板、执行步骤、消息跳转等 UI | ✅ 保留（随 Phase 3 微调） |
| **杂项** | `tmp-test-find2.ts`（调试残留，应删）；`package.json`/`pnpm-lock.yaml` 415 行变动 | ⚠️ 清理 |

### 0.2 「pi 执行卡死」根因分析（按可能性排序，均给出源码证据）

**候选 1 —— 权限确认 3 分钟无声等待（最符合症状）**
症状是「第一个工具执行完后没响应」。典型序列：第一个工具是只读（`read/grep/find/ls` → `shouldConfirmTool=false` 放行，能看到执行完成）→ 第二个工具是 `bash/edit/write/mcp` → `beforeToolCall` 挂起等 `confirmPermission`。若前端弹窗未弹出/未被注意，则静默等待 3 分钟（`PERMISSION_TIMEOUT_MS`）→ 自动拒绝 → 模型收到 block 原因重试 → 又等 3 分钟……用户感知即为「卡住不动」。服务端有日志 `⏸ 等待确认工具：xxx`，但前端若弹窗丢失则几乎不可见。
证据：`pi-provider.ts` 超时文案自述「前端弹窗丢失时避免长时间无声挂起」——开发期间已遇到过。

**候选 2 —— pi agentLoop 对监听器异常零容忍，一旦命中即永久挂死（结构性，致命）**
- pi 的 Agent 事件派发是裸 `await listener(event, signal)`，**无 try/catch**（`packages/agent/src/agent.ts:631`）；`AgentSession._emit` 同样同步裸调（`agent-session.ts:591`）。
- `agentLoop()` 用 `void runAgentLoop(...).then(...)` 后台跑且**无 .catch**（`packages/agent/src/agent-loop.ts` 契约：错误编码为 stopReason，前提是所有监听器不抛错）。
- 因此任何订阅回调（含 adw 注入的 `onOutput` 链路）同步抛异常 → emit 拒绝 → 事件流永不结束 → `session.prompt()` 永不 resolve。
- adw 的 `completionPromise` 只在 `agent_end` / abort 信号 resolve；循环已死时 `agent_end` 永不到来 → `run()` 挂到天荒地老。
- **且 10 分钟工具看门狗只调 `session.abort()` 不调 `resolveCompletion()`**——循环已死时 abort 也换不来 `agent_end`，「双保险」失效。

**候选 3 —— 每次 run 泄漏一个 AgentSession（放大器）**
官方 SDK 示例（`examples/sdk/11-sessions.ts`、`12-full-control.ts`）每次 `createAgentSession` 后必须 `session.dispose()`；adw 新实现从不 dispose——每个泄漏 session 持有 agent 订阅、文件监听、进程树追踪，多轮运行后资源堆积，加剧不稳定。

**候选 4 —— Windows 下 pi 工具实现挂死（历史实锤，已缓解未根治）**
仓库里的调试残留 `tmp-test-find2.ts` 就是此问题复现脚本：「find 工具在有效路径上挂死」（60s 看门狗）。provider 注释亦自证（「Windows 大仓库上会长时间阻塞甚至不终止」）。**SDK 嵌入形态下，pi 工具挂死 = adw 服务进程本身受害**——这是进程内嵌入的最大结构性缺陷。

**候选 5 —— MCP 网关懒连接（次要）**
pi 的 MCP 工具经 customTools 投影，首次调用触发上游 spawn（Windows npx 冷启动数十秒）+ `UPSTREAM_CALL_TIMEOUT_MS=120s`；命中熔断冷却（60s）时直接报错。表现为 MCP 工具调用长时间无输出。

> **共同结论**：根因 1/2/3 是本次「平台化改造」引入的回归面，根因 4/5 是 SDK 嵌入形态的固有风险。修候选 1/2/3 只能止血；**根治 = 把 pi 移出 adw 进程**（候选 4 自然隔离，候选 2 的爆炸半径从「adw 服务挂死」降为「子进程崩溃可重启」）。

### 0.3 已核实的「不规范用法」清单（无论选哪条路都应消除）

| # | 位置 | 问题 | 后果 |
| --- | --- | --- | --- |
| N1 | `pi-provider.ts` run() | 每次 `createAgentSession` 后从不 `session.dispose()` | 资源泄漏 |
| N2 | `pi-provider.ts` attachPermissionGate() | 直接整体覆盖 `session.agent.beforeToolCall` | 覆盖了 `AgentSession` 构造器安装的内部钩子（`agent-session.ts:488`，路由到扩展系统），打断 pi 扩展管线；pi 官方权限门挂载点是**扩展 `tool_call` 事件** |
| N3 | `pi-provider.ts` armToolWatchdog() | 看门狗只 `session.abort()`，不 `resolveCompletion()` | 循环死亡场景下挂死永不解除 |
| N4 | `pi-provider.ts` tool_execution_update 分支 | 读取 `evt.textDelta`，但 pi 实际字段是 `partialResult`（`agent-loop.ts` emit 形状） | 工具输出永远收集不到（步骤面板 stepLog 为空） |
| N5 | `pi-provider.ts` detect() | `version: 'pi-sdk'` 占位 | 系统页无法显示真实版本 |
| N6 | 仓库根 | `tmp-test-find2.ts` 调试残留 | 应删 |
| N7 | 工作区 | 全部改动混在一个未提交 diff 里 | 应按「平台层 / pi-provider / 编排层 / 前端」分层提交 |

### 0.4 「pi 作为底层」官方能力核实（pi 0.84.4 源码，全部已确认存在）

| 能力 | 官方通道 | 源码依据 |
| --- | --- | --- |
| 长驻子进程双向协议 | `pi --mode rpc` 或包导出 `@earendil-works/pi-coding-agent/rpc-entry`；stdin 收 JSONL 命令、stdout 出 JSONL 事件+响应；stdin 关闭即优雅退出 | `modes/rpc/rpc-mode.ts`、`rpc-entry.ts`、`package.json` exports |
| 一次性无头执行 | `pi -p --mode json "prompt"`，stdout 输出完整 `JsonAgentSessionEvent` 流 | `modes/print-mode.ts`、`modes/json-event.ts` |
| 命令集 | `prompt/steer/follow_up/abort/clear_queue/new_session/switch_session/get_state/set_model/get_available_models/set_thinking_level/compact/set_auto_compaction/bash/get_messages/get_entries/get_session_stats…` | `modes/rpc/rpc-types.ts` |
| 权限门 | 扩展 `pi.on("tool_call", handler)`（可 block、可改参）+ `pi.ui.confirm()` → RPC 模式自动映射为 `extension_ui_request {method:"confirm"}` ↔ `extension_ui_response {id, confirmed}` | `core/extensions/types.ts:890-954,1298`、`rpc-mode.ts createDialogPromise` |
| 工具注入 | 扩展 `pi.registerTool()`（动态注册自定义工具） | `core/extensions/types.ts:1308` |
| 会话 | `--session-dir` + `--session-id`/`--continue`/`--fork`/`--name`；运行中 `switch_session/new_session` | `cli/args.ts` |
| 模型 | 启动参数 `--provider/--model/--api-key`（支持 `provider/id:thinking` 简写）；运行中 `set_model/get_available_models`；环境变量注入各家 key（`DEEPSEEK_API_KEY/ANTHROPIC_API_KEY/…`） | `cli/args.ts` 帮助文本 |
| 工具集控制 | `--tools read,bash,edit,write,grep,find,ls,powershell` / `--exclude-tools` | `cli/args.ts` |
| 技能/扩展 | 原生 SKILL.md 发现（`--skill`/`--no-skills`）；`--extension/-e` 显式加载；`--no-extensions` 关发现 | `cli/args.ts` |
| 上下文压缩 | 内建自动 compaction，RPC 可 `compact`/`set_auto_compaction` | `rpc-types.ts` |
| 背压/关停 | 子进程内置 stdout 背压等待与 SIGTERM 优雅退出 | `rpc-mode.ts`、`output-guard.ts` |

> 结论：**「不对接 SDK、pi 直接作为底层」不需要 pi 侧做任何改造**，全部是官方一等公民能力。小龙虾/OpenCode 与 DeepSeek Harness 的「CLI 作为 harness」模式，pi 用 `--mode rpc` 即可等价实现。

---

## 1. 方案对比与决策建议

| 维度 | 方案 A：继续 SDK 嵌入（只修 0.2/0.3） | 方案 B：RPC 子进程 harness（推荐） |
| --- | --- | --- |
| 卡死根因 2（循环脆弱） | 只能防御性包裹自己的监听器；pi 内部异常仍无解 | 子进程崩溃/挂死 → 检活+重启，adw 主进程永不受害 |
| 根因 4（Windows 工具挂死） | 挂死拖住 adw 服务进程 | 天然隔离，超时 kill 子进程树 |
| 权限门 | 覆盖内部钩子（不规范，N2） | 官方扩展协议，`extension_ui(confirm)` 与 adw 弹窗一一映射 |
| 进程内依赖污染 | ESM dynamic import + pi 全家桶进 adw heap；pi 升级即可能破坏 adw | 版本锁定在子进程侧，adw 只依赖 JSONL 协议（约束在 `rpc-types.ts`） |
| 长会话/续接 | 每次 run 重建 session（恢复全量历史）成本高 | 长驻进程内保持会话热状态，`steer/follow_up` 免重建 |
| MCP | customTools 投影（继续可用） | 扩展 registerTool + 网关 REST（同样单一事实来源） |
| 改造量 | 小（半天级） | 中（2~3 天级，含测试） |
| Claude/Codex | 不动 | 不动（platform 层本就引擎无关） |

**建议：Phase 1 按方案 A 止血（小成本恢复 pi 可用），Phase 2 切换方案 B 作为目标态。** 方案 A 的修复在 B 落地后大部分随旧实现废弃，但 Phase 1 中的权限超时提示、看门狗兜底等语义会平移到 B。

**待确认决策点（见文末「执行确认」）：**
1. 是否接受「Phase 1 止血 + Phase 2 切换」两步走（推荐），还是直接跳到 Phase 2（期间 pi 不可用）？
2. pi 的 MCP：走「网关 REST + pi 扩展 registerTool」桥（推荐），还是 Phase 2 先不给 pi 引擎 MCP？
3. 会话目录沿用 `~/.ai-dev-workbench/pi-sessions/`（推荐，与 Claude 会话管理对齐）？

---

## 2. 任务分解

### Phase 0：诊断基线（半天，可与 Phase 1 并行）

#### Task 0.1：复现与插桩定位根因
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`（临时插桩）
**Steps:**
1. run() 事件订阅回调整体包裹 try/catch，异常时 `console.error('[pi] listener error', e)` 并原样重抛前先记录——验证候选 2。
2. `beforeToolCall` 挂起/唤醒/超时三处打点日志——验证候选 1。
3. 在真实工作区跑一次卡死任务，采集 adw 服务日志 + `~/.ai-dev-workbench/pi-sessions/` 会话 JSONL 尾部。
4. **Expected:** 明确命中候选 1 / 候选 2 / 其他，记录到本文档「根因结论」小节。
5. Commit: `chore(pi): diagnostic instrumentation (temporary)`

#### Task 0.2：清理调试残留
**Files:** Delete: `tmp-test-find2.ts`
**Steps:** 删除文件 → `git status` 确认 → Commit: `chore: remove temp diagnostic script`

### Phase 1：SDK 模式止血修复（1 天，独立可上线）

#### Task 1.1：run() 结束必 dispose session（N1）
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`
**Test:** `src/server/services/cli-providers/pi-provider.test.ts`
**Steps:**
1. 写失败测试：mock createAgentSession，断言正常/异常/中止三条路径都调用了 `session.dispose()`。
2. run() 用 `try { ... } finally { session.dispose(); }` 包裹（dispose 放在 return 之后 finally 中，注意先取 sessionId 再 dispose）。
3. 跑测试通过 → Commit: `fix(pi): dispose AgentSession after every run`

#### Task 1.2：权限门挂起可观测 + 不覆盖 pi 内部钩子（N2 + 候选1 缓解）
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`
**Steps:**
1. `attachPermissionGate` 改为**链式**：保存 `session.agent.beforeToolCall` 原值（pi 内部钩子），adw 门通过后调用原钩子返回其结果。
2. 权限请求发出时除 `onPermissionRequest` 外，同时 `options?.onOutput?.('', {type:'permission_pending', ...})`（或直接 onOutput 一行文本），保证日志面板可见「等待确认」状态。
3. 超时从 3 分钟降为 90 秒，且超时前 10 秒追加提示日志。
4. 手测 + 单测（门链调用顺序）→ Commit: `fix(pi): chain permission gate with pi internal hook, surface pending state`

#### Task 1.3：看门狗与 completion 双保险修正（N3 + 候选2 兜底）
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`
**Steps:**
1. `armToolWatchdog` 超时回调追加 `resolveCompletion()`；新增「整体运行级」看门狗（如 15 分钟无任何事件即 resolveCompletion + onError），防循环死亡永久挂起。
2. `session.prompt(...)` 单独 `.catch(err => lastErrorMessage = ...)`，避免 race 吞掉 prompt 拒绝。
3. Commit: `fix(pi): watchdog resolves completion; catch prompt rejection`

#### Task 1.4：工具输出字段对齐（N4）
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`
**Steps:**
1. 以 pi 0.84 `agent-loop.ts` 的 `tool_execution_update` 真实形状（`partialResult`）读取文本（bash 的 partialResult 内含输出文本，具体字段以 `core/tools/bash.ts` 为准），兼容旧 `textDelta`。
2. 手测：pi 跑一次 bash，步骤面板 stepLog 有内容。
3. Commit: `fix(pi): read tool partial output from partialResult`

#### Task 1.5：detect() 上报真实版本（N5）
**Steps:** 从 `import('@earendil-works/pi-coding-agent/package.json', {with:{type:'json'}})` 读 version（或子进程 `pi --version` 缓存）。Commit: `fix(pi): report real sdk version in detect`

### Phase 2：pi RPC harness Provider（目标态，2~3 天）

#### Task 2.1：PiRpcProcess 子进程管理类
**Files:** Create: `src/server/services/cli-providers/pi-rpc-process.ts` + `pi-rpc-process.test.ts`
**Steps:**
1. 写失败测试：fake child process（注入 spawn），验证——命令发送（带自增 id）、响应关联、事件回调、stdout 逐行解析、stderr 转发、进程退出（code≠0）触发 `onExit`、`send()` 在进程死后排队/重建。
2. 实现：
   - `start(cwd, args)`：spawn `node <resolve('@earendil-works/pi-coding-agent/rpc-entry')>`，`--session-dir ~/.ai-dev-workbench/pi-sessions/<encoded-cwd>`、`--provider/--model/--api-key`、`--tools read,powershell,bash,edit,write,grep,find,ls`、`-e <adw扩展路径>`、`--no-extensions`（关闭发现，只显式挂 adw 扩展）、`--no-context-files`（adw 自己注入 prompt 上下文）。
   - 凭证经 env 注入：把「模型供应商页」`pi:` 前缀记录映射为 pi 认的环境变量（`DEEPSEEK_API_KEY/ANTHROPIC_API_KEY/GEMINI_API_KEY/…`，见 `cli/args.ts` 环境变量表）。
   - 命令/响应按 `id` 关联（Promise map + 超时）；事件行（无 `type:'response'`）推给 `onEvent`。
   - 检活：每次 prompt 前 `get_state`，失败/超时 → kill 进程树 → 冷启重试一次。
   - 空闲回收：N 分钟无活动 dispose 子进程（会话已在文件，重建无损）。
3. 测试通过 → Commit: `feat(pi): PiRpcProcess jsonl subprocess manager`

#### Task 2.2：adw 平台扩展（权限门 + MCP 桥，单文件分发）
**Files:** Create: `resources/pi-extensions/adw-platform.ts`（构建后随包分发；开发期直引源码路径）
**Steps:**
1. 权限门：`pi.on("tool_call", async (event) => { if (!需确认(event.toolName)) return; const ok = await pi.ui.confirm(title, 摘要, {timeout: 90000}); if (!ok) return {block: true, reason: '用户拒绝'}; })`——分类规则与 `platform/tool-catalog` 一致（写死在扩展内：bash/powershell/edit/write/自定义工具需确认）。
2. MCP 桥：启动时 fetch adw 网关 `GET /api/platform/tools`（新增内部 REST，见 Task 2.3），对每个工具 `pi.registerTool({name, description, parameters, execute})`，execute POST `/api/platform/call`。失败降级为不注册（日志一行）。
3. 手测：`pi -e resources/pi-extensions/adw-platform.ts` 交互模式验证弹确认、MCP 工具可调。
4. Commit: `feat(pi): adw platform extension (permission gate + mcp bridge)`

#### Task 2.3：网关内部 REST 面
**Files:** Modify: `src/server/platform/mcp-gateway.ts` + 测试；Modify: `src/server/index.ts`（挂载）
**Steps:**
1. `GET /api/platform/tools`：聚合上游工具 + 平台原生工具 → `PlatformToolDefinition[]`（无副作用，可缓存 30s）。
2. `POST /api/platform/call`：`{name, args, source}` → 网关统一执行（复用现有超时/熔断）。
3. 仅监听回环 + 简单 token（启动时随机生成，经 env 传给子进程）。
4. Commit: `feat(platform): internal REST face for engine subprocesses`

#### Task 2.4：PiProvider 重写为 RPC 形态
**Files:** Modify: `src/server/services/cli-providers/pi-provider.ts`（重写 run/detect/confirmPermission/dispose）；保留 `shouldConfirmTool` 等纯函数
**Steps:**
1. `run(input, options)`：
   - 取/建该 cwd 的 PiRpcProcess（Map 缓存）；首跑发 `new_session`，续接 `switch_session` 或启动参数 `--session-id`。
   - `prompt` 命令 → 订阅事件流直到 `agent_end`（或 `agent_settled`）；事件归一化逻辑**复用现有 message_update/tool_execution_* 处理代码**（形状同 SDK，仅 `message_update` 需按 `JsonAgentSessionEvent` 去掉 `partial` 后的形状微调）。
   - `extension_ui_request {method:'confirm'}` → `options.onPermissionRequest({permissionRequestId: evt.id, ...})`；`confirmPermission()` → 写 `extension_ui_response {id, confirmed}`。**删除 beforeToolCall 覆盖逻辑**。
   - abort 信号 → `abort` 命令 + 本地 resolve；`message_end` 的 `stopReason==='error'` 透传（保留现有语义）。
   - thinking/tool_use/tool_result 归一化与现有 onOutput meta 契约完全一致（coordinator 零改动）。
2. `detect()`：`pi --version`（子进程,缓存）+ `get_available_models` 探测；模型解析优先级保持「显式 > 自动 > 自有配置」，自有配置经 env 注入。
3. `loadMcpServers()`：保持平台注册中心视图不变。
4. `dispose()`：杀全部子进程。
5. 单测：fake PiRpcProcess 注入，覆盖正常完成/中止/权限确认/模型错误/子进程崩溃重启五条路径。
6. Commit: `feat(pi): rewrite provider on rpc subprocess harness`

#### Task 2.5：runBridgeJson 单发通道
**Files:** Modify: `src/server/utils/bridge-json-runner.ts`（或 pi-provider 内 one-shot 分支）
**Steps:**
1. 结构化提取（任务分解/计划生成）改走 `pi -p --mode json --no-session "prompt"` 一次性进程：收集全部事件行 → 拼最终 assistant 文本 → 现有 `extractJsonValue` 校验重试（重试=新进程，天然隔离）。
2. Commit: `feat(pi): one-shot json mode for structured extraction`

### Phase 3：编排层与前端对齐（1 天）

#### Task 3.1：权限/确认 UI 通道统一
**Files:** Modify: `src/server/services/agent-coordinator.ts`、`src/client/pages/AgentExecutionPage.tsx`、`src/client/pages/ExecutionPage.tsx`
**Steps:**
1. 权限请求负载增加 `origin: 'pi-extension'` 标记；前端弹窗复用现有组件，确认后走既有 `confirm-tool` 路由（路由内部按 provider 分发到 extension_ui_response 或 bridge confirmPermission）。
2. 「允许并记住」白名单语义保持（coordinator 侧拦截：命中白名单的 pi 权限请求直接回 extension_ui_response confirmed=true，不打扰用户）。
3. Commit: `feat(ui): unified permission flow across engines`

#### Task 3.2：排队回复/中断映射到 steer/follow_up（增强，可选）
**Steps:** coordinator 的 queuedReply 在 pi 会话仍在流式时发 `follow_up` 命令（免重启轮次）；「立即处理」发 `abort` 后走既有外层续跑。手测多轮对话场景。Commit: `feat(pi): map queued replies to follow_up`

### Phase 4：回归、文档与分层提交（半天）

#### Task 4.1：全链路回归清单（手测脚本写入 `docs/plans/` 附录）
1. pi：新执行 → 多工具轮次 → 权限弹窗（允许/拒绝/记住）→ 思考面板 → 步骤面板 stepLog 有工具输出 → 中止立即生效 → 会话续接（重启 adw 服务后续跑）→ 模型错误（错误 key）显式报错不卡死 → MCP 工具调用（网关在线/离线两态）。
2. claude/codex：计划生成、执行、MCP 网关挂载回归（确认零破坏）。
3. `pnpm test` 全绿。

#### Task 4.2：文档更新
**Files:** Modify: `CLAUDE.md`、`src/server/CLAUDE.md`、`src/server/platform/README.md`
**Steps:** 架构描述更新（pi = RPC harness 子进程、扩展协议、网关 REST 面、环境变量凭证映射表）。Commit: `docs: pi harness architecture`

#### Task 4.3：分层提交整理
按顺序提交：`platform 层` → `coordinator/types` → `pi-provider(Phase1 修复)` → `前端` → `pi harness(Phase2)` → `docs`。每层 `pnpm test` 后提交。

---

## 3. 验收标准

1. **用户症状消失**：pi 执行不再出现「工具执行完后无响应」；任何异常路径 90 秒内必有可见反馈（弹窗/日志/错误）。
2. adw 服务进程在 pi 子进程被 `kill -9` / 工具挂死 / 断网时均不卡死：检活重启，执行标记失败并报明确原因。
3. 权限确认：pi 引擎与 Claude 引擎弹窗体验一致，「允许并记住」生效。
4. 多轮续接：服务重启后 pi 会话可续跑（`pi-sessions/` 文件为准）。
5. Claude / Codex 行为零变化（仅 McpServerMap 类型放宽）。
6. `pnpm test` 全绿；新增模块（pi-rpc-process、pi-provider、mcp-gateway REST）有单测覆盖。

## 5. 会话存储评估结论（2026-07-22 补充，回应「是否都在一个文件」）

| 数据 | 现状 | 一会话一文件? |
| --- | --- | --- |
| pi 会话 | `~/.ai-dev-workbench/pi-sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl`（pi 原生 JSONL，追加写） | ✅ 已是一会话一文件 |
| Claude 会话 | Claude SDK 自管（`~/.claude/`），adw 只存 sessionId 引用 | ✅（引擎侧管理） |
| Agent 执行记录 | `agent-executions/<executionId>.json`（写队列串行 + 原子替换） | ✅ 一记录一文件；⚠️ 但**每追加一条日志 = 整文件读改写**（实测最大单文件 1.1MB，chatty 的 pi 事件流会放大 IO） |
| 经典计划/执行 | `requirements/<requirementId>/plan.json` / `execution.json`（**一个需求的全部记录聚合在同一文件**，数组 + 保留上限） | ❌ 按需求聚合 |
| 历史遗留 | `executions.json.bak` / `plans.json.bak` / `requirements.json.bak`（旧全局单文件存储的迁移残留）；`pi-sessions/_diagnose*`（调试残留） | 已迁移，残留可清理 |

**建议**：本次 Phase 2 不动 store 结构（避免与 pi 重构混在一个 diff）。「执行日志追加式写入（JSONL 旁挂）」与「经典 plan/execution 按记录拆文件」列为后续独立小迭代；`.bak` 与 `_diagnose*` 残留零风险可直接清理。

## 6. Phase 2 实施记录（2026-07-22）

与原计划的偏差与决策（均已实施并测试）：

1. **进程模型改为 process-per-run**（原计划：per-cwd 常驻池）。理由：① 并发任务/任务分解与长执行不互相阻塞（无需互斥）；② 崩溃/看门狗清理边界清晰；③ 与 Claude bridge 的 query 模式同构。会话连续性由 `--session <file>` 文件恢复保证，旧 SDK 实现同样是每 run 重建会话，无体验回退。
2. **Task 2.5（一次性 json 模式）取消**：统一走 run()（process-per-run 天然具备隔离性；runBridgeJson 重试 = 新进程新 prompt），少一条代码路径。
3. **发现并修复旧实现的会话续接缺陷**：pi 的 `sessionId` 是会话头 UUID，文件名是 `<timestamp>_<sessionId>.jsonl`——旧实现 `${sessionId}.jsonl` 从未匹配过任何文件，**会话续接一直静默降级为新会话**。新实现 `findSessionFile()` 同时匹配 `<ts>_<id>.jsonl` 后缀与旧精确名。
4. **权限模式对齐 Claude bridge**：调用方未传 `onPermissionRequest`（经典 plan/execution 流程）时注入 `ADW_PERMISSION_MODE=auto-allow`，扩展全放行——否则经典流用 pi 时每个写工具会挂 90 秒后被自动拒绝。
5. **扩展零依赖分发**：`resources/pi-extensions/adw-platform.ts` 无运行时 import（纯 JSON Schema，避开 typebox 解析），参数校验走 pi 官方的 plain-JSON-Schema 分支（`pi-ai/utils/validation.ts:323` 已核实）。`package.json` files 增补 `resources/`。
6. **验证结果**：单测 48/48（pi-rpc-process 13 + pi-provider 12 + platform 23）；`tsc -p tsconfig.server.json --noEmit` 通过；真实子进程冒烟（rpc-entry 就绪 551ms / get_state / get_available_models=13 / 优雅 kill）通过。仓库预存 12 个环境依赖失败（mcp-config/sandbox/skills 测试读本机真实配置目录，与本次改动无关，建议另行做测试隔离）。

## 7. 风险与边界（按最终形态更新）

| 风险 | 缓解 |
| --- | --- |
| rpc 协议随 pi 升级变化（当前锁定 ^0.85.1） | 冒烟脚本协议点（get_state/get_available_models/prompt/agent_end）纳入本次单测锚定的形状；升级 pi 前先跑 pi-rpc-process 冒烟 |
| 每次 run spawn 子进程的冷启动开销 | 实测就绪 551ms（Windows），与旧 SDK 每 run 重建 AgentSession 相当 |
| 扩展文件加载失败（移动/删除） | Provider 侧 resolveExtensionPath 找不到时降级为无扩展运行（权限 auto-allow 语义保持、无 MCP 桥），不影响基础可用 |
| LLM 真实调用链路（含扩展权限弹窗 + MCP 桥）未在本轮自动化 | 验收清单（Phase 4 手测）覆盖：真实任务跑通工具轮次 + 弹窗允许/拒绝/记住 + MCP 在线/离线两态 |
