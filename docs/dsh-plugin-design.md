# adw × DeepSeek Harness 插件化设计（dsh-adw）

> 版本：v0.2 · 状态：**已实现（M1+M2 主体）**，待用户在 web profile 安装验证
> 目标：把 adw 的「需求文档获取 → 选择工作区 → 执行需求开发任务」链路做成 DSH 的可插拔插件，在 DSH Web GUI 中直接使用。
> 实现：`packages/adw-requirement-core`（内核）+ `packages/dsh-adw`（双面插件），安装/验证命令见 `packages/dsh-adw/README.zh.md`。

---

## 1. 背景与目标

### 1.1 两边是什么

| | adw（ai-dev-workbench） | DSH（DeepSeek Harness） |
|---|---|---|
| 定位 | AI 开发工作台：需求管理 + 计划 + 编码 + 测试的独立 Web 应用 | Agent Harness：会话、工具、权限沙箱、agent 预设、子代理、目标续跑 |
| AI 执行 | 自带 bridge 子进程 / CLI Provider（Claude/Codex/Pi） | 自带完整 agent 循环（正是 adw 里 bridge/provider 那层的等价物） |
| 需求侧 | **独有**：需求源适配器（ONES/GitHub/generic）+ MCP 桥接 + 需求存储 | 无 |
| UI | 独立 React SPA（3000/5173 端口） | Web GUI（dsh web），cordis 插件化，侧边栏/中列 DOM 可扩展 |

**核心判断**：DSH 已覆盖 adw 的「计划生成 / 代码执行 / 测试验证」（即 agent 本体能力）；adw 对 DSH 的独特价值在**需求侧**——需求拉取（外部系统）、需求→开发任务的转换、以及跨需求的执行追踪。因此插件**不移植** adw 的 bridge / cli-providers / plan / execution / test 子系统，执行链路完全复用 DSH 自己的会话机制。

### 1.2 目标场景（用户视角）

1. 在 DSH Web GUI 侧边栏点开「需求工作台」（adw 面板）；
2. 输入 ONES 链接 / issue 编号（或搜索），拉取需求详情并保存；
3. 在需求详情上点「执行开发」，选择**工作区**（可再钉模式/权限），插件把需求内容渲染成开发 prompt，驱动一个**真实 DSH 会话**在所选工作区内执行；
4. 执行状态实时回写到需求卡片，可跳转会话查看真实轨迹；
5. 同时，任何会话里的 agent 也能直接调用 `adw_fetch_requirement` 等工具拉需求——用户说「帮我拉 CWXT-130341 并开发」，agent 自己取需求文档后开工。

### 1.3 非目标（明确不做）

- 不在插件内重新实现计划/执行/测试编排（DSH 会话即执行体）；
- 不做多任务调度看板（已有 dsh-task-board 插件，避免重复；需求执行记录自带轻量状态）；
- 不做 adw 前端整页移植（ MinerU / 分析 / 技能管理等页面留在 adw 本体）。

---

## 2. 研究结论：DSH 插件机制要点

（依据本机 `~/.dsh/profiles/web` 内实际安装的 `@linxin666/dsh-client-ui-task-board`、`dsh-ssh`、`dsh-client-ui-aionui-panel` 三个样板插件源码）

### 2.1 插件形态：一个 npm 包，两个半面

```
dsh-adw/
├── package.json          # dsh.bundle.patch → cordis.patch.yml；dsh.client → 浏览器半声明
├── cordis.patch.yml      # 向 web profile 注入插件行（- insert: [{id, name}]）
├── src/
│   ├── index.ts          # 宿主半：apply(ctx) + inject + Config（schemastery）
│   └── client/index.ts   # 浏览器半：apply(ctx)，构建产物 lib/client.js
└── lib/                  # tsc + tsdown 构建产物（index.js / client.js）
```

`package.json` 关键声明：

```jsonc
{
  "name": "@along/dsh-adw",
  "type": "module",
  "exports": {
    ".":        { "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" }
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-settings"],
      "platform": "web"
    }
  }
}
```

### 2.2 宿主半能拿到什么（`inject` 服务）

