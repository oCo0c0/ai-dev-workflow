# i18n 国际化改造计划

## 方案

- 库：`react-i18next` + `i18next`
- 翻译文件：`src/client/locales/zh.json` + `en.json`
- 语言偏好：Zustand `app-store` 的 `ui` 切片加 `locale` 字段，持久化到 localStorage
- 默认语言：中文

## 实施步骤

### Step 1: 安装依赖
```
npm install i18next react-i18next
```

### Step 2: 创建翻译文件
- `src/client/locales/zh.json` — 中文翻译（默认）
- `src/client/locales/en.json` — 英文翻译

按模块分 key：
```json
{
  "nav": { "requirements": "需求管理", "workspace": "工作区", ... },
  "common": { "save": "保存", "cancel": "取消", "delete": "删除", "confirm": "确认", ... },
  "projects": { "newTask": "新建任务", "running": "运行中", ... },
  "plan": { "generate": "生成计划", "confirmExecute": "确认并执行", ... },
  ...
}
```

### Step 3: 创建 i18n 初始化
- `src/client/i18n.ts` — i18next init 配置，读取 Zustand 中的 locale

### Step 4: app-store 加 locale
- `ui` 切片加 `locale: 'zh' | 'en'`
- 加 `setLocale` action
- localStorage 持久化

### Step 5: 入口集成
- `main.tsx` import `./i18n`

### Step 6: Layout 加语言切换
- 顶栏加语言切换按钮（中/EN）

### Step 7: 逐页面替换硬编码文案
顺序（按文案量）：
1. `Layout.tsx` — 菜单 + 页面标题
2. `ProjectsPage.tsx` — 最多文案
3. `PlanPage.tsx`
4. `RequirementsPage.tsx`
5. `ExecutionPage.tsx`
6. `WorkspacePage.tsx`
7. `TestsPage.tsx`
8. `PipelinesPage.tsx`
9. `SkillsPage.tsx`
10. `MCPPage.tsx`
11. `MinerUPage.tsx`

每个页面：导入 `useTranslation` → 提取硬编码字符串到 JSON → 替换为 `t('key')`

### Step 8: 编译验证
