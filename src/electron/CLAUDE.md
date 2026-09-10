[根目录](../../CLAUDE.md) > [src](./..) > **electron**

# Electron 模块（桌面版）

## 模块职责

桌面应用壳层：Electron 主进程管理窗口与生命周期，把既有 Node 服务端作为独立子进程启动，前端复用 SPA（生产=服务端静态页，开发=Vite dev server）。实施计划见 `docs/plans/2026-09-10-desktop-electron.md`。

## 文件清单

| 文件 | 说明 |
|------|------|
| `main.ts` | Electron 主进程：单实例锁、PATH 修复、服务端子进程管理（`ELECTRON_RUN_AS_NODE`）、HTTP 就绪探测、窗口创建、退出级联清理 |
| `server-bootstrap.ts` | 服务端引导（以纯 Node 模式运行）：删除 `ELECTRON_RUN_AS_NODE` 防泄漏给孙进程；开发走 tsx 源码，生产加载 `dist/cli` |
| `fix-path.ts` | GUI 启动 PATH 修复：登录 shell 提取（带标记解析）+ 兜底目录合并；win32 no-op |
| `fix-path.test.ts` | `extractShellPath` / `mergePath` 纯函数单测 |

## 启动流程（生产）

1. `app.requestSingleInstanceLock()` 单实例
2. `fixPath()` —— 必须先于任何子进程派生（子进程继承主进程环境）
3. `findAvailablePort()` 选端口（开发模式固定 3000，对齐 Vite 代理）
4. `spawn(process.execPath, [dist-electron/electron/server-bootstrap.js], {env: {ELECTRON_RUN_AS_NODE:'1', ADW_PORT}})` —— 生产日志重定向 `~/.ai-dev-workbench/logs/desktop-server.log`
5. HTTP 轮询 `127.0.0.1:port` 就绪后 `loadURL`
6. 退出：`will-quit` → `serverProc.kill()`（POSIX 触发服务端既有 SIGTERM 优雅清理；Windows 为强杀，已知限制）

## 编译与构建

- 编译：`tsconfig.electron.json`（CommonJS → `dist-electron/`，含 `src/cli/port-finder.ts`）
- 命令：`pnpm build:electron`；开发：`pnpm dev:desktop`；打包：`pnpm dist:win|mac|linux`（electron-builder，配置 `electron-builder.yml`，产物 `release/`）
- `package.json` 的 `main` 指向 `dist-electron/electron/main.js`（Electron 入口；npm 包以 `bin: adw` 消费不受影响）

## 关键约束

- **`asar: false`**（electron-builder.yml）——`resources/pi-extensions` 等需被孙进程（pi RPC 子进程）按真实文件路径读取
- **ADW_PORT 环境变量**（`src/cli/port-finder.ts` 的 `resolvePreferredPort`）保证主进程选的端口与子进程监听端口一致
- **不内嵌 AI 引擎 CLI**（claude/codex/pi），沿用 Provider 运行时自动检测
- macOS/Linux GUI 启动无 shell PATH —— `fix-path.ts` 是所有 CLI 子进程能被找到的前提

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-09-10 | 创建 | 桌面版里程碑 1：Electron 壳 + 三平台打包配置 + PATH 修复 |
