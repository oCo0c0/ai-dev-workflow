/**
 * @file DshJsonRpcClient 协议测试（回环：Node 子进程作为 mock 运行时）
 * @description mock 进程按行读 JSON-RPC：对 initialize/session/prompt/shutdown
 * 应答，并主动推送通知。验证客户端的帧分帧、请求配对、通知分发、
 * 非法行忽略、close 阶梯与身份校验。
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {DshJsonRpcClient, DshNotification, DshTransportClosedError} from './dsh-protocol.js';

/** mock 运行时脚本路径（同目录 fixtures） */
const MOCK_BIN = new URL('./fixtures/dsh-mock-runtime.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

describe('DshJsonRpcClient', () => {
    it('initialize 校验 wire 身份并返回版本', async () => {
        const notifications: DshNotification[] = [];
        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [MOCK_BIN],
            onNotification: (n) => notifications.push(n),
            requestTimeoutMs: 5_000,
        });
        const init = await client.initialize({cwd: 'D:\\w', provider: 'deepseek-official', model: 'm'});
        expect(init.serverInfo.name).toBe('deepseek-harness-sdk-runtime');
        expect(init.serverInfo.version).toBe('0.0.1-mock');
        await client.close();
    });

    it('prompt 应答回执并推送通知（事件按序到达）', async () => {
        const notifications: DshNotification[] = [];
        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [MOCK_BIN],
            onNotification: (n) => notifications.push(n),
            requestTimeoutMs: 5_000,
        });
        await client.initialize({cwd: 'D:\\w', provider: 'p', model: 'm'});
        const receipt = await client.prompt({sessionId: 's1', contentBlocks: [{type: 'text', text: 'hi'}]});
        expect(typeof receipt.messageId).toBe('string');
        // mock 收到 prompt 后推送 status + event 两条通知
        await new Promise((r) => setTimeout(r, 300));
        expect(notifications.map((n) => n.method)).toEqual(['session.status', 'session.event']);
        expect(notifications[1].method === 'session.event' && notifications[1].params.event.type).toBe('assistant/message');
        await client.close();
    });

    it('错误响应转为 DshJsonRpcError（保留 code）', async () => {
        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [MOCK_BIN, '--fail-next'],
            onNotification: () => {},
            requestTimeoutMs: 5_000,
        });
        await expect(client.request('session/prompt', {})).rejects.toMatchObject({
            name: 'DshJsonRpcError',
            code: -32603,
        });
        await client.close();
    });

    it('进程死亡后请求拒绝为 DshTransportClosedError', async () => {
        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [MOCK_BIN, '--exit-immediately'],
            onNotification: () => {},
            requestTimeoutMs: 5_000,
        });
        await expect(client.initialize({cwd: 'D:\\w', provider: 'p', model: 'm'}))
            .rejects.toBeInstanceOf(DshTransportClosedError);
    });

    it('close 幂等且进程真正退出', async () => {
        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [MOCK_BIN],
            onNotification: () => {},
            requestTimeoutMs: 5_000,
        });
        await client.initialize({cwd: 'D:\\w', provider: 'p', model: 'm'});
        await client.close();
        await client.close(); // 幂等
        expect(client.isClosed).toBe(true);
        expect(client.processExitCode).toBe(0);
    });
});
