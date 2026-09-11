/**
 * @module pi-rpc-process.test
 * @description PiRpcProcess 单元测试（假子进程注入，不依赖真实 pi 安装）
 *
 * 覆盖：
 * - 启动就绪握手（get_state 往返）
 * - 命令 id 关联 / success:false 拒绝 / 超时拒绝
 * - 事件行与 stderr 分流回调
 * - 进程退出时 pending 全部拒绝、alive 置 false
 * - kill()：stdin end 优雅退出路径
 * - findSessionFile：pi 原生 `<ts>_<id>.jsonl` 与旧约定 `<id>.jsonl` 两种形状 + 路径穿越防护
 */

import {describe, it, expect, vi} from 'vitest';
import {PassThrough, type Readable, type Writable} from 'stream';
import {EventEmitter} from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {PiRpcProcess, findSessionFile, type PiSpawnFn} from './pi-rpc-process.js';

/** 假子进程：PassThrough 流 + EventEmitter 模拟 exit/error */
class FakeChild extends EventEmitter {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
    exitCode: number | null = null;
    killed = false;
    pid = 4242;

    /** 测试驱动：收到的请求行 */
    requests: Array<Record<string, unknown>> = [];

    constructor() {
        super();
        let buf = '';
        this.stdin.on('data', (chunk: Buffer) => {
            buf += chunk.toString('utf-8');
            let idx: number;
            while ((idx = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, idx).trim();
                buf = buf.slice(idx + 1);
                if (line) this.onLine(line);
            }
        });
        // 对齐真实 rpc-mode：stdin 关闭（end）即优雅退出
        this.stdin.on('end', () => {
            setImmediate(() => this.simulateExit(0));
        });
    }

    private onLine(line: string): void {
        let cmd: Record<string, unknown>;
        try {
            cmd = JSON.parse(line) as Record<string, unknown>;
        } catch {
            return;
        }
        this.requests.push(cmd);
        this.emit('command', cmd);
    }

    /** 按请求行回写应答 */
    respond(cmd: Record<string, unknown>, data: unknown, success = true): void {
        this.stdout.write(`${JSON.stringify({
            id: cmd.id,
            type: 'response',
            command: cmd.type,
            success,
            ...(success ? {data} : {error: String(data)}),
        })}\n`);
    }

    /** 推送一行事件（非 response） */
    pushEvent(event: Record<string, unknown>): void {
        this.stdout.write(`${JSON.stringify(event)}\n`);
    }

    simulateExit(code = 0): void {
        this.exitCode = code;
        this.emit('exit', code);
    }
}

function fakeSpawn(child: FakeChild): PiSpawnFn {
    return () => child as unknown as import('child_process').ChildProcess;
}

/** 构造自动应答 get_state 的假子进程 spawn 函数 */
function autoStateSpawn(state: Record<string, unknown> = {sessionId: 's-1', isStreaming: false}) {
    const child = new FakeChild();
    child.on('command', (cmd: Record<string, unknown>) => {
        if (cmd.type === 'get_state') child.respond(cmd, state);
    });
    return {child, spawnFn: fakeSpawn(child)};
}

