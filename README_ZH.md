# AI Dev Workbench

AI 驱动的智能开发工作台，将需求管理、智能规划、AI 辅助编码、自动化测试和 Git 变更追踪整合为统一的开发工作流。

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, Lucide Icons |
| **后端** | Express.js, TypeScript, WebSocket (ws), Model Context Protocol SDK |
| **AI 引擎** | Claude Agent SDK（持久化桥接进程） |
| **状态管理** | Zustand（客户端）+ JSON 文件持久化（服务端） |
| **测试** | Vitest, Jest, Playwright, PyTest（自动检测框架） |
| **CLI** | Node.js CLI，支持 `npx` 直接运行 |

## 功能特性

### 需求管理
- 通过 MCP Server 从 ONES/Jira/GitLab 获取和浏览需求
- 本地需求存储与搜索
- 支持多个 MCP Server 数据源切换

### 工作空间管理
- 选择和验证本地项目目录，自动检测项目类型（Node/Python/Java/Rust）
- 可拖拽、可折叠的三栏布局：工作空间 / 文件树 / 预览
- 递归目录浏览与文件内容预览
- **Git 变更视图** — Files/Changes Tab 切换，`git status` 变更列表（M/A/D/R/U 标记），unified diff 红绿语法高亮

### AI 规划生成
- 结合项目上下文分析需求，生成结构化的开发计划
- 规划过程中支持与 Claude 多轮对话
- 规划历史持久化存储（最多 50 条记录）
- 通过 WebSocket 实时流式输出

### AI 代码执行
- 使用 Claude Code CLI 逐步执行开发计划
- 暂停 / 重试 / 跳过 / 终止 控制
- 执行过程中支持多轮回复交互
- 执行历史持久化存储
- **自动触发测试** — 执行完成后根据 Pipeline 配置自动启动测试阶段

### 自动化测试
- 自动检测测试框架：Jest/Vitest、Playwright、PyTest
- 两种测试模式：**运行现有测试** 或 **AI 生成测试**（通过 Claude）
- Pipeline 集成，支持 `testStrategy` 配置
- 关联执行上下文，对刚开发完成的代码运行针对性测试
- 测试历史记录，通过/失败可视化展示

### 工作流 Pipeline
- 定义可配置的开发工作流模板
- 按阶段配置技能（plan / execution / test）
- MCP 工具选择与测试策略配置
- 默认 Pipeline 选择

### 技能管理
- 查看和管理 Claude Code CLI 技能配置
- 对 `~/.claude/commands/` 和 `~/.claude/skills/` 进行增删改查

