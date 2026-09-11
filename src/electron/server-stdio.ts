/**
 * 服务端子进程 stdio 构造
 *
 * 生产模式日志落盘：必须直接传 fd 数字给 spawn。
 * （回归教训：fs.createWriteStream 异步打开，spawn 时 fd 为 null，
 * child_process 会以 ERR_INVALID_ARG_VALUE 拒绝 —— 2026-09-11 桌面版首启崩溃根因。）
 */

import fs from 'fs';
import path from 'path';
import type {StdioOptions} from 'child_process';

/**
 * 构造服务端子进程的 stdio 配置
 *
 * @param isDev - 开发模式（控制台继承输出）
 * @param logDir - 生产模式日志目录（~/.ai-dev-workbench/logs）
 * @returns StdioOptions；生产模式为 ['ignore', fd, fd]（追加写 desktop-server.log）
 */
export function buildServerStdio(isDev: boolean, logDir: string): StdioOptions {
    if (isDev) return 'inherit';
    fs.mkdirSync(logDir, {recursive: true});
    const logPath = path.join(logDir, 'desktop-server.log');
    // openSync 立即返回 fd；'a' 追加模式，stdout/stderr 共用同一句柄，写操作原子追加
    const fd = fs.openSync(logPath, 'a');
    fs.writeSync(fd, `\n===== [desktop] server starting at ${new Date().toISOString()} =====\n`);
    // fd 由主进程持有直至进程退出（OS 自动回收），无需显式关闭
    return ['ignore', fd, fd];
}
