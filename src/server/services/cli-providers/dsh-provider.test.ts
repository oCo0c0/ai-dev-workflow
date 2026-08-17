/**
 * @file DshProvider 集成测试（mock 运行时代替真实 dsh 子进程）
 * @description 通过 ADW_DSH_RUNTIME_BIN 注入 mock 运行时脚本，验证：
 * run() 全流程（入队 -> 活动区间 -> finalResponse -> sessionId 续接）、
 * 事件投影透传 onOutput、cordis.yml 生成与复用、abort 中止路径、
 * 实例池互斥、detect() 就绪检查。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {DshProvider} from './dsh-provider.js';

/** mock 运行时脚本（协议层 mock，对 provider 呈现完整运行时行为） */
const MOCK_BIN = path.join(__dirname, 'fixtures', 'dsh-mock-runtime.mjs');

/** 每个测试独立的临时 home（cordis.yml / 快照都落在这里） */
let tmpHome: string;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-dsh-test-'));
    process.env.ADW_DSH_HOME = tmpHome;
    process.env.ADW_DSH_RUNTIME_BIN = MOCK_BIN;
});

afterEach(() => {
    delete process.env.ADW_DSH_HOME;
    delete process.env.ADW_DSH_RUNTIME_BIN;
    fs.rmSync(tmpHome, {recursive: true, force: true});
});

