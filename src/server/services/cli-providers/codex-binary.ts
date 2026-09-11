/**
 * 系统 Codex CLI 二进制定位
 *
 * 桌面瘦身安装包不随附 @openai/codex-* 平台二进制（约 250MB，BYO-CLI 设计：
 * 用户系统已有完整引擎）。运行时当 SDK 自带的平台包不可用时，回退到 npm
 * 全局安装的 @openai/codex 内嵌二进制。
 *
 * npm 全局布局有两种（版本差异）：
 * - 嵌套：<npmRoot>/@openai/codex/node_modules/@openai/codex-win32-x64
 * - 平铺：<npmRoot>/@openai/codex-win32-x64
 * 平台包内二进制又有 vendor/<triple>/bin/ 与 vendor/<triple>/codex/ 两种子布局。
 */

import {execSync} from 'child_process';
import {existsSync, readdirSync} from 'fs';
import {dirname, join} from 'path';

/**
 * 获取 npm 全局 node_modules 根目录
 *
 * 优先从 node 可执行文件位置推导（npm 全局根 = node 所在目录/node_modules，
 * 零子进程开销，任何环境可用）；推导失败（如桌面应用 execPath 指向应用自身
 * exe）再回退 `npm root -g` 子进程查询。
 *
 * @param execPath node 可执行文件路径（默认 process.execPath；测试可注入）
 * @returns 绝对路径；两种方式均不可用时返回 null
 */
export function getNpmGlobalRoot(execPath: string = process.execPath): string | null {
    // 1. 推导：execPath 同级的 node_modules 即 npm 全局根
    const derived = join(dirname(execPath), 'node_modules');
    if (existsSync(derived)) return derived;

    // 2. 子进程查询（桌面应用 execPath 不是 node，需问 npm）
    try {
        const out = execSync('npm root -g', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 15000,
        }).trim();
        if (out && existsSync(out)) return out;
    } catch {
        // npm 不可用/超时
    }
    return null;
}

/**
 * 在 npm 全局根目录下定位系统 codex 真实二进制
 *
 * @param npmRoot  npm 全局 node_modules 根（getNpmGlobalRoot() 结果）
 * @param platform 平台（默认 process.platform），决定 codex.exe / codex
 * @returns 二进制绝对路径；未找到返回 null
 */
export function resolveSystemCodexBinary(npmRoot: string, platform: NodeJS.Platform = process.platform): string | null {
    if (!npmRoot) return null;
    const exe = platform === 'win32' ? 'codex.exe' : 'codex';
    const roots = [
        // 嵌套布局（npm 现行）
        join(npmRoot, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64'),
        // 平铺布局（pnpm / 旧版 npm）
        join(npmRoot, '@openai', 'codex-win32-x64'),
    ];
    for (const root of roots) {
        const vendorDir = join(root, 'vendor');
        let triples: string[];
        try {
            triples = readdirSync(vendorDir, {withFileTypes: true})
                .filter((e) => e.isDirectory())
                .map((e) => e.name);
        } catch {
            continue;
        }
        for (const triple of triples) {
            for (const sub of ['bin', 'codex']) {
                const p = join(vendorDir, triple, sub, exe);
                if (existsSync(p)) return p;
            }
        }
    }
    return null;
}
