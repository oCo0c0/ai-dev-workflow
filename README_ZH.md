# AI Dev Workbench

AI 驱动的智能开发工作台，集成了需求管理、智能规划、AI Agent 系统、AI 辅助编码、自动化测试和 Git 变更追踪的统一开发工作流。

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, Lucide Icons |
| **后端** | Express.js, TypeScript, WebSocket (ws), Model Context Protocol SDK |
| **AI 引擎** | Claude Agent SDK（持久化桥接进程） + Agent System |
| **Agent 系统** | Think-Act-Observe-Reflect 循环、质量优化循环、自适应策略 |
| **状态管理** | Zustand（客户端）+ JSON 文件持久化（服务端） |
| **测试** | Vitest, Jest, Playwright, PyTest（自动检测框架） |
| **CLI** | Node.js CLI，支持 `npx` 直接运行 |

## 功能特性

### 🤖 AI Agent 系统（核心升级）

工作台已从 workflow 升级为完整的 **Agent 系统**，支持智能自主执行和持续优化。

#### Agent 核心架构

**Think-Act-Observe-Reflect 执行循环：**
- **Think**：分析当前状态，规划下一步行动
- **Act**：执行具体工具和任务
- **Observe**：观察执行结果，评估质量
- **Reflect**：反思并生成改进建议

**工具执行可靠性：**
- 指数退避重试机制（最多3次）
- 超时控制（可配置）
- 降级策略（失败时使用备选方案）

**错误恢复系统：**
- 5种错误分类：网络错误、数据错误、逻辑错误、资源错误、超时错误
- 6种恢复策略：重试、降级、人工介入、跳过、终止、回滚

#### 循环优化系统

**自适应循环：**
- 迭代 1-2：quick-prototype（快速原型）
- 迭代 3-5：quality-optimization（质量优化）
- 迭代 6+：fine-polishing（精细打磨）

**质量优化循环：**
- 多维度质量评估（正确性、完整性、一致性、性能、安全性）
- 问题识别和改进生成
- 迭代优化直到达标（质量阈值 >= 0.85）

**成本优化器：**
- 三种策略：fast、balanced、thorough
- 预算约束下最大化价值
- Token 使用优化

#### 专业 Agent 类型

**1. RequirementAnalysisAgent（需求分析）**
- 深度分析需求，识别歧义和矛盾
- 生成可测试的验收标准
- 提供技术建议和工作量评估
- 最多3次迭代确保全面分析

**2. CodeGenerationAgent（代码生成）**
- 基于需求生成高质量代码
- 集成质量循环持续优化
- 自动生成单元测试
- 代码文档生成

**3. TestAgent（测试）**
- 自动生成测试用例
- 执行测试并分析覆盖率
- 识别测试漏洞和边界情况
- 支持多种测试框架（Jest、Vitest、Playwright、PyTest）

**4. CodeReviewAgent（代码审查）**
- 静态代码质量检查
- 安全漏洞检测（OWASP Top 10）
- 最佳实践验证
- 性能和可维护性评估

**5. DocumentationAgent（文档生成）**
- 从代码自动生成 API 文档
- README 和用户指南生成
- 代码分析和文档结构化
- 支持多种输出格式（Markdown、HTML）

#### 服务集成

**MCP Bridge：**
- 外部 MCP 工具调用
- 工具注册和执行
- 错误处理和重试

**Workspace Service：**
- 项目上下文获取
- 文件系统操作
- Git 状态和变更追踪

**CLI Runner：**
- 代码执行环境
- 测试运行
- 构建和部署集成

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
┌─────────────────────────────────────────────────────────────┐
│                      浏览器 (SPA)                            │
│  React 18 + Zustand + Tailwind CSS + Radix UI              │
│  页面: 需求 | 工作空间 | 规划 | 执行 | 测试 | 技能 | MCP    │
│        Pipeline | Agent 监控                                 │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP REST + WebSocket
┌───────────────────────────┴─────────────────────────────────┐
│              Express.js 服务端 (3000)                        │
│  路由 → 服务 → Agent 系统 → 持久化存储                      │
│  WebSocket 广播异步进度更新                                   │
├──────────┬──────────┬────────────┬────────────┬─────────────┤
│          │          │            │            │             │
Agent    MCP      Claude      Git /      Workspace    CLI
System   Server    CLI       文件系统    Service     Runner
         (ONES)   (Agent)   (status)    (上下文)     (执行)

Agent 系统架构：
┌─────────────────────────────────────────────────────┐
│  Agent Harness（核心执行器）                         │
│  - Think-Act-Observe-Reflect 循环                    │
│  - 工具协调和状态管理                                 │
├─────────────────────────────────────────────────────┤
│  Loop Engineering（循环优化）                        │
│  - 自适应循环（动态策略选择）                         │
│  - 质量循环（持续改进）                               │
│  - 成本优化器（预算约束）                             │
├─────────────────────────────────────────────────────┤
│  Professional Agents（专业 Agent）                    │
│  - RequirementAnalysisAgent                          │
│  - CodeGenerationAgent                               │
│  - TestAgent                                         │
│  - CodeReviewAgent                                   │
│  - DocumentationAgent                                │
├─────────────────────────────────────────────────────┤
│  Service Integration（服务集成）                     │
│  - MCP Bridge（外部工具）                             │
│  - Workspace Service（项目上下文）                   │
│  - CLI Runner（代码执行）                             │
└─────────────────────────────────────────────────────┘
```

**Claude 桥接进程：** 一个持久化的 Node.js 子进程（`claude-bridge.mjs`）封装 Claude Agent SDK。通过 stdin 接收 JSON 请求，通过 stdout 流式返回响应，支持会话恢复 —— 避免每次请求都创建新进程的开销。

**Agent 执行流程：**

```
任务输入 → Agent Harness
    ↓
