/**
 * 桌面壳设置持久化（Electron userData/settings.json）
 *
 * 目前仅一项：关闭窗口行为（ask=每次询问 / tray=最小化到托盘 / quit=直接退出）。
 * 读取零异常：文件缺失/损坏/值非法一律回退 'ask'。
 */

import {readFileSync, writeFileSync, mkdirSync} from 'fs';
import {join} from 'path';

export type CloseBehavior = 'ask' | 'tray' | 'quit';

const SETTINGS_FILE = 'settings.json';

/** 读取关闭行为；任何异常回退 'ask' */
export function loadCloseBehavior(userDataDir: string): CloseBehavior {
    try {
        const raw = JSON.parse(readFileSync(join(userDataDir, SETTINGS_FILE), 'utf8')) as {
            closeBehavior?: unknown;
        };
        return raw.closeBehavior === 'tray' || raw.closeBehavior === 'quit' ? raw.closeBehavior : 'ask';
    } catch {
        return 'ask';
    }
}

/** 保存关闭行为（合并写，不覆盖同文件其他键） */
export function saveCloseBehavior(userDataDir: string, behavior: CloseBehavior): void {
    const file = join(userDataDir, SETTINGS_FILE);
    let current: Record<string, unknown> = {};
    try {
        current = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        // 文件缺失/损坏 → 全新写入
    }
    mkdirSync(userDataDir, {recursive: true});
    writeFileSync(file, JSON.stringify({...current, closeBehavior: behavior}, null, 2));
}
