/**
 * resolveSystemCodexBinary 单元测试
 *
 * 桌面瘦身包不随附 @openai/codex-* 平台二进制（省约 500MB），
 * 运行时回退系统 npm 全局安装的 codex。需覆盖 npm 两种真实布局：
 * - 嵌套布局：@openai/codex/node_modules/@openai/codex-win32-x64（npm 现行）
 * - 平铺布局：@openai/codex-win32-x64（pnpm/旧版 npm）
 * 平台包内子目录又有 bin/ 与 codex/ 两种版本差异。
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {resolveSystemCodexBinary} from './codex-binary.js';

describe('resolveSystemCodexBinary', () => {
    let root: string;

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'codex-bin-test-'));
    });

    afterAll(() => {
        rmSync(root, {recursive: true, force: true});
    });

    it('嵌套布局 + bin/ 子目录（Windows exe）', () => {
        const exe = join(root, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64',
            'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
        mkdirSync(join(root, '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64',
            'vendor', 'x86_64-pc-windows-msvc', 'bin'), {recursive: true});
        writeFileSync(exe, 'fake');

        expect(resolveSystemCodexBinary(root, 'win32')).toBe(exe);
    });

    it('平铺布局 + codex/ 子目录（linux 无扩展名）', () => {
        const exe = join(root, 'flat', '@openai', 'codex-win32-x64',
            'vendor', 'x86_64-unknown-linux-musl', 'codex', 'codex');
        mkdirSync(join(root, 'flat', '@openai', 'codex-win32-x64',
            'vendor', 'x86_64-unknown-linux-musl', 'codex'), {recursive: true});
        writeFileSync(exe, 'fake');

        expect(resolveSystemCodexBinary(join(root, 'flat'), 'linux')).toBe(exe);
    });

    it('无匹配时返回 null（目录缺失不抛异常）', () => {
        expect(resolveSystemCodexBinary(join(root, 'not-exist'), 'win32')).toBeNull();
    });
});
