/**
 * GUI 环境 PATH 修复
 *
 * macOS/Linux 上从 Finder/Dock 启动的 GUI 应用不继承登录 shell 的 PATH，
 * 导致找不到 claude / codex / pi / npx / python / git 等依赖 CLI。
 * 方案：通过登录 shell 读取用户 PATH，把缺失条目前置补齐；
 * 登录 shell 不可用时退回到常见安装目录。
 * Windows GUI 进程继承注册表 PATH，无需处理。
 */

import {spawnSync} from 'child_process';
import os from 'os';
import path from 'path';

/** 登录 shell 输出中的 PATH 起始标记（前置于 $PATH 展开） */
const MARKER = '__ADW_SHELL_PATH__';

/**
 * 从登录 shell 输出中提取 $PATH 值
 *
 * shell 配置文件可能打印横幅等噪声，取最后一个标记之后的第一个非空行。
 *
 * @param output - `echo "${MARKER}$PATH"` 的完整 stdout
 * @returns PATH 字符串；无标记或无有效内容时返回 null
 */
export function extractShellPath(output: string): string | null {
    const idx = output.lastIndexOf(MARKER);
    if (idx === -1) return null;
    const rest = output.slice(idx + MARKER.length);
    const line = rest.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
    return line ?? null;
}

/**
 * 合并 PATH：把 shellPath 中 current 缺失的条目前置补充
 *
 * 前置（而非追加）使 Homebrew 等用户自装工具优先于系统内置版本；
 * 重复与空段被过滤，保证幂等。
 *
 * @param current - 当前 PATH（可为空串）
 * @param shellPath - 登录 shell 的 PATH
 * @returns 合并后的 PATH
 */
export function mergePath(current: string, shellPath: string): string {
    const cur = current.split(path.delimiter).filter(Boolean);
    const existing = new Set(cur);
    const missing = shellPath.split(path.delimiter).filter((p) => p && !existing.has(p));
    return [...missing, ...cur].join(path.delimiter);
}

/**
 * 修复当前进程 PATH（在 Electron 主进程最早期调用）
 *
 * 幂等：重复调用不会产生重复条目；win32 为 no-op。
 */
export function fixPath(): void {
    if (process.platform === 'win32') return;

    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    let shellPath: string | null = null;
    try {
        // -i -l 模拟交互式登录 shell 以加载用户 profile（nvm/homebrew 等通常在此注入 PATH）
        const res = spawnSync(shell, ['-ilc', `echo "${MARKER}$PATH"`], {timeout: 4000, encoding: 'utf8'});
        if (res.status === 0 && res.stdout) shellPath = extractShellPath(res.stdout);
    } catch {
        // 登录 shell 不可用（SHELL 未定义且默认 shell 缺失等），走兜底目录
    }
    if (!shellPath) {
        shellPath = [
            '/opt/homebrew/bin',       // macOS Apple Silicon Homebrew
            '/usr/local/bin',          // macOS Intel Homebrew / Linux 手动安装
            '/usr/local/sbin',
            path.join(os.homedir(), '.local/bin'),
            path.join(os.homedir(), 'bin'),
        ].join(path.delimiter);
    }
    process.env.PATH = mergePath(process.env.PATH ?? '', shellPath);
}
