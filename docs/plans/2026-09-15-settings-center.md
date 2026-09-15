# 设置中心(Settings Center)实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增独立 `/settings` 页面(左侧二级分类栏:外观/模型供应商/MCP/Skills),把主导航的三个入口收进设置;外观支持中英文字体、字号、主题、界面语言;供应商页布局优化+测试连接+默认模型;MCP 健康状态;配置导入/导出。

**Architecture:** 新建 `SettingsPage`(左侧分类栏 + 右侧内容区,section 由路由参数 `/settings/:section` 控制)。ModelProvidersPage/MCPPage/SkillsPage 保持独立组件不改内部逻辑,直接嵌入设置页渲染。外观设置(fontFamily/fontSize)进 app-store 的 ui 分片,沿用现有手写 localStorage 持久化模式,通过在 `<html>` 上挂 CSS 变量(`--app-font-zh/--app-font-en/--app-font-size`)生效,index.css 的 body font-family 消费该变量。

**Tech Stack:** React 18 + react-router v7 + zustand 4 + react-i18next + Tailwind v3(darkMode class)。无前端测试设施——每个任务用 `npx tsc --noEmit` + `npm run build` 验证,**UI 效果由用户启动应用手测(严禁自行启动 dev server/桌面应用)**。

**关键事实(已调研):**
- 侧边栏 navItems: `src/client/components/Layout.tsx:49-64`;pageTitleKeys: L69-81;折叠按钮在顶栏 L300-310;底部区域 L279-293 仅 WebSocket 状态(设置按钮加在这里)。
- 路由注册: `src/client/main.tsx:85-100`。
- store: `src/client/stores/app-store.ts` — ui 字段 L398-409(theme/locale/sidebarCollapsed/bgImage 已存在);applyTheme L644-665;locale 持久化 key 为 `'locale'`(L733/L842);主题 key `ai-workbench-theme`。
- i18n: `src/client/i18n.ts`,lng 取 localStorage `locale`;Layout 已有 `handleToggleLocale`(L208-212)可参考。
- index.css: Tailwind v3,`:root`/`.dark` CSS 变量,body font-family 在 L95(硬编码 Inter 栈)。
- MCPPage 已有 `status?: 'connected'|'disconnected'|'error'` 字段与 `POST /mcp-servers/{name}/test` 连接测试(L227-267)。
- ModelProvidersPage(846 行)无弹窗、左右分栏内联表单;API: GET/POST `/model-providers`、DELETE `/:id`、POST `/models/fetch`(凭据拉模型,复用为测试连接)、POST `/import`(已有导入)。
- 后端 `src/server/routes/model-providers.ts` 无 test 端点,本次不改后端。
- locales: zh.json/en.json 镜像结构,均无 `settings` 顶层 key;新增页面需同步 `nav`/`pageTitle`。
- 全局弹窗 ModelConfigModal/ProviderSetupModal 挂在 Layout L439-453,与页面无关,不动。

---

### Task 1: store 扩展——字体设置状态与持久化

**Files:**
- Modify: `src/client/stores/app-store.ts`(ui 接口 L398-409 附近、初始值 L730-735、actions 区 L816-844 附近)

**Step 1: 定义类型与状态。** 在 ui 分片新增:
```ts
fontFamilyZh: string;   // 中文字体栈,如 "'PingFang SC', 'Microsoft YaHei', sans-serif"
fontFamilyEn: string;   // 西文字体栈,如 "'Inter', 'Segoe UI', sans-serif"
fontSize: number;       // 基准字号 px,默认 14,范围 12-18
```
新增常量与 apply 函数(模仿 applyTheme 模式):
```ts
const FONT_KEY = 'ai-workbench-font';
// 读: localStorage.getItem(FONT_KEY) → JSON.parse,缺省 { fontFamilyZh: DEFAULT_ZH, fontFamilyEn: DEFAULT_EN, fontSize: 14 }
// applyFontSettings(): document.documentElement.style.setProperty('--app-font-zh', fontFamilyZh) 等三个变量
```
默认字体栈常量:
```ts
const DEFAULT_FONT_ZH = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const DEFAULT_FONT_EN = "'Inter', -apple-system, 'Segoe UI', sans-serif";
```
新增 actions: `setFontFamily(zh: string, en: string)`、`setFontSize(size: number)`——均写 localStorage 后调用 applyFontSettings。
store 初始化(L708-713 附近)调用一次 `applyFontSettings()`。

**Step 2: 验证。** Run: `npx tsc --noEmit` → 无错误。

**Step 3: Commit** `feat(client): store 新增字体/字号设置与 localStorage 持久化`

---

### Task 2: index.css 接入字体变量

**Files:**
- Modify: `src/client/index.css:95`(body font-family)

**Step 1:** 把 body 的 font-family 改为消费变量,带兜底:
```css
font-family: var(--app-font-en), var(--app-font-zh);
font-size: var(--app-font-size, 14px);
```
(西文栈在前,中文字符自动回落到中文栈——这是中英文字体分设生效的机制。)

