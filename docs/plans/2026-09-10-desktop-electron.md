# 桌面应用（Electron，macOS/Windows/Linux）实施计划

> **执行状态（2026-09-10 下班暂停）**
> - ✅ Task 1–5 全部完成并分 5 次提交（e4a9c7c → 3c92ce4）+ 本文档提交
> - ⏸ Task 6（构建+冒烟）未开始，卡在依赖环境：沙箱会话无法写工作区外的 `D:\.pnpm-store`，已改用工作区内 store 方案——5GB store robocopy 复制**中途被终止**（.pnpm-store 为部分拷贝，pnpm 自愈可补）；`node_modules` 已删除但残留约 9000 个只读/长路径文件
> - **明日恢复步骤**：① 清 node_modules 残留：`cmd /c rmdir /s /q node_modules`（只读文件用 `attrib -R node_modules\* /S /D` 后重试）② `pnpm install`（store 缺的部分自动从 registry 补）③ `pnpm add -D electron electron-builder`（allowBuilds 已加 electron；二进制下载慢可设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）④ `pnpm run build:electron` 验证编译 ⑤ Task 6 全量构建 + `pnpm exec electron .` 冒烟 ⑥ Task 7 剩余：根 CLAUDE.md 变更记录补行（模块索引/脚本已更新）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 adw（AI Dev Workbench）打包为三平台桌面应用：Electron 壳以子进程方式启动既有 Node 服务端，窗口加载服务端 URL，开发模式走 Vite + tsx。

**Architecture:** 不改业务代码。新增 Electron 主进程（窗口/生命周期/PATH 修复），通过 `ELECTRON_RUN_AS_NODE=1` 把 Electron 二进制当 Node 运行时，以独立子进程启动 `dist/cli`（崩溃隔离 + 复用既有 SIGTERM 优雅清理）。前端生产模式由服务端静态服务，开发模式加载 Vite dev server。`asar: false` 保证 `resources/pi-extensions` 等被孙进程按真实路径读取。

**Tech Stack:** Electron（devDep）、electron-builder（nsis/dmg/AppImage+deb）、TypeScript（独立 tsconfig 编译到 dist-electron/）、Vitest。

**决策记录：**
- 选 Electron 而非 Tauri：后端重度依赖 Node 子进程（bridge/pi RPC/npx MCP），Electron 自带 Node 运行时零迁移。
- 服务端跑子进程而非主进程内嵌：复用 CLI 的优雅关闭（SIGTERM → cleanup → exit）；主进程崩溃不影响进行中的执行。
- `package.json` 的 `main` 改为 `dist-electron/electron/main.js`（Electron 入口）。本项目是应用非库，npm 包以 `bin: adw` 消费，影响可忽略；在变更记录中注明。
- 打包产物不内嵌 claude/codex/pi CLI（自带模式，沿用 Provider 自动检测）；首启体检属后续任务。
- 已知限制：Windows 上子进程 `kill()` 为强杀（无优雅清理）；macOS 需开发者账号签名+公证后才能分发（本计划出未签名产物，CI/签名列为后续）。

---

### Task 1: CLI 支持 `ADW_PORT` 环境变量（桌面主进程 → 服务端子进程端口传递）

**Files:**
- Modify: `src/cli/port-finder.ts`（新增纯函数 `resolvePreferredPort`）
- Modify: `src/cli/index.ts:90-93`
- Test: `src/cli/port-finder.test.ts`（新建）

**Step 1: 写失败测试**

```typescript
// src/cli/port-finder.test.ts
import {describe, it, expect} from 'vitest';
import {resolvePreferredPort} from './port-finder.js';

describe('resolvePreferredPort', () => {
    it('合法环境变量端口优先于配置文件', () => {
        expect(resolvePreferredPort('4321', 3000)).toBe(4321);
    });
    it('非法环境变量（非数字/越界）回退配置文件', () => {
        expect(resolvePreferredPort('abc', 3000)).toBe(3000);
        expect(resolvePreferredPort('80', 3000)).toBe(3000);   // <1024
        expect(resolvePreferredPort('70000', 3000)).toBe(3000); // >65535
        expect(resolvePreferredPort('0', 3000)).toBe(3000);
        expect(resolvePreferredPort('', 3000)).toBe(3000);
    });
    it('环境变量缺省时使用配置值', () => {
        expect(resolvePreferredPort(undefined, 3000)).toBe(3000);
    });
    it('两者皆缺省返回 undefined', () => {
        expect(resolvePreferredPort(undefined, undefined)).toBeUndefined();
    });
});
```

