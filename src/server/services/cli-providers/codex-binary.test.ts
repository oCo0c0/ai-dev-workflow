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
import {getNpmGlobalRoot, resolveSystemCodexBinary} from './codex-binary.js';

describe('getNpmGlobalRoot', () => {
    it('从 node 可执行文件位置推导全局根（<nodeDir>/node_modules）', () => {
        const fakeNodeDir = mkdtempSync(join(tmpdir(), 'npm-root-test-'));
        try {
            mkdirSync(join(fakeNodeDir, 'node_modules'));
            expect(getNpmGlobalRoot(join(fakeNodeDir, 'node.exe'))).toBe(join(fakeNodeDir, 'node_modules'));
        } finally {
            rmSync(fakeNodeDir, {recursive: true, force: true});
        }
    });

    it('execPath 旁无 node_modules 时走 npm 子进程兜底，不抛异常（返回值随环境）', () => {
        const bareDir = mkdtempSync(join(tmpdir(), 'npm-root-bare-'));
        try {
            // 本机 npm 可用时会返回真实全局根；npm 不可用时为 null —— 两者皆合法
            const result = getNpmGlobalRoot(join(bareDir, 'AI Dev Workbench.exe'));
            expect(result === null || typeof result === 'string').toBe(true);
        } finally {
            rmSync(bareDir, {recursive: true, force: true});
        }
    });
});

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

    it('npmRoot 为 null 时防御性返回 null（不抛异常）', () => {
        expect(resolveSystemCodexBinary(null as unknown as string, 'win32')).toBeNull();
    });
});
