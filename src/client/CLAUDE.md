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
| 2026-09-24 | 修复 | 工具行配对战与收敛（`utils/agent-log-parse.ts` + `components/ToolEventRow.tsx` + `hooks/useParsedLogs.ts`）：① 配对改为「id 优先」——同一 id 的**真实结果可升级**服务端补写的合成结果（中断后工具其实已完成），真实结果不被合成结果覆盖，重复结果忽略；② 无 id 的结果按 **FIFO** 配对最早的待结果行（旧实现配到「最近一条未闭合行」，并行工具下会错配）；③ 未知 id 的结果行不再错配到无关工具行（真实记录里 3 条孤立结果此前会污染别的行）；④ 工具行新增 `stopReason`（interrupted / unsettled）与琥珀色「已中断」文案，未返回显示「未返回结果」，执行结束时由 `finalizeRunning` 兜底收敛，不再永久转圈。真实记录回放：262 工具行全部收敛（2 条中断行为 stopped） |
| 2026-09-20 | 修复 | UI 偏好跨来源不一致（用户报告 `electron .` 与 `dev:desktop` 设置不同）：根因有二——① 代码来源不同（dev:desktop 走 Vite 源码热更，`electron .` 走 dist 构建产物快照）；② 根本原因是 **localStorage 按 origin 隔离**：5173 / 生产随机端口 / 3000 各存各的，且桌面版生产模式每次 findAvailablePort 可能换端口导致设置"随机丢失"。修复：新增 `syncUiPreferences()`（app-store 末尾）+ 服务端 `/api/ui-preferences` GET/PUT（`services/ui-preferences-service.ts` → `~/.ai-dev-workbench/ui-preferences.json`，端口无关）——同步主题/语言/字体/字号/通知/透明度/配色/玻璃颜色/字体颜色/吉祥物/背景照片 12 项；localStorage 秒开回显 → 启动 GET 服务端为准合并（服务端为空则反向播种）→ 变更 400ms 防抖全量 PUT；applyPreferencePatch 校验 + 走各 applier 即时生效，快照对比防回环 PUT |
| 2026-09-20 | 修复+新增 | ① 自定义字体输入失效修复：FontTab 误改为「仅非内置项时显示输入框」导致选「自定义」后输入框永不出现，恢复始终显示（内置选中时空占位，直接输入即切自定义）；② 新增字体自定义（对齐插件「字体」页签）：ui.fontColor（enabled/color/weight/caretColor，localStorage）+ applyFontColorSettings —— 字体颜色覆盖 --foreground token（muted 次级保持层次）、字重挂 html font-weight 继承生效、光标颜色 caret-color 继承全局（独立于总开关）；FontTab 增总开关/颜色/字重/光标控件；③ 透明度公式重写：「调到最大也不透」根因是旧版把设置值直接当 alpha 系数（max=1 不衰减，而顶栏/侧栏基础 alpha 0.62/0.85 本就高），改为真透明度语义 factor = clamp(1.15 - v, 0.12, 1)（拉满玻璃底色只剩 ~12-15%，blur 保留可读），外观页签加「越大越透」提示 |
| 2026-09-20 | 更新 | 吉祥物改版：① 桌面端去重 —— MascotWidget 仅 Web 模式渲染（检测 `window.adwDesktop` 即 return null），桌面只保留独立悬浮窗；② 形象库重绘 `components/mascot/pets.tsx`（替代 BongoCat.tsx，已删）：三款自绘 kawaii SVG 形态 kitty 小猫喵 / shiba 柴犬君 / penguin 企鹅桑（大头圆眼双高光+腮红+物种特征：橘纹卷尾/白吻卷尾/呆毛橙嘴脚蹼），统一动画契约（.bongo-cat--{mood} 循环 + .bongo-cat__paw--l/--r 输入镜像钩子 + PawTap 命令式敲击）；③ app-store ui.mascot 增 form 字段（PetForm union，localStorage 持久化 + 合法性校验）；④ 悬浮面板「吉祥物」页签增形态卡片（PetAvatar 实时预览三选一，对齐 dsh-wallpaper-engine 形态卡片交互）；⑤ 输入镜像（Bongo Cat 敲键盘跟手）：键盘经主进程 before-input-event 捕获转发（无系统级钩子）、鼠标经 notifyInputActivity IPC，paw-side.ts 物理键盘左右分区映射左右爪，paw-tap.ts 命令式摘/挂类重触发动画免重渲染；桌面窗复用主 preload 接收 adw:pet-input |
| 2026-09-20 | 更新 | 悬浮快捷设置面板 + 桌面宠物：新增 `components/quick-settings/`（FloatingSettingsPanel 六页签右侧悬浮玻璃抽屉 + controls.tsx 行语法控件 + tabs-appearance/tabs-wallpaper 页签；外观页签含配色/玻璃颜色，经 `lib/appearance.ts` 的 applyAccent/applyGlassColor 注入 CSS 变量）；新增 `components/mascot/`（BongoCat 纯 SVG 打字猫、MascotWidget Web 右下角、PetRoot 宠物窗口分支）与 `hooks/useAgentActivity.ts`（独立 /ws 连接 → typing/happy/sad 心情推导）；`main.tsx` 增 ?pet=1 分支；原 AppearanceSection/WallpaperSection 改为引导卡片（功能全部迁入悬浮面板）；顶栏 Palette 按钮直达面板（原主题下拉移除，背景照片收进外观页签）；app-store 增 accent/glassColor/mascot/quickSettings 状态与持久化 |
| 2026-09-20 | 更新 | 壁纸功能前端落地（设计参考 dsh-wallpaper-engine，MIT）：新增 `types/wallpaper.ts`（数据模型）、`lib/wallpaper-media.ts`（canvas 缩略图生成 + MediaError 人话翻译）、`stores/wallpaper-store.ts`（localStorage 秒开缓存 + 服务端事实源合并、300ms 防抖持久化、`applyEffects` 统一注入 `--wp-*` CSS 变量 + body 属性、identity 不设合成层变量）、`components/wallpaper/WallpaperLayer.tsx`（body 下 z:-2 壁纸 + z:-1 scrim portal；播放意图/元素真实态分离、AbortError 自动补播、换源 pause+清 src 释放解码器）、`components/wallpaper/WallpaperPickerModal.tsx`（缩略图网格/类型过滤/隐藏恢复/上传）、`pages/settings/WallpaperSection.tsx`（八效果滑杆 accent 填充、胶囊开关、黑胶唱片、倍速/翻转/适配、遮挡暂停三档）；`index.css` 升级液态玻璃配方（镜面高光+内阴影三件套+模糊饱和度联动+@supports 回退+`body[data-wallpaper-active]` 可读性适配）；`SettingsPage` 新增 wallpaper 分区、`Layout` 挂载 WallpaperLayer；i18n 中英文齐备 |
| 2026-07-21 | 创建 | 初始化模块文档 |
