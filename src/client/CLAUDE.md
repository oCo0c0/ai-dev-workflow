[根目录](../../CLAUDE.md) > [src](./) > **client**

# Client 模块

## 模块职责

React 18 SPA 前端，提供 AI Dev Workbench 的可视化操作界面。包含页面路由、UI 组件库、全局状态管理、API 封装、WebSocket 实时通信、国际化等。

## 入口与启动

- **入口**：`main.tsx` -- 创建 React 根节点，注册 `BrowserRouter` 路由，初始化 i18n，检测 CLI Provider 配置状态
- **构建**：Vite 8，配置 `vite.config.ts`（根目录），`root: 'src/client'`
- **开发代理**：Vite dev server (5173) 代理 `/api/` -> `http://localhost:3000`，`/ws` -> `ws://localhost:3000`

## 对外接口

前端通过 `api.ts` 封装的 HTTP 函数与后端 REST API 通信：

| 函数 | 方法 | 说明 |
|------|------|------|
| `apiGet<T>(path)` | GET | 查询 |
| `apiPost<T>(path, body)` | POST | 创建 |
| `apiPut<T>(path, body)` | PUT | 更新 |
| `apiDelete(path)` | DELETE | 删除 |
| `pickFolder(title?)` | POST | 打开系统文件夹选择器 |

## 页面路由

| 路径 | 文件 | 功能 |
|------|------|------|
| `/` | `RequirementsPage.tsx` | 需求管理（首页） |
| `/projects` | `ProjectsPage.tsx` | 多任务/项目管理 |
| `/workspace` | `WorkspacePage.tsx` | 工作区浏览与文件预览 |
| `/plan` | `PlanPage.tsx` | 开发计划生成与管理 |
| `/execution` | `ExecutionPage.tsx` | 代码执行监控 |
| `/tests` | `TestsPage.tsx` | 测试运行与结果 |
| `/skills` | `SkillsPage.tsx` | AI 技能管理 |
| `/mcp` | `MCPPage.tsx` | MCP 服务器配置 |
| `/pipelines` | `PipelinesPage.tsx` | 工作流管线配置 |
| `/mineru` | `MinerUPage.tsx` | MinerU 文档解析 |
| `/agent-execution` | `AgentExecutionPage.tsx` | Agent 自主执行 |

## 关键依赖与配置

- **状态管理**：`stores/app-store.ts` -- Zustand store，管理需求、工作区、计划、执行、测试、UI 偏好等全局状态
- **WebSocket**：`hooks/useWebSocket.ts` -- 自动连接/重连（指数退避），将服务端事件分发到 Zustand store
- **国际化**：`i18n.ts` -- i18next 初始化
- **UI 组件**：`components/ui/` -- 基础 UI 组件（button、card、input、badge）
- **业务组件**：`components/` -- Layout、MarkdownContent、SetupWizard、BranchSelector 等
- **引导系统**：`guides/` -- react-joyride 引导功能
- **工具**：`lib/utils.ts`（通用工具）、`lib/token-estimator.ts`（token 估算）

## 数据模型

前端数据模型定义在 `stores/app-store.ts` 中，包括：
- `Requirement` / `RequirementDetail` -- 需求
- `WorkspaceInfo` -- 工作区
- `DevelopmentPlan` -- 开发计划
- `TestRun` / `TestResult` -- 测试
- `AgentExecution` / `AgentExecutionSummary` -- Agent 执行

## 测试与质量

- 当前无前端测试覆盖
- 无 ESLint / Prettier 配置

## 相关文件清单

```
src/client/
  main.tsx              # 入口
  index.html            # HTML 模板
  index.css             # 全局样式（Tailwind）
  api.ts                # HTTP 封装
  i18n.ts               # 国际化配置
  stores/app-store.ts   # 全局状态
  hooks/useWebSocket.ts # WebSocket hook
  hooks/useKeyboardShortcuts.ts
  guides/index.ts       # 引导系统入口
  guides/useGuide.ts    # 引导 hook
  lib/utils.ts          # 工具函数
  lib/token-estimator.ts
  pages/*.tsx           # 11 个页面
  components/*.tsx      # 业务组件
  components/ui/*.tsx   # 基础 UI 组件
```

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-07-21 | 创建 | 初始化模块文档 |