**Step 2:** 同步检查 `.markdown-body`(L218+)是否硬编码 font-size,如有改为 `em` 相对单位或继承 body。

**Step 3: 验证。** `npm run build` 通过。

**Step 4: Commit** `feat(client): 全局字体接入 CSS 变量 --app-font-*`

---

### Task 3: 外观设置面板 AppearanceSection

**Files:**
- Create: `src/client/pages/settings/AppearanceSection.tsx`
- Modify: `src/client/locales/zh.json`、`en.json`(新增 `settings` 顶层 key)

**Step 1: locales。** 两个文件同步加 `settings` 对象(先只放本次用到的键):
```json
"settings": {
  "title": "设置",
  "nav": { "appearance": "外观", "modelProviders": "模型供应商", "mcp": "MCP", "skills": "Skills" },
  "appearance": {
    "fontZh": "中文字体",
    "fontEn": "西文字体",
    "fontSize": "字体大小",
    "theme": "主题",
    "themeLight": "浅色", "themeDark": "深色",
    "language": "界面语言",
    "fontPreview": "预览 The quick brown fox 采纳敏捷开发 0123",
    "reset": "恢复默认"
  },
  "data": { "export": "导出配置", "import": "导入配置", "exportDone": "配置已导出", "importDone": "配置已导入" }
}
```
(en 为对应英文。)

**Step 2: 组件。** 卡片式分区表单:
- 中文字体:下拉选择内置栈列表(PingFang/微软雅黑/思源黑体/Noto Sans SC/系统默认)+ 自定义输入框;选中即 `setFontFamily`。
- 西文字体:同上(Inter/系统 UI/Roboto/JetBrains Mono 等)。
- 字号:range 滑块 12–18 步进 1,旁边显示当前值,即时 `setFontSize`。
- 主题:两个选项卡按钮(浅色/深色)调 `setTheme`。
- 语言:两个选项卡按钮(中文/English)——复用 Layout `handleToggleLocale` 的逻辑(setLocale + i18n.changeLanguage)。
- 底部一个实时预览条用当前字体/字号渲染示例文案;“恢复默认”按钮重置为 DEFAULT 值。
样式沿用项目既有卡片风格(`glass-card`、`border-border/50`),参考页内其他表单写法。

**Step 3: 验证。** `npx tsc --noEmit`。

**Step 4: Commit** `feat(client): 外观设置面板——字体/字号/主题/语言`

---

### Task 4: 设置页骨架与路由迁移

**Files:**
- Create: `src/client/pages/SettingsPage.tsx`
- Modify: `src/client/main.tsx`(路由)、`src/client/components/Layout.tsx:49-64, 69-81, 279-293`、locales

**Step 1: SettingsPage。** 结构:外层 flex,左侧分类栏(宽 ~200px,响应式可收窄)四项:外观/模型供应商/MCP/Skills(lucide 图标:SlidersHorizontal/Cpu/Plug/Zap),点击跳 `/settings/<section>`;右侧根据 `useParams().section` 渲染对应组件:
- `appearance` → `<AppearanceSection/>`
- `model-providers` → `<ModelProvidersPage/>`
- `mcp` → `<MCPPage/>`
- `skills` → `<SkillsPage/>`
默认重定向到 `appearance`(用 `<Navigate to="/settings/appearance" replace/>`)。
注意:三个被嵌入页面当前是全屏布局(如 MCPPage 的左右分栏),嵌入后确认其根容器高度类(如 `h-full`)在设置内容区正常;若其内部用了 `useGuide`(Joyride)仍保留不动。

**Step 2: 路由。** main.tsx:新增
```tsx
<Route path="/settings" element={<SettingsPage/>}/>
<Route path="/settings/:section" element={<SettingsPage/>}/>
```
**保留** `/skills`、`/mcp`、`/model-providers` 三条旧路由(外部链接/引导兼容),内部各自 `<Navigate to="/settings/mcp" replace/>` 重定向。

**Step 3: Layout 迁移。**
- navItems 删除 model-providers、mcp、skills 三项(L60-62)。
- pageTitleKeys:删三条旧键,加 `/settings` → `pageTitle.settings`;locales 的 `pageTitle` 同步。
- 侧边栏底部(L279-293 WebSocket 指示区旁)加设置按钮:Settings 图标,点击跳 `/settings`,支持 sidebarCollapsed(收起时只显示图标,title 提示)。
- locales `nav` 加 `settings` 键(zh "设置" / en "Settings")。

**Step 4: 验证。** `npm run build`;确认无对已删 nav 项的残留引用(`grep -rn "'/mcp'\|'/skills'\|'/model-providers'" src/client`,仅允许 main.tsx 重定向处)。

**Step 5: Commit** `feat(client): 独立设置页 /settings,主导航三入口迁入`

---