| 服务 | 用途 | adw 对应物 |
|---|---|---|
| `ctx.webServer.register(WebRoute)` | 注册 HTTP 路由（Express 风格 `(req,res)`） | Express Router `/api/requirements` 等 |
| `ctx.tools.register(defineTool(...))` | 注册 **agent 工具**（带 JSON Schema + 渲染） | 无（adw 的 agent 走 bridge） |
| `ctx.systemPrompt.section({...})` | 向所有 agent 注入公告段 | 无 |
| `installSettingsSection(ctx, ns, Config)` | 设置卡（Web GUI 设置页可编辑） | ConfigService |
| `ctx.effect(fn)` | 生命周期/释放 | — |

路由需自带 **loopback-only 信任栅栏**（`isLoopbackRequest`，dsh-ssh 同款）：插件路由会触发外部系统访问与配置写入，LAN 暴露的 dsh web 不得服务。

### 2.3 浏览器半能拿到什么（client runtime faces）

- `ctx.sessions`：会话列表快照 / `binding(id).session` → `rename / prompt(content,'queue') / command(line) / getSnapshot / subscribe`；
- `ctx.workspaces`：工作区列表 / `connectWorkspace(workspaceId)`（复用空白会话或新建）；
- `connection.api.agentPresets`：`select`（仅空白会话可换预设）、`list`；
- `session.command('/permission <id>')`：权限预设切换（read-only / workspace-write / danger-full-access）；
- **UI 无可用插槽**：侧边栏入口与中列视图走 **DOM 注入**（`[class*="sidebarCol"]` 下插入口行、`[class*="centerCol"]` 尾挂面板），MutationObserver 自愈；React 不拥有这些节点。
- 持久化：浏览器侧只有 localStorage；但**宿主半存在时可走宿主文件存储 + HTTP 路由**（本插件正是如此）。

### 2.4 安装与热插拔

```sh
dsh plugin --profile web add @along/dsh-adw     # 或 add link:D:/py_workspace/ai-dev-workflow/packages/dsh-adw
# 重启 dsh web 后生效（进程重启，不是页面刷新）
dsh plugin --profile web remove @along/dsh-adw  # 卸载后 GUI 原样还原
```

插件行写入 `~/.dsh/profiles/web/package.json` 的 `dependencies` + `dsh.profile.bundles`。拔掉即无痕，会话执行历史仍是普通 DSH 会话——这就是「可插拔」的保证。

---

## 3. 总体架构

```
┌─ DSH Web GUI（浏览器）───────────────────────────────────────────┐
│  侧边栏「需求工作台」入口（DOM 注入）                                │
│  └─ 中列 adw 面板：源目录/拉取 → 需求列表 → 需求详情                │
│        └─「执行开发」：选工作区(+模式/权限) → 生成开发 prompt        │
│            → connectWorkspace → session.prompt（真实 DSH 会话）    │
│            → 订阅会话快照 → 状态回写需求卡片 → 「查看会话」跳转       │
└──────────────┬───────────────────────────────────────────────────┘
               │ /api/dsh-adw/*（fetch/XHR，loopback 栅栏）
┌─ DSH 宿主进程 ───────────────────────────────────────────────────┐
│  dsh-adw 宿主半                                                    │
│  ├─ RequirementEngine                                             │
│  │   ├─ requirement-sources 适配器注册表（ones/github/generic）      │
│  │   ├─ McpBridge（MCP SDK stdio 连接池 + listTools 动态发现）       │
│  │   ├─ McpConfig（读写 ~/.claude/settings.json，与 adw 共享配置）   │
│  │   └─ RequirementStore（~/.dsh/dsh-adw/requirements.json）       │
│  ├─ /api/dsh-adw/* 路由族                                          │
│  ├─ agent 工具：adaw_fetch / adw_list / adw_search                 │
│  └─ systemPrompt 公告 + 设置卡（announceToAgent / enabled / 模板）   │
└──────────────────────────────────────────────────────────────────┘
```

**职责边界**：需求获取、存储、prompt 组装在**宿主半**（agent 工具与 UI 共享同一引擎与数据）；执行驱动在**浏览器半**（DSH 的会话驱动面只在客户端 runtime）。

---

## 4. 宿主半详细设计

### 4.1 RequirementEngine（移植自 adw，三件套原样保留架构）

从 `src/server/services/` 抽取以下模块为插件内核（见 §7 移植清单）：

