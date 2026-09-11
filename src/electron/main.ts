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

import {app, BrowserWindow, dialog} from 'electron';
import {ChildProcess, spawn} from 'child_process';
import http from 'http';
import os from 'os';
import path from 'path';
import {fixPath} from './fix-path';
import {buildServerStdio} from './server-stdio';
import {findAvailablePort} from '../cli/port-finder';

const isDev = process.env.ADW_ELECTRON_DEV === '1';
/** 开发模式后端固定 3000（vite.config.ts 代理硬编码目标） */
const DEV_SERVER_PORT = 3000;
/** 服务端就绪探测超时 */
const SERVER_READY_TIMEOUT_MS = 60_000;

let serverProc: ChildProcess | null = null;
let win: BrowserWindow | null = null;
/** 是否正在主动退出（区分服务端异常退出与正常关闭） */
let quitting = false;

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
    win = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        title: 'AI Dev Workbench',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    win.once('ready-to-show', () => win?.show());
    win.on('closed', () => {
        win = null;
    });
    void win.loadURL(url);
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
            createWindow(url);

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
    });

    app.on('window-all-closed', () => {
        app.quit();
    });
}
