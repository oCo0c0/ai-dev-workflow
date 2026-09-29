/**
 * 应用数据根目录（单一事实来源）+ 旧目录一次性自动迁移
 *
 * 应用更名为 **Aico** 后，数据根目录从旧名目录变为 `~/.aico`。
 * 这里在模块加载时（早于任何 Store 拼接路径、早于 Electron 主进程建日志目录）
 * 做一次幂等的迁移决策：
 *
 * 1. 新目录已存在  → 直接用新目录，绝不碰旧目录（避免新数据被旧数据覆盖）
 * 2. 新目录不存在但旧目录存在 → `rename`（同卷原子改名、零拷贝、毫秒级）
 * 3. 两者都不存在 → 用新目录（由各 Store 按需 `mkdir -p`）
 *
 * 关键约束：迁移失败（旧实例仍在运行导致目录被占用、跨卷等）时**退回旧目录继续用**，
 * 而不是落在空的新目录上——那样在用户看来就是"数据全丢了"。
 *
 * 服务端（经 `src/server/utils/constants.ts`）、CLI 与 Electron 主进程共用本模块，
 * 保证任何一处建目录之前迁移都已经完成（`APP_DATA_DIR` 在模块加载时求值）。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

/** 新数据根目录名（Aico） */
export const APP_DATA_DIR_NAME = '.aico';
/**
 * 改名前的旧数据根目录名（历史值，永久固定，不要跟着改名走）
 *
 * 注意：这里是**字面量**历史目录名，任何"全局改名"都不应改动它，
 * 否则自动迁移会退化成"把新目录改名成自己"。
 */
export const LEGACY_APP_DATA_DIR_NAME = '.ai-dev-workbench';

let cached: string | null = null;

/**
 * 旧目录 → 新目录 的一次性迁移决策（纯路径注入，便于单测）
 *
 * @param next 新数据根目录
 * @param legacy 旧数据根目录
 * @returns 实际应使用的数据根目录
 */
export function migrateAppDataDir(next: string, legacy: string): string {
    // 新目录已存在（含"两边都在"）：一律用新目录，绝不覆盖
    if (fs.existsSync(next)) return next;
    // 旧目录不存在：全新安装，直接用新目录
    if (!fs.existsSync(legacy)) return next;

    try {
        // 同卷原子改名：零拷贝、毫秒级，任意层级的数据/权限/时间戳原样保留
        fs.renameSync(legacy, next);
        console.log(`[Aico] 已迁移数据目录：${legacy} → ${next}`);
        return next;
    } catch (err) {
        // 旧实例仍在运行（目录被占用）、跨卷等：退回旧目录继续用，
        // 绝不落在空的新目录上——那样在用户看来就是"数据全丢了"
        console.warn(
            `[Aico] 数据目录迁移失败，本次继续使用旧目录 ${legacy}：` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        return legacy;
    }
}

/**
 * 解析应用数据根目录，必要时迁移旧目录（幂等，进程内只决策一次）
 *
 * @returns 实际使用的数据根目录绝对路径
 */
export function resolveAppDataDir(): string {
    if (cached) return cached;

    const home = os.homedir();
    cached = migrateAppDataDir(
        path.join(home, APP_DATA_DIR_NAME),
        path.join(home, LEGACY_APP_DATA_DIR_NAME),
    );
    return cached;
}

/** 应用数据根目录（模块加载时即完成旧目录迁移） */
export const APP_DATA_DIR: string = resolveAppDataDir();