**Step 2: 运行确认失败**

Run: `pnpm exec vitest --run src/cli/port-finder.test.ts`
Expected: FAIL（`resolvePreferredPort` 不存在）

**Step 3: 最小实现**

`src/cli/port-finder.ts` 追加：

```typescript
/**
 * 解析首选端口：环境变量 ADW_PORT 优先于配置文件。
 * 非法值（非整数/越界）静默忽略，回退配置。
 * 桌面版由 Electron 主进程注入 ADW_PORT，保证窗口与子进程端口一致。
 */
export function resolvePreferredPort(
    envPort: string | undefined,
    configPort: number | undefined,
): number | undefined {
    if (envPort !== undefined) {
        const parsed = Number(envPort);
        if (Number.isInteger(parsed) && parsed >= 1024 && parsed <= 65535) return parsed;
    }
    return configPort;
}
```

`src/cli/index.ts` 改一行：

```typescript
const preferredPort = resolvePreferredPort(process.env.ADW_PORT, config.server?.port);
```
（import 行同步调整）

**Step 4: 运行确认通过**

Run: `pnpm exec vitest --run src/cli/port-finder.test.ts`
Expected: PASS（4 个用例）

**Step 5: Commit**

```bash
git add src/cli/port-finder.ts src/cli/port-finder.test.ts src/cli/index.ts
git commit -m "feat(cli): ADW_PORT 环境变量端口注入，供桌面主进程协调端口"
```

---

### Task 2: GUI 环境 PATH 修复工具（macOS/Linux 命门）

**Files:**
- Create: `src/electron/fix-path.ts`
- Test: `src/electron/fix-path.test.ts`

**Step 1: 写失败测试**

```typescript
// src/electron/fix-path.test.ts
import {describe, it, expect} from 'vitest';
import path from 'path';
import {extractShellPath, mergePath} from './fix-path.js';

const D = path.delimiter;

describe('extractShellPath', () => {
    it('提取标记后的 PATH 行', () => {
        const out = `Last login: ...\n__ADW_SHELL_PATH__/opt/homebrew/bin${D}/usr/local/bin\n`;
        expect(extractShellPath(out)).toBe(`/opt/homebrew/bin${D}/usr/local/bin`);
    });
    it('无标记返回 null', () => {
        expect(extractShellPath('no marker here')).toBeNull();
    });
    it('标记后无内容返回 null', () => {
        expect(extractShellPath('x\n__ADW_SHELL_PATH__\n')).toBeNull();
    });
});

describe('mergePath', () => {
    it('缺失条目前置补充并去重', () => {
        expect(mergePath(`/usr/bin${D}/bin`, `/opt/homebrew/bin${D}/usr/bin`))
            .toBe(`/opt/homebrew/bin${D}/usr/bin${D}/bin`);
    });
    it('空 current 只保留 shell 条目', () => {
        expect(mergePath('', `/a${D}/b`)).toBe(`/a${D}/b`);
    });
    it('空段被过滤', () => {
        expect(mergePath(`${D}/usr/bin${D}`, `/usr/bin`)).toBe(`/usr/bin`);
    });
});
```

**Step 2: 运行确认失败**

Run: `pnpm exec vitest --run src/electron/fix-path.test.ts`
Expected: FAIL（模块不存在）