### Task 5: 模型供应商页布局优化 + 测试连接 + 默认模型

**Files:**
- Modify: `src/client/pages/ModelProvidersPage.tsx`、`src/client/components/ModelConfigModal.tsx`(如默认模型入口在此)、locales `modelProviders`

**Step 1: 测试连接。** 页面表单操作区加“测试连接”按钮:
- 编辑表单有凭据时:调既有 `POST /model-providers/models/fetch`(L255 已有调用),成功 → 绿色提示“连接成功,可用模型 N 个”,失败 → 红色错误信息(ApiError message)。
- 列表项 hover 操作里也加测试图标(用已保存配置的凭据请求同一端点)。
- locales 加 `modelProviders.testConnection` / `testOk` / `testFail`。

**Step 2: 默认模型。** 在供应商表单“模型”分区加“设为默认模型”标记(单选 radio 语义,存于该供应商配置的现有字段或新增 `isDefault`——先读 `model-provider-types.ts` 与后端 `src/server/routes/model-providers.ts` 的 POST body 校验,**若后端不透传新字段则复用表单中已有的排序/优先字段,不擅改后端**)。默认模型在 `ModelPicker` 下拉置顶标注。

**Step 3: 布局优化。** 在不改数据流的前提下重排:
- 左侧供应商列表项卡片化:名称 + 模型数徽标 + 状态点,统一间距/圆角;
- 右侧表单改为分节卡片(基础信息/连接/模型/高级),高级默认折叠保持现状;
- 顶部操作栏按钮归组(主操作“新增”实心,刷新/检测/导入次级 ghost);
- 两个文件(如分栏间距、sticky 表头)按现有 glass 风格统一。
此项改完**必须由用户手测确认**,不自行起服务。

**Step 4: 验证。** `npx tsc --noEmit` + `npm run build`。

**Step 5: Commit** `feat(client): 供应商页布局优化、测试连接与默认模型`

---

### Task 6: MCP 健康状态展示

**Files:**
- Modify: `src/client/pages/MCPPage.tsx`、locales `mcp`

**Step 1:** MCPPage 已有 status 字段与 testConnection;增强:
- 列表项状态圆点已有(L256-267),补 tooltip 文案 + “上次检测时间”(前端 state 记录);
- 顶部加“全部检测”按钮:串行/并发(并发 3)调用各服务器 test 端点,汇总 N 成功 / M 失败;
- enabled=false 的项状态显示为“已禁用”(灰色),不参与全部检测。
- locales 加 `mcp.testAll` / `testAllResult` / `disabled` / `lastChecked`。

**Step 2: 验证。** `npx tsc --noEmit` + `npm run build`。

**Step 3: Commit** `feat(client): MCP 健康状态与批量检测`

---

### Task 7: 配置导入/导出

**Files:**
- Create: `src/client/pages/settings/DataSection.tsx`(设置页第五分类“数据”)
- Modify: `src/client/pages/SettingsPage.tsx`(分类栏加“数据”项)、`src/client/stores/app-store.ts`(供 store 读取,见 Step 1)、locales

**Step 1:** 导出:前端聚合三块已有数据——`GET /model-providers`、`GET /mcp-servers`、`GET /skills`,外加 store 的外观设置(localStorage FONT_KEY/theme/locale),打包成 JSON 文件下载(注意:**导出前剔除凭据字段 api key/token**,字段名依 `model-provider-types.ts` 与 MCPServerConfig 实际字段判断;若无法剔除则导出前弹确认框告知含敏感信息)。
**Step 2:** 导入:文件选择 → 解析校验 → 逐类调用既有写入端点(`POST /model-providers` upsert、`POST /mcp-servers`、`POST /skills`),外观设置写回 store+localStorage;完成后刷新页面数据,提示导入统计。
**Step 3:** SettingsPage 分类栏加“数据”(图标 Database),渲染 DataSection(两个大按钮 + 说明文案 + 导入结果摘要)。
**Step 4: 验证。** `npm run build`;导出→导入回环由用户手测。

**Step 5: Commit** `feat(client): 设置中心配置导入/导出`

---

## 收尾

- 全量 `npm run build`;检查 zh/en locales 键完全镜像(可临时脚本比对 key 集合)。
- 用户手测清单:设置页四个分类切换;字体/字号即时生效与刷新后保持;主题/语言切换;旧路由 /mcp 等重定向;供应商测试连接;MCP 全部检测;导入导出回环。
- 每完成一个 Task 即 commit,全部完成后由用户验证 UI 效果。

## 明确不做(YAGNI)

- 不改后端任何路由;连通性测试复用 `/model-providers/models/fetch`。
- 不动全局弹窗 ModelConfigModal/ProviderSetupModal 及 CLI 引导流程。
- mineru 页不迁入设置(保持主导航)。
- 顶栏现有的主题/背景/语言快捷按钮保留(设置页与顶栏并存,不重复造轮子)。
