/**
 * 桌面壳设置（关闭行为）持久化单元测试
 *
 * 存储于 Electron userData 目录下的 settings.json；
 * 非法/缺失/损坏一律回退 'ask'（首次关闭弹询问框）。
 */

import {describe, it, expect, beforeEach, afterAll} from 'vitest';
import {mkdtempSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {loadCloseBehavior, saveCloseBehavior} from './tray-settings.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tray-settings-test-'));
});

afterAll(() => {
    rmSync(dir, {recursive: true, force: true});
});

describe('loadCloseBehavior', () => {
    it('无配置文件时返回 ask', () => {
        expect(loadCloseBehavior(dir)).toBe('ask');
    });

    it('损坏 JSON 时返回 ask（不抛异常）', () => {
        writeFileSync(join(dir, 'settings.json'), '{not-json');
        expect(loadCloseBehavior(dir)).toBe('ask');
    });

    it('非法值返回 ask，合法 tray/quit 原样返回', () => {
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({closeBehavior: 'banana'}));
        expect(loadCloseBehavior(join(dir))).toBe('ask');
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({closeBehavior: 'tray'}));
        expect(loadCloseBehavior(dir)).toBe('tray');
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({closeBehavior: 'quit'}));
        expect(loadCloseBehavior(dir)).toBe('quit');
    });
});

describe('saveCloseBehavior', () => {
    it('保存后可读回，且不覆盖同文件其他键', () => {
        writeFileSync(join(dir, 'settings.json'), JSON.stringify({locale: 'zh'}));
        saveCloseBehavior(dir, 'tray');
        expect(loadCloseBehavior(dir)).toBe('tray');
        const raw = JSON.parse(require('fs').readFileSync(join(dir, 'settings.json'), 'utf8'));
        expect(raw.locale).toBe('zh');
    });

    it('目标目录不存在时自动创建', () => {
        const nested = join(dir, 'a', 'b');
        saveCloseBehavior(nested, 'quit');
        expect(loadCloseBehavior(nested)).toBe('quit');
    });
});
