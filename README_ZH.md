# AI Dev Workbench (adw)

AI 驱动的智能开发工作台，打通「需求 → 规划 → 执行 → 测试 → 审查」的完整闭环，内置可插拔的多引擎 Agent 层（**Claude Code / OpenAI Codex / [pi coding agent](https://github.com/earendil-works/pi-coding-agent)**）。

```
拉需求 → 生成计划 → AI 执行 → 自动测试，一个本地工作台全部搞定
```

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, i18next（中文/EN） |
| **后端** | Express.js, TypeScript, WebSocket (ws) |
| **AI 引擎** | Claude Agent SDK（桥接子进程）· OpenAI Codex SDK · pi coding agent（RPC 子进程 harness） |
| **协议** | MCP（Model Context Protocol）——面向引擎的聚合网关 |
| **状态** | Zustand（客户端）+ JSON 文件持久化（服务端，`~/.ai-dev-workbench/`） |
| **测试** | Vitest（自测）· Jest / Playwright / PyTest / JUnit 自动检测（目标项目） |
| **CLI** | Node.js CLI（`adw`），支持 `npx` |

## 多引擎架构

三种引擎实现同一 `CLIProvider` 接口，支持运行时切换：

- **Claude Code** —— Claude Agent SDK 封装在常驻桥接子进程中（`stdin/stdout` 逐行 JSON，支持会话恢复）。
- **OpenAI Codex** —— Codex SDK 进程内嵌入。
- **pi coding agent** —— 以**无头 RPC 子进程**形态运行（`pi --mode rpc`，每次执行一个进程，经 `--session` 续接会话文件），进程内加载 `adw-platform` 扩展提供权限门与 MCP 桥。与 SDK 零耦合——引擎升级只需 RPC 协议保持兼容。

引擎无关的**平台层**（`src/server/platform/`）负责工具分类、原生工具注册表与 MCP 聚合网关：

```
                    ┌────────────────────────────┐
   MCP 清单 ────────┤        McpGateway          ├── /api/mcp       （HTTP MCP → Claude SDK）
   原生工具 ────────┤  上游连接池、崩溃重连        ├── /api/platform  （REST → pi 的 adw 扩展）
                    └────────────────────────────┘
```

权限确认统一经 Web 界面弹窗处理（允许 / 拒绝 / 记住），与引擎无关。

## 功能特性

### 需求管理
- 从 **ONES**、**GitHub Issues** 或任意 MCP 兼容源拉取需求（适配器热插拔：支持链接 / issue key / `owner/repo#N` 输入方言）
- 一需求一文件夹（`metadata.json` + `document.md` + `images/`）
- **MinerU 文档解析** —— PDF / Word / PPT / Excel / 截图附件转 Markdown（OCR、表格、公式）
- 本地搜索与全文浏览

### 规划与执行
- 结合项目上下文分析需求，生成结构化开发计划（支持多轮对话）
- 逐步执行，**暂停 / 重试 / 跳步 / 终止**，WebSocket 流式日志
- Pipeline 配置后执行完成**自动触发测试**
- 按阶段配置技能队列；任务导出 xlsx

### Agent 自主执行
- 长任务 Agent 会话，实时展示 **thinking / tool_use / tool_result** 事件流
- 副作用工具（bash / write / edit / 平台工具）**权限弹窗**：允许 / 拒绝 / 记住
- 子任务步骤跟踪、中断、排队答复，工作台重启后可续接会话

### 多任务调度
- 跨工作区并行任务编排（Coordinator 模式）

### 自动化测试
- 框架自动检测：Jest / Vitest / Mocha、Playwright、PyTest / unittest、JUnit / Maven / Gradle、通用命令行
- 运行现有测试、**AI 生成测试**、AI E2E 三种模式
- 可选 **Daytona 沙箱**（三阶段流程）与变更文件定向测试

### Pipeline · 技能 · MCP
- 可配置的工作流模板，按阶段设置技能 / MCP 工具白名单 / 测试策略
- 技能管理：内置模板与 Provider 外部技能合并去重
- MCP 服务器增删改查（stdio 与 HTTP）、连通性测试

### 模型供应商
- 自定义供应商记录（`models.json`）与 API Key；按引擎选择模型与思考强度
- pi 引擎：多供应商路由（DeepSeek / Anthropic / Gemini / Qwen / …），环境变量注入密钥

### 记忆与分析（自进化）
- 跨会话记忆：用户画像、项目特征、反馈日志
- 执行分析：成功/失败模式、技能效果
- Prompt 增强：将学习到的上下文注入 AI 调用

### 开发者体验
- WebSocket 实时更新，指数退避自动重连
- 键盘快捷键（`Ctrl+1-8` 导航、`Ctrl+G` 生成计划、`Ctrl+Enter` 启动执行、`Ctrl+T` 运行测试）
- 深色/浅色主题、中文/EN 界面、首次运行向导、跨平台文件夹选择器
- 可选 API Key 鉴权（`X-API-Key` 请求头）保护整个 `/api/*`

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                        浏览器 (SPA)                           │
│   React 18 + Zustand + Tailwind · 11 个页面 · 中文/EN        │
└──────────────────────────────┬───────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────┴───────────────────────────────┐
│                  Express.js 服务端（开发态 :3000）             │
│  路由（15 组）→ 服务 → 持久化                                 │
│                                                              │
│  cli-providers/             platform/（引擎无关）             │
│   ├─ claude → 桥接进程 ───── /api/mcp （HTTP MCP 面）         │
│   ├─ codex  → SDK            requirement-sources/            │
│   └─ pi     → RPC 子进程 ─── /api/platform（REST 面）         │
│                                       ↑ adw-platform 扩展    │
└──────────┬───────────────────────────┴───────────────────────┘
           │
   ~/.ai-dev-workbench/（JSON 持久化，一条记录一个文件/文件夹）
```

## 环境要求

- **Node.js** >= 18（开发用 pnpm）
- 至少一个 AI 引擎可用/已配置（Claude Code CLI、Codex，或 pi + 模型供应商 API Key）
- **Git** —— 工作区变更追踪
- 可选：MCP 服务器（需求源）、MinerU 服务（文档解析）、Daytona（沙箱测试）

## 安装

```bash
npm install -g @along/ai-dev-workbench
```

## 快速开始

```bash
# 全局安装后启动
adw

# 或免安装直接运行
npx @along/ai-dev-workbench
```

工作台会在可用端口启动本地服务器并打印访问地址，首次运行有向导检查引擎与 MCP 状态。

## 开发

```bash
pnpm install     # pnpm workspace
pnpm dev         # Vite (5173) + 后端 tsx (3000)，热更新
pnpm build       # 前端 + 后端 + bridge 生产构建
pnpm test        # vitest
```

### 项目结构

```
src/
├── bridge/               # Claude Agent SDK 桥接子进程
├── cli/                  # CLI 入口：端口查找、Banner
├── client/               # React SPA（11 个页面）
│   ├── components/       # Layout、SetupWizard、UI 基础组件
│   ├── hooks/            # useWebSocket、useKeyboardShortcuts
│   ├── pages/            # 需求、工作区、规划、执行、测试、
│   │                     # 技能、MCP、Pipeline、MinerU、Agent 执行、项目
│   └── stores/           # Zustand 应用状态
└── server/               # Express 后端
    ├── middleware/        # 日志、参数校验
    ├── routes/            # 15 组业务路由 + 2 个平台 API 面
    ├── services/
    │   ├── cli-providers/         # Claude / Codex / Pi 适配层（含 pi RPC harness）
    │   ├── requirement-sources/   # ONES / GitHub / 通用 MCP 适配器
    │   ├── memory/                # 用户画像、项目特征、反馈
    │   └── …                      # 各类存储、调度、协调器、测试、MinerU
    ├── platform/          # 引擎无关：工具目录/注册表 + MCP 网关
    └── utils/
resources/pi-extensions/   # adw-platform 扩展（pi 子进程内加载）
skills/  templates/  docs/plans/
```

## 配置说明

配置存于 `~/.ai-dev-workbench/config.json`（可在设置界面编辑）。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.port` / `server.host` | 监听端口（占用时自动分配）/ 主机 | 动态 / `localhost` |
| `ui.theme` | `dark` 或 `light` | `dark` |
| `auth.apiKey` | 可选；配置后所有 `/api/*` 需 `X-API-Key` 头或 `?apiKey=` | — |
| `auth.corsOrigins` | 允许的 Origin（不设 = 全部） | — |
| `daytona.apiUrl` / `daytona.apiKey` | 可选沙箱后端 | Daytona 云 |
| `cliProvider.active` | 当前引擎 id（内置或自定义记录 id） | 自动检测 |

### 数据目录

所有数据位于 `~/.ai-dev-workbench/`：

| 路径 | 用途 |
|------|------|
| `config.json` / `models.json` / `mcp-servers.json` | 配置、自定义模型供应商、MCP 清单 |
| `requirements/{id}/` | 一需求一文件夹：`metadata.json`、`document.md`、`images/`、计划与执行记录 |
| `agent-executions/` | 一次 Agent 自主执行一个 JSON |
| `pi-sessions/` | pi 引擎会话文件（原生 JSONL，一会话一文件，按工作区分目录） |
| `tasks/` | 多任务记录 |
| `memory/` | `user-profile.json`、`project-facts.json`、`feedback-log.json` |
| `analytics/` / `pipelines.json` | 执行分析、Pipeline 定义 |
| `logs/` | 应用日志 |

## 许可证

MIT