Think（分析状态）
    ↓
Act（执行工具） → Tool Executor
    ↓                ↓
Observe（观察结果）  重试/降级
    ↓
Reflect（反思改进） → Quality Loop
    ↓
Decide（下一步决策） → Adaptive Loop
    ↓
完成 / 继续迭代
```

**异步操作模式：** 规划生成、代码执行、Agent 运行、测试运行均为异步操作。端点立即返回任务 ID，然后通过 WebSocket `broadcast()` 流式推送进度。客户端实时更新 Zustand Store。

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

## Agent 使用示例

### 需求分析

```typescript
const agentService = createAgentsService();

const result = await agentService.executeAgent({
    agentType: 'requirement-analysis',
    taskId: 'req-001',
    inputData: {
        requirement: '用户登录功能，支持邮箱和手机号登录，包含验证码和密码登录方式',
        title: '用户登录'
    },
    options: {
        targetQuality: 0.85,
        tokenBudget: 10000
    }
});

// 结果包含：
// - 需求类型分析
// - 歧义检测
// - 验收标准
// - 技术建议
// - 工作量评估
```

### 代码生成

```typescript
const result = await agentService.executeAgent({
    agentType: 'code-generation',
    taskId: 'code-001',
    inputData: {
        requirement: '实现用户登录API',
        language: 'typescript',
        framework: 'express'
    },
    options: {
        targetQuality: 0.9,
        includeTests: true,
        includeDocumentation: true
    }
});

// 结果包含：
// - 生成的代码
// - 单元测试
// - API 文档
// - 质量评分
```

### 文档生成

```typescript
const result = await agentService.executeAgent({
    agentType: 'documentation',
    taskId: 'doc-001',
    inputData: {
        code: 'export class UserService { ... }',
        language: 'typescript',
        docType: 'generate-api-doc'
    },
    options: {
        targetQuality: 0.8
    }
});

// 结果包含：
// - API 文档
// - 使用示例
// - 参数说明
// - 返回值描述
```

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
    ├── services/     # 20+ 个服务类
    │   ├── agent/    # Agent 核心系统
    │   │   ├── agent-harness.ts       # Agent 执行器
    │   │   ├── tool-executor.ts       # 工具执行器
    │   │   ├── agent-monitor.ts       # 监控系统
    │   │   ├── error-recovery.ts      # 错误恢复
    │   │   └── agent-service.ts       # Agent 服务
    │   ├── loop/     # 循环优化系统
    │   │   ├── adaptive-loop.ts       # 自适应循环
    │   │   ├── quality-loop.ts        # 质量循环
    │   │   ├── cost-optimizer.ts      # 成本优化
    │   │   └── loop-service.ts        # 循环服务
    │   ├── agents/   # 专业 Agent
    │   │   ├── requirement-analysis-agent.ts
    │   │   ├── code-generation-agent.ts
    │   │   ├── test-agent.ts
    │   │   ├── code-review-agent.ts
    │   │   ├── documentation-agent.ts
    │   │   └── agents-service.ts
    │   ├── memory/   # 记忆子系统（画像、特征、反馈存储）
    │   └── mcp/      # MCP 集成
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
| `agent.maxIterations` | Agent 最大迭代次数 | `5` |
| `agent.qualityThreshold` | Agent 质量阈值 | `0.85` |
| `agent.tokenBudget` | Agent Token 预算 | `50000` |

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
| `agent-runs.json` | Agent 执行记录（最多 100 条） |
| `analytics.json` | 执行分析记录（最多 200 条） |
| `memory/user-profile.json` | 用户偏好（语言、编码风格） |
| `memory/project-facts.json` | 按工作空间索引的项目特征（最多 20 条） |
| `memory/feedback-log.json` | 用户反馈记录（最多 50 条） |
| `logs/app.log` | HTTP 请求日志 |
| `logs/agent.log` | Agent 执行日志 |

## API 端点一览

| 模块 | 端点前缀 | 主要功能 |
|------|---------|---------|
| Agent 系统 | `/api/agents` | Agent 执行、状态查询、历史记录 |
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

## Agent API 文档

### 执行 Agent

```typescript
POST /api/agents/execute

{
    "agentType": "requirement-analysis" | "code-generation" | "test" | "code-review" | "documentation",
    "taskId": "string",
    "inputData": {
        // Agent 特定输入
    },
    "options": {
        "targetQuality": number,
        "tokenBudget": number,
        "maxIterations": number
    }
}

// 返回：
{
    "taskId": "string",
    "status": "running" | "completed" | "failed",
    "result": {
        // Agent 特定结果
    },
    "quality": number,
    "tokensUsed": number,
    "duration": number
}
```

### 查询 Agent 状态

```typescript
GET /api/agents/status/:taskId

// 返回：
{
    "taskId": "string",
    "status": "running" | "completed" | "failed",
    "progress": number,
    "currentIteration": number,
    "quality": number,
    "tokensUsed": number
}
```

### Agent 执行历史

```typescript
GET /api/agents/history?agentType=...&limit=10

// 返回：
{
    "history": [
        {
            "taskId": "string",
            "agentType": "string",
            "timestamp": "string",
            "status": "string",
            "quality": number,
            "duration": number
        }
    ]
}
```

## 性能优化

- Agent 系统集成质量循环，确保输出质量 >= 0.85
- 自适应策略选择，平衡速度和质量
- Token 预算约束，控制成本
- 工具执行失败自动重试和降级
- 错误恢复机制，提高鲁棒性

## 安全性

- Agent 执行环境隔离
- 工具调用权限控制
- 敏感数据脱敏处理
- 审计日志完整记录

## 贡献指南

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

MIT
