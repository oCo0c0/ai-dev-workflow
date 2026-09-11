/**
 * Electron 主进程（桌面版入口）
 *
 * 职责：
 * 1. 修复 GUI 启动缺失的用户 PATH（macOS/Linux 命门：claude/codex/pi/npx 等依赖 CLI）
 * 2. 以子进程方式启动既有 Node 服务端：
 *    - ELECTRON_RUN_AS_NODE=1 把 Electron 二进制当 Node 运行时（无需打包 node.exe）
 *    - 崩溃隔离：窗口崩溃不影响进行中的执行；服务端崩溃弹窗提示并退出
 *    - 复用 CLI 既有 SIGTERM 优雅清理（bridge / pi RPC / MCP servers / Daytona 沙箱）
 * 3. HTTP 轮询就绪后创建窗口：生产加载服务端静态页，开发加载 Vite dev server
 * 4. 单实例锁 + 退出级联清理
 *
 * 打包要求 asar: false —— resources/pi-extensions 等需被孙进程按真实文件路径读取。
 */

import {app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray} from 'electron';
import {ChildProcess, spawn} from 'child_process';
import http from 'http';
import os from 'os';
import path from 'path';
import {fixPath} from './fix-path';
import {buildServerStdio} from './server-stdio';
import {overlayColorsFor} from './titlebar-theme';
import {loadCloseBehavior, saveCloseBehavior} from './tray-settings';
import {findAvailablePort} from '../cli/port-finder';

const isDev = process.env.ADW_ELECTRON_DEV === '1';
/** 开发模式后端固定 3000（vite.config.ts 代理硬编码目标） */
const DEV_SERVER_PORT = 3000;
/** 服务端就绪探测超时 */
const SERVER_READY_TIMEOUT_MS = 60_000;

let serverProc: ChildProcess | null = null;
let win: BrowserWindow | null = null;
/** 是否正在主动退出（区分服务端异常退出与正常关闭；托盘「退出」也置位） */
let quitting = false;
/** 系统托盘（Windows；Tray 无引用会被 GC 回收，须模块级持有） */
let tray: Tray | null = null;
/** 桌面壳设置目录（Electron userData） */
let settingsDir = '';

/** 应用根目录（开发 = 仓库根；打包 = app 目录，asar 已关闭） */
function appRoot(): string {
    return app.getAppPath();
}

/**
 * 启动后端服务子进程
 *
 * 生产模式日志落盘 ~/.ai-dev-workbench/logs/desktop-server.log；
 * 开发模式直接继承控制台输出。
 */
function spawnServer(port: number): ChildProcess {
    const bootstrapPath = path.join(appRoot(), 'dist-electron', 'electron', 'server-bootstrap.js');
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ADW_PORT: String(port),
        ADW_ELECTRON_DEV: isDev ? '1' : '',
        ADW_DESKTOP: '1',
    };

    // 生产模式日志落盘 fd（详见 server-stdio.ts：不能传未打开的 WriteStream）
    const stdio = buildServerStdio(isDev, path.join(os.homedir(), '.ai-dev-workbench', 'logs'));

    const proc = spawn(process.execPath, [bootstrapPath], {env, stdio});
    proc.on('exit', (code) => {
        if (!quitting) {
            dialog.showErrorBox(
                'AI Dev Workbench',
                `后端服务进程异常退出（code=${code}）。\n` +
                '日志文件：~/.ai-dev-workbench/logs/desktop-server.log',
            );
            app.quit();
        }
    });
    return proc;
}

/**
 * 轮询探测服务端就绪（任意 HTTP 响应即视为就绪）
 *
 * 服务端在全部服务初始化完成后才开始 listen，TCP 可连即代表 API 可用。
 * 用 localhost 而非 127.0.0.1：host 为 "localhost" 时 Node 可能仅绑 IPv6 ::1。
 */
function waitForServer(port: number, timeoutMs: number): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
            if (Date.now() - started > timeoutMs) {
                reject(err);
                return;
            }
            setTimeout(attempt, 300);
        };
        const attempt = (): void => {
            const req = http.get({host: 'localhost', port, path: '/', timeout: 2000}, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', onError);
            req.on('timeout', () => {
                req.destroy();
                onError(new Error('request timeout'));
            });
        };
        attempt();
    });
}

