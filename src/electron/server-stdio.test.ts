/**
 * buildServerStdio 单元测试（回归：2026-09-11 桌面版首启崩溃）
 *
 * 根因：生产模式把 fs.createWriteStream 直接传给 spawn 的 stdio，
 * 流异步打开前 fd 为 null，child_process 以 ERR_INVALID_ARG_VALUE 拒绝。
 * 本测试验证：生产模式返回 fd 数字数组，且真实子进程的输出能落盘。
 */

import {describe, it, expect} from 'vitest';
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {buildServerStdio} from './server-stdio.js';

function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'adw-stdio-'));
}

describe('buildServerStdio', () => {
    it('开发模式返回 inherit', () => {
        expect(buildServerStdio(true, tmpDir())).toBe('inherit');
    });

    it('生产模式返回 fd 数字数组而非流对象', () => {
        const stdio = buildServerStdio(false, tmpDir());
        expect(Array.isArray(stdio)).toBe(true);
        const arr = stdio as Array<string | number | null>;
        expect(arr[0]).toBe('ignore');
        expect(typeof arr[1]).toBe('number');
        expect(typeof arr[2]).toBe('number');
        expect(arr[1]).toBe(arr[2]); // stdout/stderr 共用同一追加句柄
        fs.closeSync(arr[1] as number);
    });

    it('真实子进程经该 stdio 写入的输出落盘（含启动横幅）', () => {
        const dir = tmpDir();
        const stdio = buildServerStdio(false, dir);
        const res = spawnSync(process.execPath, ['-e', 'console.log("stdio-ok")'], {
            stdio: stdio as unknown as ['ignore', number, number],
        });
        expect(res.status).toBe(0);
        fs.closeSync((stdio as Array<string | number | null>)[1] as number);
        const content = fs.readFileSync(path.join(dir, 'desktop-server.log'), 'utf-8');
        expect(content).toContain('===== [desktop] server starting');
        expect(content).toContain('stdio-ok');
    });
});