describe('PiRpcProcess', () => {
    it('start() 完成 get_state 就绪握手', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/sessions', rpcEntry: 'fake-entry.js'},
            {},
            spawnFn,
        );
        expect(proc.alive).toBe(true);
        expect(proc.pid).toBe(4242);
        // 启动参数包含 session-dir
        expect(child.requests[0]?.type).toBe('get_state');
        await proc.kill();
    });

    it('spawn 收到的 argv 按协议拼装（session-dir/provider/model/thinking/tools/-e/no-extensions）', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const calls: Array<{command: string; args: string[]}> = [];
        const wrapped: PiSpawnFn = (command, args, opts) => {
            calls.push({command, args});
            return spawnFn(command, args, opts);
        };
        await PiRpcProcess.start(
            {
                cwd: 'D:/ws',
                sessionDir: 'X:/s',
                sessionFile: 'X:/s/20260101T000000_abc.jsonl',
                provider: 'deepseek',
                model: 'deepseek-chat',
                thinkingLevel: 'high',
                extensionPath: 'R:/ext/adw-platform.ts',
                rpcEntry: 'fake-entry.js',
            },
            {},
            wrapped,
        );
        expect(calls[0].command).toBe(process.execPath);
        const args = calls[0].args.join(' ');
        expect(args).toContain('--session-dir X:/s');
        expect(args).toContain('--session X:/s/20260101T000000_abc.jsonl');
        expect(args).toContain('--provider deepseek');
        expect(args).toContain('--model deepseek-chat');
        expect(args).toContain('--thinking high');
        expect(args).toContain('--no-extensions -e R:/ext/adw-platform.ts');
    });

    it('桌面版（ADW_DESKTOP=1）spawn 环境注入 ELECTRON_RUN_AS_NODE=1（防子进程变新 GUI 实例撞单实例锁）', async () => {
        const {spawnFn} = autoStateSpawn();
        const envs: Array<Record<string, string> | undefined> = [];
        const wrapped: PiSpawnFn = (command, args, opts) => {
            envs.push(opts?.env);
            return spawnFn(command, args, opts);
        };
        const prev = process.env.ADW_DESKTOP;
        process.env.ADW_DESKTOP = '1';
        try {
            await PiRpcProcess.start({cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, wrapped);
        } finally {
            if (prev === undefined) delete process.env.ADW_DESKTOP;
            else process.env.ADW_DESKTOP = prev;
        }
        expect(envs[0]?.ELECTRON_RUN_AS_NODE).toBe('1');
    });

    it('非桌面环境不注入 ELECTRON_RUN_AS_NODE', async () => {
        const {spawnFn} = autoStateSpawn();
        const envs: Array<Record<string, string> | undefined> = [];
        const wrapped: PiSpawnFn = (command, args, opts) => {
            envs.push(opts?.env);
            return spawnFn(command, args, opts);
        };
        const prev = process.env.ADW_DESKTOP;
        delete process.env.ADW_DESKTOP;
        try {
            await PiRpcProcess.start({cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, wrapped);
        } finally {
            if (prev !== undefined) process.env.ADW_DESKTOP = prev;
        }
        expect(envs[0]?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it('send() 按 id 关联应答并返回 data', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, spawnFn,
        );
        child.on('command', (cmd: Record<string, unknown>) => {
            if (cmd.type === 'get_last_assistant_text') {
                child.respond(cmd, {text: 'hello'});
            }
        });
        const data = await proc.send({type: 'get_last_assistant_text'});
        expect(data).toEqual({text: 'hello'});
        await proc.kill();
    });

    it('send() 对 success:false 应答抛出错误消息', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, spawnFn,
        );
        child.on('command', (cmd: Record<string, unknown>) => {
            if (cmd.type === 'set_model') child.respond(cmd, 'Model not found: x/y', false);
        });
        await expect(proc.send({type: 'set_model', provider: 'x', modelId: 'y'}))
            .rejects.toThrow('Model not found: x/y');
        await proc.kill();
    });

    it('send() 超时拒绝', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, spawnFn,
        );
        await expect(proc.send({type: 'compact'}, 50)).rejects.toThrow('timeout');
        await proc.kill();
    });

    it('事件行与 stderr 分别回调 onEvent/onStderr', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const events: Array<Record<string, unknown>> = [];
        const stderrs: string[] = [];
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'},
            {onEvent: (e) => events.push(e), onStderr: (t) => stderrs.push(t)},
            spawnFn,
        );
        child.pushEvent({type: 'agent_start'});
        child.pushEvent({type: 'extension_ui_request', id: 'u1', method: 'confirm', title: 'bash'});
        child.stderr.write('[warn] something\n');
        await new Promise((r) => setTimeout(r, 20));
        expect(events.map((e) => e.type)).toEqual(['agent_start', 'extension_ui_request']);
        expect(stderrs).toEqual(['[warn] something']);
        await proc.kill();
    });

    it('进程退出时 pending 拒绝、alive=false、onExit 触发', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const onExit = vi.fn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'},
            {onExit},
            spawnFn,
        );
        const pending = proc.send({type: 'compact'});
        child.simulateExit(1);
        await expect(pending).rejects.toThrow('exited (code 1)');
        expect(proc.alive).toBe(false);
        expect(onExit).toHaveBeenCalledWith(1);
    });

    it('kill() 关闭 stdin 并等待退出', async () => {
        const {child, spawnFn} = autoStateSpawn();
        const proc = await PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, spawnFn,
        );
        const ended = new Promise<void>((resolve) => child.stdin.once('end', resolve));
        const killPromise = proc.kill();
        await ended;
        // stdin end 后 FakeChild 自动优雅退出（对齐真实 rpc-mode 行为）
        await killPromise;
        expect(proc.alive).toBe(false);
    });

    it('就绪握手失败时杀掉子进程并抛出', async () => {
        const child = new FakeChild(); // 不应答 get_state
        const spawnFn = fakeSpawn(child);
        await expect(PiRpcProcess.start(
            {cwd: process.cwd(), sessionDir: 'X:/s', rpcEntry: 'f.js'}, {}, spawnFn, 80,
        )).rejects.toThrow('timeout');
        // 失败路径已请求子进程退出（stdin end）
        expect(child.stdin.writableEnded).toBe(true);
    });
});

describe('findSessionFile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sessions-test-'));

    it('匹配 pi 原生 `<timestamp>_<sessionId>.jsonl` 形状', () => {
        const file = path.join(dir, '2026-01-02T03-04-05-000Z_018fabc-def0-1234-5678-9abcdef01234.jsonl');
        fs.writeFileSync(file, '');
        const found = findSessionFile('018fabc-def0-1234-5678-9abcdef01234', dir);
        expect(found).toBe(file);
    });

    it('兼容旧约定 `<sessionId>.jsonl` 精确名', () => {
        const file = path.join(dir, 'mysession123.jsonl');
        fs.writeFileSync(file, '');
        expect(findSessionFile('mysession123', dir)).toBe(file);
    });

    it('不存在时返回 undefined', () => {
        expect(findSessionFile('no-such-session', dir)).toBeUndefined();
    });

    it('非法字符（路径穿越）直接拒绝', () => {
        expect(findSessionFile('../../etc/passwd', dir)).toBeUndefined();
        expect(findSessionFile('a/b', dir)).toBeUndefined();
    });
});