**Step 3: 实现 `src/electron/fix-path.ts`**（完整代码见仓库；要点：登录 shell `spawnSync(shell, ['-ilc', 'echo "__ADW_SHELL_PATH__$PATH"'])` 提取 → `mergePath` 前置补齐；超时 4s；失败兜底 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin` 等常见目录；win32 直接返回）

**Step 4: 运行确认通过** → PASS

**Step 5: Commit**

```bash
git add src/electron/fix-path.ts src/electron/fix-path.test.ts
git commit -m "feat(electron): GUI 启动 PATH 修复工具（登录 shell 提取 + 兜底目录）"
```

---

### Task 3: Electron 主进程 + 服务端引导

**Files:**
- Create: `src/electron/server-bootstrap.ts`（删 `ELECTRON_RUN_AS_NODE` 防泄漏给孙进程；开发走 tsx，生产 require `dist/cli`）
- Create: `src/electron/main.ts`（单实例锁、fixPath、`findAvailablePort`、spawn 服务端子进程、HTTP 轮询就绪、BrowserWindow 加载、退出清理）

关键行为：
- 子进程：`spawn(process.execPath, [bootstrapPath], {env: {...env, ELECTRON_RUN_AS_NODE:'1', ADW_PORT}})`
- 生产日志 → `~/.ai-dev-workbench/logs/desktop-server.log`；开发 `stdio: 'inherit'`
- 子进程非正常退出 → `dialog.showErrorBox` + quit
- 开发模式端口固定 3000（Vite 代理硬编码）；URL 取 `ADW_DEV_SERVER_URL`（默认 5173）
- `window-all-closed → app.quit()`；`will-quit → serverProc.kill()`（POSIX 触发服务端既有 SIGTERM 优雅清理）

**Step 1-4:** 编写 + `pnpm run build:electron`（Task 4 提供脚本）编译通过（Electron 主进程不做单测，行为由 Task 6 冒烟验证）

**Step 5: Commit**

```bash
git add src/electron/main.ts src/electron/server-bootstrap.ts
git commit -m "feat(electron): 主进程与服务端子进程引导（崩溃隔离 + 优雅关闭）"
```

---

### Task 4: 编译配置、npm scripts 与开发入口

**Files:**
- Create: `tsconfig.electron.json`（CommonJS，outDir `dist-electron`，include `src/electron/**` + `src/cli/port-finder.ts`，排除 `*.test.ts`）
- Create: `scripts/dev-desktop.mjs`（编译主进程 → 起 Vite → 等 5173 就绪 → 起 Electron，Ctrl+C 级联清理）
- Modify: `package.json`：
  - `"main": "dist-electron/electron/main.js"`
  - scripts 新增：
    - `"build:electron": "tsc -p tsconfig.electron.json"`
    - `"dev:desktop": "node scripts/dev-desktop.mjs"`
    - `"dist:win" / "dist:mac" / "dist:linux"`：`build + build:electron + electron-builder --<plat>`

**验证：** `pnpm run build:electron` 成功产出 `dist-electron/electron/main.js`

**Commit:**

```bash
git add tsconfig.electron.json scripts/dev-desktop.mjs package.json pnpm-lock.yaml
git commit -m "feat(desktop): electron 编译配置与 dev/dist 脚本"
```

---

### Task 5: electron-builder 打包配置

**Files:**
- Create: `electron-builder.yml`（appId `com.along.ai-dev-workbench`；`asar: false`——`resources/pi-extensions` 需被孙进程按真实路径读取；files 覆盖 dist/ dist-electron/ resources/ templates/ skills/；win=nsis、mac=dmg、linux=AppImage+deb；产物目录 `release/`）

**Commit:**

```bash
git add electron-builder.yml
git commit -m "feat(desktop): electron-builder 三平台打包配置"
```

---

### Task 6: 全量构建 + Windows 冒烟验证

**Steps:**
1. `pnpm run build && pnpm run build:electron` → 成功
2. `pnpm test` → 新旧用例全绿
3. 冒烟：后台运行 `pnpm exec electron .`，输出重定向日志文件；等待 `[desktop] ready at http://127.0.0.1:<port>`；`Invoke-WebRequest` 该 URL 返回 200；结束后杀掉 electron 进程并确认无残留
4. （macOS/Linux 产物交叉构建不在本机验证，配置就绪，CI 属后续）

**Commit:** 无代码变更（验证步骤）；发现问题则修复后提交

---

### Task 7: 文档更新与收尾

**Files:**
- Create: `src/electron/CLAUDE.md`（模块文档）
- Modify: 根 `CLAUDE.md`（模块索引 + 运行脚本 + 变更记录）
- Modify: `README.md` / `README_ZH.md`（桌面版运行/打包一节）

**Commit:**

```bash
git add src/electron/CLAUDE.md CLAUDE.md README.md README_ZH.md
git commit -m "docs(desktop): 桌面版架构与使用说明"
```

---

## 后续路线（本计划不做）

- 移动远程（WS 握手鉴权 + apiKey 强制 + 扫码配对 + 响应式 UI）
- macOS 签名/公证、自动更新（electron-updater）、托盘/开机自启
- 应用图标与首启 CLI 环境体检向导
- 三平台 CI 构建矩阵（GitHub Actions）
