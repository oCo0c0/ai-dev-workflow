# dsh-adw — DSH Web GUI 需求工作台插件

把 adw（ai-dev-workbench）的需求能力做成 DeepSeek Harness（DSH）的可插拔插件：

- **侧边栏「需求工作台」入口**：DSH Web GUI 中列打开需求面板；
- **需求文档自动获取**：从需求源（ONES / GitHub Issues / 自定义 MCP）按需求号 / issue key / 链接拉取需求详情（描述、验收标准、附件），**无需手动录入**；
- **需求源完全自管**：ONES / GitHub 各自独立配置，凭据保存在插件自己的文件 `~/.dsh/dsh-adw/mcp-servers.json`（修改即时生效），**不读写任何其它工具的配置**（`~/.claude` 等），互不影响；
- **标准 MCP 配置方言**：自定义 MCP 服务器支持两种形态——本地 stdio（`npx` / `python` / `docker` / 任意可执行；Windows 自动 `cmd /c` 归一化，npx 不再 ENOENT）与远程 http(s) URL（Streamable HTTP 优先、SSE 自动回退；env 映射为请求头可放 token）；与 Claude/Cursor 的 `mcpServers` 片段直接兼容，粘进来即可用；
- **官方设置页配置卡**：设置 → 插件 →「adw 需求工作台」卡片（官方 `settings.plugin.item` 槽位，按 `dsh-adw` 命名空间配对）——源配置、自定义 MCP、MinerU 地址一站式管理；面板「源」页内嵌同一份配置组件作兜底（无设置面环境仍有入口）；
- **附件图片本地化**：拉取时自动下载需求内图片（wiki token / 富文本内嵌 / 直连三段策略），描述与附件改写为本地地址（`/api/dsh-adw/requirements/<id>/images/<file>`，仅本机回环可访问），面板直接内嵌展示，不回源泄露地址；
- **MinerU 文档解析**：配置 MinerU 服务地址后，`adw_parse_document` 工具把 PDF / Word / PPT / Excel / 截图解析为 Markdown（OCR、表格、公式、版面分析）——输入支持本地绝对路径、http(s) URL、以及已保存需求的附件引用 `adw-image://<需求id>/<文件名>`，正好补上「DSH 无视觉能力 + 需求附件是 PRD 截图」的场景；
- **选择工作区执行开发**：需求详情点「执行开发」→ 选工作区（可钉 agent 预设 / 权限）→ 预览并编辑开发 Prompt → 驱动**真实 DSH 会话**执行；执行状态回写需求卡片，可跳转会话查看转录；刷新/重启后自动对账补写结局；
- **Agent 自助工具**：任何会话里的 agent 可调用 `adw_fetch_requirement` / `adw_list_requirements` / `adw_search_requirements` / `adw_parse_document`——用户说「拉取 CWXT-130341 并开发」，agent 自己取需求文档开工；
- **热插拔**：一条命令装卸，拔掉后 GUI 原样还原，不留痕迹。

数据存放在 `~/.dsh/dsh-adw/`（需求 `requirements.json`、源配置 `mcp-servers.json`、附件图片 `images/`）；路由仅本机回环可用（loopback 栅栏）。

## 构建

```sh
cd packages/adw-requirement-core
pnpm install --ignore-workspace && pnpm run build     # 内核（适配器 + MCP 桥接 + 存储 + MinerU 客户端）

cd ../dsh-adw
pnpm install --ignore-workspace && pnpm run build     # 插件（tsc 类型检查 ×2 + esbuild 双 bundle）
```

产物：`lib/index.js`（宿主半，自包含 MCP SDK）+ `lib/client.js`（浏览器半，`window.__ModuleLoader__` 包装格式）。

验证（可选）：

```sh
node packages/adw-requirement-core/scripts/smoke.mjs   # 内核 11 组断言
node packages/dsh-adw/scripts/smoke.mjs                # 宿主半断言（路由/工具/栅栏/存储/自定义 MCP/MinerU 降级）
```

## 安装 / 卸载

```sh
# 从私有 registry 安装（推荐；同事可直接用）
dsh plugin --profile web add @along/dsh-adw --registry https://alongnpr.online

# 本地 link 安装（开发期；改代码后 rebuild + 重启 dsh web + Ctrl+F5）
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
2. 设置 → 插件 →「adw 需求工作台」卡片可见，与官方 Bash/Agent Loop/Web Search 卡并排；卡片内可添加自定义 MCP（stdio/url）、配置 MinerU 地址并健康检查；
3. 任意会话输入「列出已保存的需求」→ agent 调用 `adw_list_requirements`；
4. 配置 MinerU 后会话输入「用 MinerU 解析 xx.pdf」→ agent 调用 `adw_parse_document`；
5. 会话里 agent 知道「需求工作台」的存在（公告段 `plugin:dsh-adw`）。

## 设置

通过 DSH 设置面的插件配置节（namespace `dsh-adw`）：

| 字段 | 说明 |
|------|------|
| `enabled` | 总开关（路由 / 工具 / 公告） |
| `announceToAgent` | 系统提示公告开关 |
| `devPromptTemplate` | 开发 Prompt 模板（占位符 `{{title}}/{{number}}/{{description}}/{{acceptanceCriteria}}` 等） |
| `defaultServerName` | 默认需求源（MCP 服务器名；空 = 自动解析） |
| `mineruUrl` | MinerU 服务地址（如 `http://127.0.0.1:8000`；空 = 禁用文档解析） |

## 结构

```
packages/
├── adw-requirement-core/   # 需求内核（零 DSH 依赖；adw 本体未来可改为复用）
│   └── src/ requirement-sources/（适配器）· mcp-bridge（stdio+http 传输）· mcp-config · mineru-client · store · engine
└── dsh-adw/                # 双面插件
    ├── src/index.ts        # 宿主半：引擎 + /api/dsh-adw/* 路由 + agent 工具 + 公告 + 设置
    ├── src/host/           # routes · tools（含 adw_parse_document）· mineru · loopback
    └── src/client/         # 浏览器半：侧边栏入口 + 面板 + 设置卡 + 执行服务 + api client
```