/** 创建主窗口 */
function createWindow(url: string): void {
    const isWindows = process.platform === 'win32';
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 600,
        show: false,
        title: 'AI Dev Workbench',
        // 与应用深色主题主背景（hsl(203 50% 16%)）一致，避免启动白闪
        backgroundColor: '#142d3c',
        // Windows/Linux 任务栏图标（macOS 使用应用包内图标）
        icon: path.join(appRoot(), 'resources', 'app-icon.png'),
        autoHideMenuBar: true,
        ...(isWindows
            ? {
                  // Windows：隐藏系统标题栏，应用顶栏即标题栏（Codex/Qoder 风格一体化）；
                  // 原生窗口按钮以主题色覆盖层叠于右上（高度对齐前端顶栏 h-14 = 56px，
                  // 前端以 titlebar-safe-right 避让，顶栏 app-drag 提供拖拽）
                  titleBarStyle: 'hidden' as const,
                  titleBarOverlay: {color: '#142d3c', symbolColor: '#e2e8f0', height: 56},
              }
            : {}),
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
        win = null;
    });
    // 关闭行为：tray=隐藏到托盘 / quit=直接退出 / ask=首次弹询问框（可记住选择）
    win.on('close', (e) => {
        if (quitting) return;
        const behavior = loadCloseBehavior(settingsDir);
        if (behavior === 'tray') {
            e.preventDefault();
            hideToTray();
            return;
        }
        if (behavior === 'quit') return;
        // ask：同步阻止默认关闭，再异步询问
        e.preventDefault();
        void (async () => {
            if (!win || win.isDestroyed()) return;
            const choice = await dialog.showMessageBox(win, {
                type: 'question',
                title: '关闭 AI Dev Workbench',
                message: '要直接退出，还是最小化到系统托盘继续运行？',
                detail: '最小化到托盘后，进行中的引擎任务不会被中断。',
                buttons: ['最小化到托盘', '直接退出'],
                defaultId: 0,
                cancelId: 1,
                noLink: true,
                checkboxLabel: '记住我的选择（之后不再询问）',
            });
            if (choice.response === 0) {
                if (choice.checkboxChecked) saveCloseBehavior(settingsDir, 'tray');
                hideToTray();
            } else {
                if (choice.checkboxChecked) saveCloseBehavior(settingsDir, 'quit');
                quitting = true;
                app.quit();
            }
        })();
    });
    void win.loadURL(url);
}

/** 隐藏主窗口到系统托盘（win32）并气泡提示去向 */
function hideToTray(): void {
    win?.hide();
    if (tray && process.platform === 'win32') {
        try {
            tray.displayBalloon({
                title: 'AI Dev Workbench',
                content: '已最小化到系统托盘，引擎任务继续运行。点击托盘图标可恢复窗口。',
            });
        } catch {
            // 气泡失败不影响隐藏
        }
    }
}

/** 恢复并聚焦主窗口 */
function showMainWindow(): void {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

/** 创建系统托盘（仅 Windows；左键恢复窗口，右键菜单 打开/退出） */
function createTray(): void {
    if (process.platform !== 'win32') return;
    const icon = nativeImage
        .createFromPath(path.join(appRoot(), 'resources', 'app-icon.png'))
        .resize({width: 16, height: 16});
    tray = new Tray(icon);
    tray.setToolTip('AI Dev Workbench');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {label: '打开 AI Dev Workbench', click: () => showMainWindow()},
            {type: 'separator'},
            {
                label: '退出',
                click: () => {
                    quitting = true;
                    app.quit();
                },
            },
        ]),
    );
    // Windows 惯例：左键点击托盘图标即恢复窗口
    tray.on('click', () => showMainWindow());
}

// ---- 生命周期 ----

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    app.whenReady().then(async () => {
        try {
            // 渲染进程主题变化 → 运行时更新窗口控制按钮覆盖层配色（仅 Windows 生效）
            ipcMain.on('adw:set-window-controls-theme', (_event, mode: 'light' | 'dark') => {
                if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
                try {
                    win.setTitleBarOverlay(overlayColorsFor(mode));
                } catch {
                    // 非 overlay 模式（未启用 titleBarOverlay 的平台/状态）忽略
                }
            });

            // 必须在任何子进程派生之前修复 PATH（子进程继承主进程环境）
            fixPath();

            let port: number;
            if (isDev) {
                port = DEV_SERVER_PORT;
            } else {
                port = (await findAvailablePort()).port;
            }

            serverProc = spawnServer(port);
            try {
                await waitForServer(port, SERVER_READY_TIMEOUT_MS);
            } catch (err) {
                dialog.showErrorBox(
                    'AI Dev Workbench',
                    `后端服务启动超时：${err instanceof Error ? err.message : err}\n` +
                    '日志文件：~/.ai-dev-workbench/logs/desktop-server.log',
                );
                app.quit();
                return;
            }

            const url = isDev
                ? (process.env.ADW_DEV_SERVER_URL ?? 'http://localhost:5173')
                : `http://localhost:${port}`;
            console.log(`[desktop] ready at ${url}`);
            settingsDir = app.getPath('userData');
            createWindow(url);
            createTray();

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
            });
        } catch (err) {
            // 同步启动错误（如 spawn 参数异常）以弹窗呈现而非静默 unhandled rejection
            dialog.showErrorBox(
                'AI Dev Workbench',
                `启动失败：${err instanceof Error ? err.message : String(err)}`,
            );
            app.quit();
        }
    });

    app.on('before-quit', () => {
        quitting = true;
    });

    app.on('will-quit', () => {
        // POSIX: SIGTERM → 服务端既有优雅清理（dispose 沙箱/子进程后自行退出）
        // Windows: kill() 为 TerminateProcess 强杀（已知限制，见计划文档）
        serverProc?.kill();
        tray?.destroy();
        tray = null;
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
}