- **requirement-sources/**（`types.ts` / `index.ts` / `ones-adapter.ts` / `github-adapter.ts` / `generic-adapter.ts` / `parsers.ts`）
  适配器注册表、`resolveAdapter` 路由（显式绑定 > matchServer 认领 > generic 兜底）、`installTemplate` 一键安装模板——**架构零改动**，未来新源在插件里同样「实现适配器 + 注册一行」。
- **MCPBridgeService**（纯传输层：连接池 / listTools 动态发现 / 按能力调用）——依赖仅 `@modelcontextprotocol/sdk`，抽取成本低。
- **MCPConfigService**：MCP server 配置继续存 **`~/.claude/settings.json` + `~/.claude.json`**——与 adw 本体共享同一份配置，用户在任一侧配置一次，两边可用。

抽取时的适配工作：

| 差异 | adw 现状 | 插件目标 | 处理 |
|---|---|---|---|
| 模块体系 | CommonJS（tsc，`.js` 后缀导入） | DSH 插件为 ESM | 抽取到独立 ESM 包（`packages/adw-requirement-core`），adw 本体改为依赖该包（见 §7.2） |
| 错误/日志 | 自有 logger | 保留（内核包不依赖 DSH） | 引擎层做纯函数/类，DSH 事项（路由、工具、公告）在外层 |
| 存储 | `~/.ai-dev-workbench/requirements/` 文件夹结构 | `~/.dsh/dsh-adw/requirements.json`（单文件 JSON，原子写） | Store 接口化；可选「导入 adw 旧数据」命令（M3） |

### 4.2 HTTP 路由族 `/api/dsh-adw/*`（浏览器半消费）

| 方法 & 路径 | 用途 | adw 对应 |
|---|---|---|
| `GET /sources` | 源目录：适配器元数据 + 各自已配置的 MCP servers + installTemplate | `GET /api/requirements/sources` |
| `POST /fetch` | `{input, serverName?, save?}` 拉取需求详情（默认保存） | `POST /api/requirements/fetch` |
| `POST /search` | `{query, serverName?}` 源内搜索 | `/api/requirements/search` |
| `GET /requirements` | 已保存需求列表（宿主文件存储） | `GET /api/requirements/saved` |
| `GET /requirements/:id` | 需求详情（含执行链接数组） | `GET /api/requirements/:id` |
| `DELETE /requirements/:id` | 删除 | — |
| `POST /requirements/:id/refresh` | 按原始 input 重新拉取覆盖 | — |
| `POST /servers` | 一键安装 MCP server（installTemplate + 凭据，写 ~/.claude） | `POST /api/mcp-servers` |
| `POST /servers/:name/test` | 连接测试 | `/api/mcp-servers/test` |
| `POST /requirements/:id/executions` | 浏览器半回报执行链接（sessionId/workspaceId/prompt/时间） | — |
| `PATCH /executions/:execId` | 回报执行结局（succeeded/failed/cancelled） | — |

全部路由带 loopback 栅栏 + JSON 体积上限（64KB，同 dsh-ssh 惯例）。

**执行链接为何存宿主而非 localStorage**：需求是长期资产（跨浏览器、跨标签页、清缓存不丢），且 agent 工具将来也要读「这个需求开发到哪了」；存宿主让 UI 与 agent 共享同一事实源。（对比 task-board 纯客户端只能 localStorage，因为它没有宿主半。）

### 4.3 Agent 工具（宿主半注册，所有会话可用）

| 工具 | 参数 | 行为 |
|---|---|---|
| `adw_fetch_requirement` | `input`（ONES 链接 / `owner/repo#123` / 纯编号）, `serverName?`, `save?` | 经引擎拉取详情，返回结构化需求（标题/描述/验收标准/附件/关联），可选入库。**用户说「拉需求 XXX 并开发」时 agent 用它自助取文档** |
| `adw_list_requirements` | `status?`, `keyword?` | 列已保存需求（含执行状态摘要） |
| `adw_search_requirements` | `query`, `serverName?` | 源内搜索（不落库） |

输出 schema 沿用 dsh-ssh 的 `output.schema + render` 模式（markdown 表格渲染）。工具与路由、UI 调用同一个 `RequirementEngine`——GUI 里配置好的源，agent 立即可用，反之亦然。

### 4.4 开发 Prompt 模板（需求 → 会话指令）

默认模板（设置卡可改，占位符沿用 adw `renderPrompt` 习惯）：

```
基于以下需求完成开发任务。

## 需求：{{title}}（{{number}}）
{{description}}

## 验收标准
{{acceptanceCriteria}}

## 指令
在当前工作区内先理解相关代码结构，制定实现计划，然后完成编码与自测，
逐条核对验收标准后给出总结。与需求语言保持一致。
```

模板存设置（`devPromptTemplate`），浏览器半组装后可预览可编辑（执行前最后一眼）。

### 4.5 配置（schemastery，设置卡编辑）

```ts
interface Config {
  enabled?: boolean          // 总开关（默认 true）
  announceToAgent?: boolean  // 系统提示公告（默认 true）
  devPromptTemplate?: string // 开发 prompt 模板（默认见上）
  defaultServerName?: string // 默认 MCP server
}
```

### 4.6 系统提示公告（对齐既有插件文案风格）

> 本机已安装 dsh-adw 插件（DSH 的需求工作台）：侧边栏「需求工作台」入口；在 adw 仓库（packages/dsh-adw）维护。能力：从需求源（ONES / GitHub Issues / 通用 MCP）拉取需求文档——adw_fetch_requirement 按链接或编号取详情、adw_list_requirements 列本地需求、adw_search_requirements 源内搜索；需求可保存（~/.dsh/dsh-adw/）；用户在 GUI 中选择工作区执行需求开发（真实 DSH 会话，执行记录回写需求）。MCP server 配置与 adw 共享（~/.claude/settings.json）。限制：插件路由仅本机回环可用；拉取消耗外部系统配额。用户提到「需求 / 拉需求 / 需求工作台 / CWXT-xxx」时即指本插件，请据此协作。

---

## 5. 浏览器半详细设计

### 5.1 UI 结构（全部 DOM 注入，task-board 同款自愈机制）

```
侧边栏（[class*="sidebarCol"]）
 └─ 入口行「需求工作台」（图标 + 文案，收起栏显示图标）——插在「新会话」下方

中列（[class*="centerCol"] 尾挂节点，<html data-dsh-adw-active> 切换显隐）
 └─ adw 需求面板
     ├─ 顶部：源选择器（GET /sources）· 拉取输入框（链接/编号）· 搜索 · 返回聊天
     ├─ 需求列表：卡片（编号/标题/状态/优先级/来源/执行状态徽标/更新时间）
     └─ 需求详情：
         ├─ 描述（markdown 渲染）· 验收标准 · 附件/关联问题
         ├─ 执行历史（每次执行：时间/工作区/会话链接/结局）
         └─ 「执行开发」按钮 → 执行配置弹窗
              ├─ 工作区选择（ctx.workspaces.list，必选）
              ├─ 模式（agentPresets.list，可选，默认留空）
              ├─ 权限（read-only/workspace-write/danger-full-access，可选）
              └─ Prompt 预览（模板渲染结果，可临时修改）→ 确认执行
```

### 5.2 执行链路（复刻 task-board 的 ExecutionService，已验证的成熟路径）

```
run(requirement, target):
  1. 校验 workspaceId ∈ workspaces.list（失效钉子在本地即失败）
  2. sessionId = workspaces.connectWorkspace(target.workspaceId)
  3. session = sessions.binding(sessionId)
  4. if target.mode:   校验会话 blank → connection.api.agentPresets.select(sessionId, mode)
  5. if target.permission: session.command(`/permission ${id}`)，未被认领即失败
  6. session.rename(`[ADW] ${number} ${title}`)   ← 会话列表可辨识
  7. baseline = snapshot.turnEnds.size            ← 先记基线再发 prompt
  8. session.prompt([{type:'text', text: devPrompt}], 'queue')
  9. POST /requirements/:id/executions 记录执行链接
 10. 订阅快照：turnEnds 超基线且 !running → 结局 = lastAgentError ? failed : succeeded
 11. PATCH /executions/:id 回写结局 → 卡片徽标更新
```

恢复对账（页面刷新/重启后）：对无结局的执行链接，按「会话列表缺失→cancelled / 仍在跑→等 / 快照可见→按 lastAgentError / 历史 tail 有 turn/end error→failed / 否则 succeeded」判定（task-board reconcile 同款，幂等）。

**设计取舍**：需求执行不像 task-board 那样做 cron 定时（需求是一次性开发动作）；每需求允许多次执行（迭代），执行历史全留痕、会话可跳转。

---

## 6. 数据模型

```ts
/** 宿主存储：~/.dsh/dsh-adw/requirements.json（原子写，单写者） */
interface AdwStore {
  version: 1
  requirements: SavedRequirement[]
}

