# dsh-adw — DSH Web GUI 需求工作台插件

把 adw（ai-dev-workbench）的需求能力做成 DeepSeek Harness（DSH）的可插拔插件：

- **侧边栏「需求工作台」入口**：DSH Web GUI 中列打开需求面板；
- **需求文档自动获取**：从需求源（ONES / GitHub Issues / 通用 MCP）按需求号 / issue key / 链接拉取需求详情（描述、验收标准、附件），**无需手动录入**；
- **需求源完全自管**：ONES / GitHub 各自独立配置，凭据保存在插件自己的文件 `~/.dsh/dsh-adw/mcp-servers.json`（面板顶栏「源」按钮打开配置页：配置 / 连接测试 / 移除，修改即时生效），**不读写任何其它工具的配置**（`~/.claude` 等），互不影响；
- **附件图片本地化**：拉取时自动下载需求内图片（wiki token / 富文本内嵌 / 直连三段策略），描述与附件改写为本地地址（`/api/dsh-adw/requirements/<id>/images/<file>`，仅本机回环可访问），面板直接内嵌展示，不回源泄露地址；
- **选择工作区执行开发**：需求详情点「执行开发」→ 选工作区（可钉 agent 预设 / 权限）→ 预览并编辑开发 Prompt → 驱动**真实 DSH 会话**执行；执行状态回写需求卡片，可跳转会话查看转录；刷新/重启后自动对账补写结局；
- **Agent 自助工具**：任何会话里的 agent 可调用 `adw_fetch_requirement` / `adw_list_requirements` / `adw_search_requirements`——用户说「拉取 CWXT-130341 并开发」，agent 自己取需求文档开工；
- **热插拔**：一条命令装卸，拔掉后 GUI 原样还原，不留痕迹。

数据存放在 `~/.dsh/dsh-adw/`（需求 `requirements.json`、源配置 `mcp-servers.json`、附件图片 `images/`）；路由仅本机回环可用（loopback 栅栏）。

## 构建

```sh
cd packages/adw-requirement-core
pnpm install --ignore-workspace && pnpm run build     # 内核（适配器 + MCP 桥接 + 存储）

cd ../dsh-adw
pnpm install --ignore-workspace && pnpm run build     # 插件（tsc 类型检查 ×2 + esbuild 双 bundle）
```

产物：`lib/index.js`（宿主半，自包含 MCP SDK）+ `lib/client.js`（浏览器半，`window.__ModuleLoader__` 包装格式）。

验证（可选）：

```sh
node packages/adw-requirement-core/scripts/smoke.mjs   # 内核 9 组断言
node packages/dsh-adw/scripts/smoke.mjs                # 宿主半 9 组断言（路由/工具/栅栏/存储）
```

## 安装 / 卸载

```sh
# 安装进 web profile（然后重启 dsh web 生效——是进程重启，不是页面刷新）
dsh plugin --profile web add link:D:/py_workspace/ai-dev-workflow/packages/dsh-adw

# 卸载（重启后 GUI 还原）
dsh plugin --profile web remove @along/dsh-adw
```

## 验证清单

安装并重启后，一键验证（在 `packages/dsh-adw` 下）：

```sh
node scripts/verify-install.mjs [port]    # 默认 3080；检查源目录/需求列表/浏览器半三组接口
```

脚本通过后，人工检查浏览器（刷新页面）：

1. 侧边栏「新会话」下方出现「需求工作台」→ 面板顶栏选源、输入需求号（如 `CWXT-130341`）点「拉取」→ 详情页「执行开发」→ 选工作区 → 确认执行 → 会话真实跑完、卡片回写「已完成/已失败」；
2. 任意会话输入「列出已保存的需求」→ agent 调用 `adw_list_requirements`；
3. 会话里 agent 知道「需求工作台」的存在（公告段 `plugin:dsh-adw`）。

## 设置

通过 DSH 设置面的插件配置节（namespace `dsh-adw`）：`enabled` 总开关、`announceToAgent` 公告开关、`devPromptTemplate` 开发 Prompt 模板（占位符 `{{title}}/{{number}}/{{description}}/{{acceptanceCriteria}}` 等）、`defaultServerName` 默认源。

## 结构

```
packages/
├── adw-requirement-core/   # 需求内核（零 DSH 依赖；adw 本体未来可改为复用）
│   └── src/ requirement-sources/（适配器）· mcp-bridge · mcp-config · store · engine
└── dsh-adw/                # 双面插件
    ├── src/index.ts        # 宿主半：引擎 + /api/dsh-adw/* 路由 + agent 工具 + 公告 + 设置
    ├── src/client/         # 浏览器半：侧边栏入口 + 面板 + 执行服务 + api client
    └── cordis.patch.yml    # profile 插件行注入
```
