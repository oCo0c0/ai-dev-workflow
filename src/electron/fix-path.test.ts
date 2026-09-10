/**
 * fix-path 纯函数单元测试
 *
 * 覆盖登录 shell PATH 输出提取与 PATH 合并（去重/前置补齐/空段过滤）。
 * fixPath() 本身依赖真实 shell 与进程环境，由桌面版冒烟验证。
 */

import {describe, it, expect} from 'vitest';
import path from 'path';
import {extractShellPath, mergePath} from './fix-path.js';

const D = path.delimiter;

describe('extractShellPath', () => {
    it('提取标记后的 PATH 行（含登录横幅噪声）', () => {
        const out = `Last login: Tue Sep 10 09:00:00 on ttys001\n__ADW_SHELL_PATH__/opt/homebrew/bin${D}/usr/local/bin\n`;
        expect(extractShellPath(out)).toBe(`/opt/homebrew/bin${D}/usr/local/bin`);
    });

    it('无标记返回 null', () => {
        expect(extractShellPath('no marker here')).toBeNull();
    });

    it('标记后无有效内容返回 null', () => {
        expect(extractShellPath('x\n__ADW_SHELL_PATH__\n')).toBeNull();
    });
});

describe('mergePath', () => {
    it('缺失条目前置补充并去重', () => {
        expect(mergePath(`/usr/bin${D}/bin`, `/opt/homebrew/bin${D}/usr/bin`))
            .toBe(`/opt/homebrew/bin${D}/usr/bin${D}/bin`);
    });

    it('空 current 只保留 shell 条目', () => {
        expect(mergePath('', `/a${D}/b`)).toBe(`/a${D}/b`);
    });

    it('空段被过滤', () => {
        expect(mergePath(`${D}/usr/bin${D}`, `/usr/bin`)).toBe(`/usr/bin`);
    });
});
