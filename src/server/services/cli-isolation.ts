/**
 * @module cli-isolation
 * @description CLI 引擎配置隔离层 —— 「首次读本地 CLI 配置，之后全走应用自管」。
 *
 * 背景（用户反复踩到的坑）：我们此前直接读写 CLI 自己的配置目录
 * （`~/.claude/settings.json`、`~/.codex/config.toml`、`~/.pi/agent/auth.json`），
 * 于是出现两类问题：
 *   ① 应用里改了配置却不生效 —— CLI 侧配置优先级更高，把我们的注入覆盖掉；
 *   ② 两边状态互相污染 —— 我们把内置技能写进 `~/.claude/skills`，CLI 换 key 后应用行为突变。
 *
 * 策略（与 pi 引擎一致，三个引擎统一）：
 *   1. 每个引擎有应用自管的 home：`~/.ai-dev-workbench/<engine>-home`
 *   2. **首次使用**（home 不存在）时，从 CLI 目录**只读复制**一份选定的配置子集进来
 *      —— 保证「本地已装的 CLI 配置」第一次就被读到，不用用户重配；
 *   3. 之后一切读写都发生在隔离 home 内，CLI 目录不再被读、更不会被写；
 *   4. 应用里显式配置的凭据（模型供应商记录）优先级最高，改完立刻生效。
 *
 * 各引擎的 home 环境变量（已确认 CLI 支持）：
 *   - Claude Code：`CLAUDE_CONFIG_DIR`（claude.exe 内确认存在）
 *   - Codex：`CODEX_HOME`（codex.exe 内确认存在）
 *   - Pi：`PI_CODING_AGENT_DIR`（getAgentDir() 读取）
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {APP_DATA_DIR} from '../utils/constants.js';

/** 引擎标识 */
export type EngineId = 'claude' | 'codex';

/** 应用自管的引擎 home（隔离根） */
export const ISOLATED_HOMES: Record<EngineId, string> = {
    claude: path.join(APP_DATA_DIR, 'claude-home'),
    codex: path.join(APP_DATA_DIR, 'codex-home'),
};

/** 引擎读取 home 的环境变量名 */
export const HOME_ENV_KEYS: Record<EngineId, string> = {
    claude: 'CLAUDE_CONFIG_DIR',
    codex: 'CODEX_HOME',
};

/** 用户本机 CLI 的配置目录（仅在首次播种时读取） */
export const CLI_HOMES: Record<EngineId, string> = {
    claude: path.join(os.homedir(), '.claude'),
    codex: path.join(os.homedir(), '.codex'),
};

/**
 * 首次播种时从 CLI 目录复制的条目（白名单）。
 *
 * 只复制「配置 / 可复用资产」类条目，**不复制会话与缓存**
 * （`projects/`、`todos/`、`shell-snapshots/`、`sessions/`、`log/` 等体积大且与隔离目标无关）。
 */
const SEED_ENTRIES: Record<EngineId, string[]> = {
    claude: ['settings.json', 'commands', 'skills', 'agents'],
    codex: ['config.toml', 'auth.json', 'prompts'],
};

/** 隔离状态（供日志/接口展示） */
export interface IsolationInfo {
    engine: EngineId;
    /** 隔离 home 目录 */
    home: string;
    /** 本次是否执行了首次播种 */
    seeded: boolean;
    /** 播种来源（CLI 目录）；未播种为 undefined */
    seededFrom?: string;
    /** 播种复制到的条目 */
    seededEntries: string[];
}

/** 进程内已确保过的引擎（避免重复播种检查） */
const ensured = new Set<EngineId>();

/**
 * 确保引擎的隔离 home 可用。
 *
 * - home 已存在 → 直接返回（**不再回读 CLI**，保证隔离性：之后 CLI 改动不影响应用）
 * - home 不存在 → 从 CLI 目录播种白名单条目（不存在则创建空 home）
 *
 * @param engine - 引擎标识
 * @param opts.force - 强制重新检查（忽略进程内缓存）
 */
export function ensureIsolatedHome(engine: EngineId, opts: {force?: boolean} = {}): IsolationInfo {
    const home = ISOLATED_HOMES[engine];
    const cliHome = CLI_HOMES[engine];
    const seededEntries: string[] = [];
    let seeded = false;

    if (!opts.force && ensured.has(engine) && fs.existsSync(home)) {
        return {engine, home, seeded: false, seededEntries};
    }

    try {
        if (!fs.existsSync(home)) {
            // 首次：建目录 + 从 CLI 播种（只读复制，绝不修改 CLI 目录）
            fs.mkdirSync(home, {recursive: true});
            for (const entry of SEED_ENTRIES[engine]) {
                const src = path.join(cliHome, entry);
                const dest = path.join(home, entry);
                if (!fs.existsSync(src)) continue;
                try {
                    copyRecursive(src, dest);
                    seededEntries.push(entry);
                    seeded = true;
                } catch { /* 单个条目复制失败不影响其它 */ }
            }
        }
    } catch (err) {
        throw new Error(`初始化 ${engine} 隔离目录失败：${home}（${err instanceof Error ? err.message : String(err)}）`);
    }

    ensured.add(engine);
    return {
        engine,
        home,
        seeded,
        ...(seeded ? {seededFrom: cliHome} : {}),
        seededEntries,
    };
}

/** 递归复制（文件/目录；目标已存在时覆盖同名文件） */
function copyRecursive(src: string, dest: string): void {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, {recursive: true});
        for (const child of fs.readdirSync(src)) {
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.mkdirSync(path.dirname(dest), {recursive: true});
        fs.copyFileSync(src, dest);
    }
}

/**
 * 隔离 home 内的绝对路径（首次访问前会确保 home 存在）。
 * 所有引擎配置的读写都应经由此函数，不要直接拼 `~/.claude` / `~/.codex`。
 */
export function isolatedPath(engine: EngineId, ...segments: string[]): string {
    ensureIsolatedHome(engine);
    return path.join(ISOLATED_HOMES[engine], ...segments);
}

/** 隔离 home 下某路径是否存在 */
export function isolatedExists(engine: EngineId, ...segments: string[]): boolean {
    return fs.existsSync(isolatedPath(engine, ...segments));
}

/**
 * 引擎子进程的环境片段：把 CLI 的家庭目录指向隔离 home。
 * 与其它 env 合并时请使用「后者覆盖前者」，并让应用配置位于最末（优先级最高）。
 */
export function isolationEnv(engine: EngineId): Record<string, string> {
    ensureIsolatedHome(engine);
    return {[HOME_ENV_KEYS[engine]]: ISOLATED_HOMES[engine]};
}

/** 当前隔离状态快照（诊断/设置页展示用） */
export function isolationStatus(): IsolationInfo[] {
    return (['claude', 'codex'] as EngineId[]).map((engine) => ensureIsolatedHome(engine));
}