interface SavedRequirement extends RequirementDetail {   // 字段沿用 adw 模型
  source: {
    adapterId: string        // ones / github / generic
    serverName: string       // 拉取所用 MCP server
    input: string            // 原始输入（refresh 复用）
    fetchedAt: string
  }
  executions: ExecutionLink[]
}

interface ExecutionLink {
  executionId: string
  sessionId: string          // DSH 会话 id（跳转转录）
  workspaceId: string
  mode?: string              // agent 预设
  permission?: string
  prompt: string             // 实际发出的开发 prompt
  startedAt: string
  endedAt?: string
  outcome?: 'succeeded' | 'failed' | 'cancelled'
  error?: string
}
```

浏览器侧仅存 UI 偏好（面板宽度/折叠态，localStorage `dsh.adw.v1`），业务数据全在宿主。

---

## 7. 代码组织与移植清单

### 7.1 仓库布局（adw 转 pnpm monorepo，`pnpm-workspace.yaml` 已就位）

```
ai-dev-workflow/
├── packages/
│   ├── adw-requirement-core/     # ① 抽取：需求内核（ESM，零 DSH 依赖）
│   │   ├── src/
│   │   │   ├── requirement-sources/   # 适配器 + 注册表（原样迁移 + ESM 化）
│   │   │   ├── mcp-bridge.ts          # MCPBridgeService（连接池/动态发现）
│   │   │   ├── mcp-config.ts          # ~/.claude 配置读写
│   │   │   └── store.ts               # RequirementStore（JSON 文件实现 + 接口）
│   │   └── package.json               # deps: @modelcontextprotocol/sdk
│   └── dsh-adw/                  # ② DSH 插件（双面）
│       ├── src/
│       │   ├── index.ts               # 宿主半：引擎接线 + 路由 + 工具 + 公告
│       │   ├── host/routes.ts         # /api/dsh-adw/*
│       │   ├── host/tools.ts          # adw_* agent 工具
│       │   ├── host/loopback.ts       # 回环栅栏
│       │   ├── client/index.ts        # 浏览器半入口
│       │   ├── client/sidebar-entry.ts
│       │   ├── client/panel-mount.tsx # 中列面板
│       │   ├── client/panel/*.tsx     # 源选择/列表/详情/执行弹窗
│       │   ├── core/execution.ts      # 执行服务（task-board 模式）
│       │   └── core/api.ts            # /api/dsh-adw 客户端封装
│       ├── cordis.patch.yml
│       └── package.json               # deps: adw-requirement-core, schemastery
│                                   # devDeps: @deepseek-ai/dsh-* SDK（无需 DSH 源码检出）
├── src/                              # adw 本体（services 改为 re-export 内核包）
└── pnpm-workspace.yaml               # packages: ['packages/*']
```

### 7.2 移植清单（adw → 插件）

| adw 源文件 | 去向 | 改造 |
|---|---|---|
| `services/requirement-sources/*`（6 文件） | `adw-requirement-core` | ESM 化（去 `.js` 导入后缀/`verbatimModuleSyntax`），其余零改动 |
| `services/mcp-bridge-service.ts` | `adw-requirement-core/mcp-bridge.ts` | 同上；去除对 adw websocket 的依赖 |
| `services/mcp-config-service.ts` | `adw-requirement-core/mcp-config.ts` | 同上；保留 ~/.claude 双文件读写 |
| `services/requirement-store-service.ts` | `adw-requirement-core/store.ts` | 存储位置参数化（adw 传 `~/.ai-dev-workbench/`，插件传 `~/.dsh/dsh-adw/`） |
| `routes/requirements.ts` 的语义 | `dsh-adw/host/routes.ts` | Express Router → WebRoute + 回环栅栏 |
| `prompts/plan.ts` 的模板思想 | `dsh-adw` Config 默认模板 | 新写 DEV_PROMPT（见 §4.4） |
| adw 本体 `src/server/services/*` | 改为 `export ... from 'adw-requirement-core'` | 兼容既有导入路径，行为不变 |

**不移植**：bridge/、cli-providers/、plan/execution/test 路由与服务、mineru、analytics、task-scheduler、memory、前端整页。

### 7.3 构建与发布

- 内核包与插件各自 `tsc + tsdown`（client 半用 DSH 的 client bundle preset，样板插件自带可复制配置）；
- 发布：`@along/adw-requirement-core` + `@along/dsh-adw` 到 npm（或私有 registry）；开发期 `dsh plugin --profile web add link:D:/py_workspace/ai-dev-workflow/packages/dsh-adw`；
- 测试：内核包沿用 adw 的 vitest 用例（`requirement-sources/index.test.ts` 等直接跟着走）；插件半补 routes/tools/execution 的假件测试（task-board 的测试布局可照抄）。

---

## 8. 分期落地

### M1 — MVP：拉需求 + 选工作区 + 真实执行（本设计的核心链路）
- [ ] 抽取 `adw-requirement-core`（ESM 化 + 测试迁移通过）
- [ ] 插件宿主半：引擎接线、`/sources` `/fetch` `/requirements*` `/executions*` 路由、公告、设置卡
- [ ] 插件浏览器半：侧边栏入口、面板（源选择/拉取/列表/详情）、执行弹窗（工作区必选 + 模式/权限可选 + prompt 预览）、执行服务 + 状态回写 + 恢复对账
- [ ] 手工验收：ONES 链接拉取 → 选工作区执行 → 会话真实跑完 → 卡片回写 → 刷新不丢 → 卸载还原

### M2 — agent 自助与源生态
- [ ] `adw_fetch/list/search_requirement` 三工具 + 输出渲染
- [ ] 源一键安装（installTemplate 表单 + `POST /servers` + 连接测试）
- [ ] 源内搜索 UI、`refresh` 重拉
- [ ] 附件图片服务（ONES PKCE 下载，详情内嵌图）

### M3 — 打磨与互通
- [ ] 从 `~/.ai-dev-workbench/requirements/` 导入旧 adw 需求
- [ ] 执行结局双向回写需求源状态（如 ONES 状态流转，走适配器扩展点）
- [ ] MinerU 附件解析接入（描述增强）
- [ ] 发布 npm + 文档（README 双语，对齐样板插件）

---

## 9. 风险与开放问题

| # | 风险/问题 | 影响 | 对策 |
|---|---|---|---|
| 1 | DSH 处于 rc（0.1.0-rc.x），client runtime API 与 DOM 结构可能变（task-board 已经历 rc.6→rc.7 布局变更） | 浏览器半可能需跟改 | DOM 探测双选择器（新旧布局都试）；devDeps 锁 DSH SDK 版本；跟随样板插件升级 |
| 2 | adw 服务层 CJS → ESM 抽取的编译面 | 内核包工作量 | 内核包独立 tsconfig（ESM only）；adw 本体若暂不迁移，可短期双格式发布（module/exports 双入口） |
| 3 | MCP stdio 子进程在 DSH 宿主内拉起（npx 等） | 首次拉取慢/宿主环境差异 | 连接池 + 空闲回收（引擎已有）；连接测试路由提前暴露问题 |
| 4 | 凭据安全（ONES token 等写 ~/.claude） | 与 adw 现状一致 | 沿用 adw 策略；路由回环栅栏；不在公告/工具输出中回显凭据 |
| 5 | 同一需求并发多次执行 | 执行历史语义 | 允许（迭代开发），每次独立链接；列表徽标显示「最新一次」 |
| 6 | 需求执行是否要限制权限默认值（danger-full-access 危险） | 误操作 | 弹窗默认 workspace-write；danger 需二次确认 |
| 7 | 开放：插件名与 npm scope（`@along/dsh-adw` vs 独立名） | 发布 | 待定，不影响代码结构 |
| 8 | 开放：执行链接是否也镜像一份到 localStorage（宿主重启间隙 UI 兜底） | 体验 | M1 不做，观察需要 |

---

## 10. 一页总结

**做成什么样**：一个双面 cordis 插件 `dsh-adw`。宿主半移植 adw 的需求源适配器 + MCP 桥接（抽成共享内核包 `adw-requirement-core`，adw 本体同源复用），暴露 `/api/dsh-adw/*` 路由与 `adw_*` agent 工具；浏览器半在 DSH GUI 里挂「需求工作台」面板：拉需求 → 存宿主 → 选工作区（可钉模式/权限）→ 模板渲染开发 prompt → `session.prompt` 驱动真实 DSH 会话 → 结局回写需求、会话可跳转。**不移植** adw 的执行体（bridge/plan/execution/test），DSH 会话即执行体——插件拔掉全还原，这就是可插拔。