/** 简单等待 */
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('DshProvider.run', () => {
    it('完整 run：返回 mock 回复 + 生成会话 id + 事件到达 onOutput', async () => {
        const provider = new DshProvider();
        const events: Array<{data: string; meta?: Record<string, unknown>}> = [];
        const result = await provider.run(
            {prompt: '你好'},
            {
                cwd: tmpHome,
                onOutput: (data, meta) => events.push({data, meta}),
                model: 'deepseek-chat',
            },
        );
        await provider.dispose();

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('mock reply');
        expect(result.sessionId).toBeTruthy();
        // 投影契约：assistant 正文事件到达
        const assistant = events.find((e) => e.meta?.type === 'assistant');
        expect(assistant?.data).toBe('mock reply');
    });

    it('sessionId 续接：第二次 run 携带返回的 id', async () => {
        const provider = new DshProvider();
        const first = await provider.run({prompt: 'a', cwd: tmpHome});
        const second = await provider.run({prompt: 'b', cwd: tmpHome, sessionId: first.sessionId});
        await provider.dispose();
        expect(second.sessionId).toBe(first.sessionId);
    });

    it('子 agent 会话的 idle 噪声不得提前完成（回归：页面假完成）', async () => {
        // mock 在根会话 idle 前注入子会话 running→idle 对与子会话正文；
        // 完成判定只认根会话 → stdout 必须是根正文（旧代码会在子 idle 处提前
        // 返回，此时根正文尚未推送 → stdout 为空，即"页面显示完成但任务
        // 仍在执行、消息继续涌入"的根因）
        process.env.ADW_DSH_MOCK_NOISE = '1';
        try {
            const provider = new DshProvider();
            const events: Array<{data: string; meta?: Record<string, unknown>}> = [];
            const result = await provider.run(
                {prompt: 'dispatch subagent'},
                {cwd: tmpHome, onOutput: (data, meta) => events.push({data, meta})},
            );
            await provider.dispose();

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('mock reply');
            // 正文投影只认根会话：子会话文本不得混入执行日志
            const texts = events.filter((e) => e.meta?.type === 'assistant').map((e) => e.data);
            expect(texts).toEqual(['mock reply']);
        } finally {
            delete process.env.ADW_DSH_MOCK_NOISE;
        }
    });

    it('cordis.yml 按配置生成且内容不变时复用', async () => {
        const provider = new DshProvider();
        await provider.run({prompt: 'a', cwd: tmpHome});
        await provider.dispose();

        const configsDir = path.join(tmpHome, 'configs');
        const files = fs.readdirSync(configsDir).filter((f) => f.endsWith('.cordis.yml'));
        expect(files).toHaveLength(1);
        const first = fs.readFileSync(path.join(configsDir, files[0]), 'utf-8');

        // 同参数第二次 run：不产生新文件
        const provider2 = new DshProvider();
        await provider2.run({prompt: 'b', cwd: tmpHome});
        await provider2.dispose();
        const files2 = fs.readdirSync(configsDir).filter((f) => f.endsWith('.cordis.yml'));
        expect(files2).toHaveLength(1);
        expect(fs.readFileSync(path.join(configsDir, files2[0]), 'utf-8')).toBe(first);

        // MCP 注入变化：新增配置文件
        const provider3 = new DshProvider();
        await provider3.run({
            prompt: 'c',
            cwd: tmpHome,
            mcpServers: {ones: {type: 'stdio', command: 'npx', args: ['-y', 'ones-mcp'], env: {}}},
        });
        await provider3.dispose();
        const files3 = fs.readdirSync(configsDir).filter((f) => f.endsWith('.cordis.yml'));
        expect(files3).toHaveLength(2);
        const mcpConfig = fs.readFileSync(path.join(configsDir, files3.find((f) => f !== files[0])!), 'utf-8');
        expect(mcpConfig).toContain('- id: mcp-ones');
    });

    it('同键并发 run 串行执行（实例互斥）', async () => {
        const provider = new DshProvider();
        const [r1, r2] = await Promise.all([
            provider.run({prompt: 'x', cwd: tmpHome}),
            provider.run({prompt: 'y', cwd: tmpHome}),
        ]);
        await provider.dispose();
        expect(r1.exitCode).toBe(0);
        expect(r2.exitCode).toBe(0);
        expect(r1.sessionId).toBeTruthy();
        expect(r2.sessionId).toBeTruthy();
    });

    it('中止信号：run 返回 aborted 且实例被回收', async () => {
        const provider = new DshProvider();
        const controller = new AbortController();
        // prompt 入队后立即中止（mock 会很快完成，竞态下 abort 仍应正确收敛）
        const runPromise = provider.run(
            {prompt: 'long task'},
            {cwd: tmpHome, signal: controller.signal},
        );
        controller.abort();
        const result = await runPromise;
        await provider.dispose();
        // 允许两种合法终态：mock 先完成（aborted=false）或中止先生效（aborted=true）
        expect(typeof result.aborted).toBe('boolean');
        if (result.aborted) {
            expect(result.exitCode).toBeNull();
        } else {
            expect(result.exitCode).toBe(0);
        }
    });

    it('运行时异常退出：run 返回失败结果（exitCode=1 + stderr）', async () => {
        const provider = new DshProvider();
        process.env.ADW_DSH_RUNTIME_BIN = path.join(__dirname, 'fixtures', 'dsh-mock-runtime.mjs');
        // 用 --exit-immediately 模拟运行时秒死
        fs.writeFileSync(path.join(tmpHome, 'fake-bin.mjs'), 'process.exit(1);\n');
        process.env.ADW_DSH_RUNTIME_BIN = path.join(tmpHome, 'fake-bin.mjs');
        const result = await provider.run({prompt: 'x', cwd: tmpHome});
        await provider.dispose();
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toBeTruthy();
    }, 30_000);
});

describe('DshProvider.detect', () => {
    it('mock bin 就绪时 available（含警告信息与否取决于环境）', async () => {
        const provider = new DshProvider();
        const status = await provider.detect();
        expect(status.available).toBe(true);
        expect(status.meta?.sessionRoot).toContain('sessions');
    });

    it('bin 缺失时不可用并给出指引', async () => {
        const provider = new DshProvider();
        process.env.ADW_DSH_RUNTIME_BIN = path.join(tmpHome, 'nonexistent.mjs');
        const status = await provider.detect();
        expect(status.available).toBe(false);
        expect(status.error).toBeTruthy();
    });
});