### 自进化系统（Hermes 式）
借鉴 [Hermes Agent](https://github.com/nousresearch/hermes-agent) 的自进化架构，工作台从每次执行中学习，越用越顺手：
- **记忆系统** — 跨会话持久化用户偏好（语言、编码风格、框架选择）和项目特征（技术栈、测试框架、目录约定）
- **执行分析** — 追踪每次规划、执行、测试的成功/失败模式、技能效果和恢复策略
- **技能自动沉淀** — 从成功恢复模式中自动生成可复用技能（如"执行失败后成功 → 提炼修复策略"）
- **Curator 清理器** — 定期清理冗余、低置信度或长期未使用的自动生成技能
- **Prompt 增强** — 将学习到的上下文（用户画像 + 项目特征）注入每次 Claude 调用，提升输出相关性

### MCP 配置
- 通过 Web 界面管理 MCP Server 连接
- 测试服务器连通性
- 支持任何 MCP 兼容服务器

### 开发者体验
- WebSocket 实时更新，指数退避自动重连
- 键盘快捷键：`Ctrl+1-8` 导航、`Ctrl+G` 生成计划、`Ctrl+Enter` 启动执行、`Ctrl+T` 运行测试
- 深色 / 浅色主题切换
- 首次运行向导（CLI + MCP 状态检查）
- 跨平台文件夹选择器（Windows PowerShell / macOS osascript / Linux zenity）

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    浏览器 (SPA)                      │
│  React 18 + Zustand + Tailwind CSS + Radix UI       │
│  页面: 需求 | 工作空间 | 规划 | 执行 | 测试          │
│        技能 | MCP | Pipeline                         │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP REST + WebSocket
┌───────────────────────┴─────────────────────────────┐
│              Express.js 服务端 (3000)                 │
│  路由 → 服务 → 持久化存储 (~/.ai-dev-workbench)       │
│  WebSocket 广播异步进度更新                            │
└──────┬──────────┬──────────────┬─────────────────────┘
       │          │              │
  MCP Server   Claude CLI   Git / 文件系统
  (ONES/Jira)  (Agent SDK)  (status/diff/browse)
```

**Claude 桥接进程：** 一个持久化的 Node.js 子进程（`claude-bridge.mjs`）封装 Claude Agent SDK。通过 stdin 接收 JSON 请求，通过 stdout 流式返回响应，支持会话恢复 —— 避免每次请求都创建新进程的开销。

**异步操作模式：** 规划生成、代码执行、测试运行均为异步操作。端点立即返回任务 ID，然后通过 WebSocket `broadcast()` 流式推送进度。客户端实时更新 Zustand Store。

**双重持久化：** 活跃操作驻留在内存 Map 中以获得快速访问。完成后的记录持久化到 `~/.ai-dev-workbench/` 下的 JSON 文件（各最多 50 条）。

**自进化事件循环：** 服务端 EventBus 拦截所有 `broadcast()` 调用。分析和记忆服务订阅 `execution:complete` 和 `test:complete` 事件，自动记录结果、检测模式、增强后续 prompt —— 无需修改任何现有路由代码。

```
路由处理器 → broadcast() → eventBus.dispatch()
                               ├──→ AnalyticsService（模式检测）
                               ├──→ MemoryService（偏好学习）
                               ├──→ SkillDerivationService（自动技能生成）
                               └──→ WebSocket → 前端
```

## 环境要求

- **Node.js** >= 18.0.0
- **Claude Code CLI** — AI 规划生成和代码执行所必需
- **Git** — 工作空间变更追踪所必需
- MCP Server（可选）— 用于从 ONES/Jira/GitLab 获取需求

## 安装

```bash
npm install -g ai-dev-workbench
```

## 快速开始

```bash
# 全局安装后启动
ai-dev-workbench

# 或直接运行，无需安装
npx ai-dev-workbench
```

工作台会在可用端口启动本地服务器，并在终端显示访问地址。

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（前端热重载 + 后端）
npm run dev

# 生产构建
npm run build

# 运行测试
npm test
```

### 项目结构

```
src/
├── bridge/           # Claude Agent SDK 桥接进程
├── cli/              # CLI 入口、Banner、端口查找
├── client/           # 前端 (React + Vite)
│   ├── components/   # Layout、SetupWizard、UI 基础组件
│   ├── hooks/        # useWebSocket、useKeyboardShortcuts
│   ├── pages/        # 8 个页面组件
│   └── stores/       # Zustand 应用状态
└── server/           # 后端 (Express.js)
    ├── middleware/    # 请求日志、参数校验
    ├── routes/       # 10 个路由模块（35+ 端点）
    ├── services/     # 16+ 个服务类
    │   └── memory/   # 记忆子系统（画像、特征、反馈存储）
    ├── event-bus.ts  # 服务端事件总线（自进化循环核心）
    └── utils/        # 技能解析、Prompt 增强工具
```

## 配置说明

配置文件存储在 `~/.ai-dev-workbench/config.json`。首次启动时会运行配置向导。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `server.port` | 服务器端口（不可用时自动分配） | 动态 (3000-9000) |
| `server.host` | 服务器地址 | `localhost` |
| `claudeCodeCli.path` | Claude Code CLI 路径 | 使用系统 PATH |
| `ui.theme` | UI 主题（`dark` 或 `light`） | `dark` |

### 数据文件

所有持久化数据存储在 `~/.ai-dev-workbench/` 目录下：

| 文件 | 用途 |
|------|------|
| `config.json` | 应用配置 |
| `requirements.json` | 本地保存的需求 |
| `plans.json` | 开发计划（最多 50 条） |
| `executions.json` | 执行记录（最多 50 条） |
| `test-runs.json` | 测试运行记录（最多 50 条） |
| `pipelines.json` | 工作流 Pipeline 定义 |
| `saved-workspaces.json` | 已保存的工作空间 |
| `workspace-history.json` | 最近打开的工作空间路径（最多 10 条） |
| `analytics.json` | 执行分析记录（最多 200 条） |
| `memory/user-profile.json` | 用户偏好（语言、编码风格） |
| `memory/project-facts.json` | 按工作空间索引的项目特征（最多 20 条） |
| `memory/feedback-log.json` | 用户反馈记录（最多 50 条） |
| `logs/app.log` | HTTP 请求日志 |

## API 端点一览

| 模块 | 端点前缀 | 主要功能 |
|------|---------|---------|
| 需求 | `/api/requirements` | 获取、搜索、保存需求 |
| 工作空间 | `/api/workspace` | 工作空间管理、文件浏览、Git 状态/Diff |
| 规划 | `/api/plan` | 生成计划、多轮对话、历史记录 |
| 执行 | `/api/execution` | 启动/暂停/终止执行、日志流 |
| 测试 | `/api/tests` | 框架检测、运行测试、结果查询 |
| 技能 | `/api/skills` | Claude 技能文件管理 |
| 分析 | `/api/analytics` | 执行分析概览、模式检测、记忆系统管理 |
| MCP | `/api/mcp-servers` | MCP 服务器增删改查、连接测试 |
| Pipeline | `/api/pipelines` | 工作流模板管理 |
| 系统 | `/api/system` | 系统状态（CLI 可用性、运行时间） |

## 许可证

MIT
