/**
 * app-data-dir 单测 —— 项目改名 Aico 后的数据目录自动迁移
 *
 * 全部用临时目录注入路径，进程内完成，不触碰真实用户主目录。
 * 故障注入：把新目录指向一个父目录不存在的路径，renameSync 必然 ENOENT，
 * 确定性复现「迁移失败」（真实世界里对应旧实例占用目录 / 跨卷）。
 */
import {mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {afterAll, describe, expect, it} from 'vitest';
import {APP_DATA_DIR_NAME, LEGACY_APP_DATA_DIR_NAME, migrateAppDataDir} from './app-data-dir';

const roots: string[] = [];

function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'aico-app-data-'));
    roots.push(home);
    return home;
}

afterAll(() => {
    for (const dir of roots) rmSync(dir, {recursive: true, force: true});
});

describe('migrateAppDataDir（数据目录改名自动迁移）', () => {
    it('常量：新目录 .aico / 历史目录名固定不变', () => {
        expect(APP_DATA_DIR_NAME).toBe('.aico');
        // 历史字面量是迁移的判定基准，被"全局改名"误伤会退化成自我改名
        expect(LEGACY_APP_DATA_DIR_NAME).toBe('.ai-dev-workbench');
        expect(LEGACY_APP_DATA_DIR_NAME).not.toBe(APP_DATA_DIR_NAME);
    });

    it('旧目录存在 + 新目录不存在：原子改名，旧目录消失、数据完整', () => {
        const home = makeHome();
        const legacy = join(home, LEGACY_APP_DATA_DIR_NAME);
        const next = join(home, APP_DATA_DIR_NAME);
        mkdirSync(join(legacy, 'requirements'), {recursive: true});
        writeFileSync(join(legacy, 'config.json'), '{"server":{"port":3000}}');

        expect(migrateAppDataDir(next, legacy)).toBe(next);
        expect(existsSync(legacy)).toBe(false);
        expect(existsSync(join(next, 'config.json'))).toBe(true);
    });

    it('新目录已存在：直接用新目录，绝不碰旧目录（防覆盖）', () => {
        const home = makeHome();
        const legacy = join(home, LEGACY_APP_DATA_DIR_NAME);
        const next = join(home, APP_DATA_DIR_NAME);
        mkdirSync(legacy, {recursive: true});
        mkdirSync(next, {recursive: true});
        writeFileSync(join(legacy, 'old.json'), '{}');
        writeFileSync(join(next, 'new.json'), '{}');

        expect(migrateAppDataDir(next, legacy)).toBe(next);
        expect(existsSync(join(next, 'new.json'))).toBe(true);
        expect(existsSync(join(legacy, 'old.json'))).toBe(true);
    });

    it('两边都不存在：全新安装，直接用新目录', () => {
        const home = makeHome();
        const next = join(home, APP_DATA_DIR_NAME);
        expect(migrateAppDataDir(next, join(home, LEGACY_APP_DATA_DIR_NAME))).toBe(next);
    });

    it('迁移失败（新目录父级不可用 → ENOENT）：退回旧目录，旧数据原地未动', () => {
        const home = makeHome();
        const legacy = join(home, LEGACY_APP_DATA_DIR_NAME);
        mkdirSync(legacy, {recursive: true});
        writeFileSync(join(legacy, 'config.json'), '{"keep":true}');
        // 父目录不存在的目标路径 → renameSync 确定性失败
        const next = join(home, APP_DATA_DIR_NAME, 'unreachable', '.aico');

        expect(migrateAppDataDir(next, legacy)).toBe(legacy);
        expect(existsSync(join(legacy, 'config.json'))).toBe(true);
    });
});
