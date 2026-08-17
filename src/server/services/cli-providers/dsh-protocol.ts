/**
 * @module dsh-protocol
 * @description DeepSeek Harness SDK 运行时（stdio JSON-RPC）最小协议客户端
 *
 * 协议来源：@deepseek-ai/dsh-sdk-protocol —— 换行分帧的 JSON-RPC 2.0。
 * 客户端可用的请求方法只有三个：initialize / session/prompt / shutdown；
 * 服务端推送四个通知：session.event / session.status / subagent.started / subagent.finished。
 *
 * 为什么不直接用官方 @deepseek-ai/dsh-sdk-client：
 * 1) 官方 client 为纯 ESM 包，而 adw 服务端经 tsc 编译为 CommonJS，静态导入不可行；
 * 2) 协议面极小且有 wire 稳定标识（serverInfo.name 恒为 'deepseek-harness-sdk-runtime'），
 *    自行实现可在版本不匹配时 fail-loud；
 * 3) dsh 处于 rc 阶段，独立实现可避免 npm 版本 churn 直接传导进 node_modules 深处。
 *
 * 参考：dsh 仓库 packages/sdk/protocol/src/types.ts（rc.5）。
 */

import {spawn, type ChildProcess} from 'child_process';
import {createHash} from 'crypto';

/** 运行时握手参数（进程级，一次） */
export interface DshInitializeParams {
    /** 工作目录，记录在每个 SDK 会话头部 */
    cwd: string;
    /** 模型路由（如 'deepseek-official'） */
    provider: string;
    /** 模型名 */
    model: string;
    /** 可选的单请求输出 token 上限（agent 及其进程内后代继承） */
    maxTokens?: number;
}

/** 运行时身份（serverInfo.name 为 wire 稳定值） */
export interface DshInitializeResult {
    serverInfo: { name: string; version: string };
}

/** 单次提示词入队参数 */
export interface DshSessionPromptParams {
    /** SDK 侧会话 id；未知 id 会惰性创建 agent+session 对 */
    sessionId: string;
    /** 作为用户消息原样下发的内容块 */
    contentBlocks: Array<{ type: 'text'; text: string }>;
}

/** 提示词入队回执 */
export interface DshSessionPromptResult {
    messageId: string;
}

/**
 * 会话日志事件（宽松本地形状）。
 * 完整判别联合在 dsh-session 包内；此处仅声明投影器消费的字段，
 * data 具体形状由 dsh-projector 按需收窄。
 */
export interface DshSessionEvent {
    /** 事件类型（turn/start、assistant/message、tool/call 等） */
    type: string;
    /** 会话内单调递增序号 */
    seq: number;
    /** Unix epoch 毫秒 */
    time: number;
    /** 按类型变化的载荷 */
    data: Record<string, unknown>;
}

/** 服务端 -> 客户端通知（按方法名判别） */
export type DshNotification =
    | { method: 'session.event'; params: { sessionId: string; event: DshSessionEvent } }
    | { method: 'session.status'; params: { sessionId: string; status: 'idle' | 'running' } }
    | { method: 'subagent.started'; params: { parentSessionId: string; childSessionId: string } }
    | {
        method: 'subagent.finished';
        params: {
            provider: string;
            agentId: string;
            parentSessionId: string;
            childSessionId: string;
            status: 'ok' | 'error';
            stopReason: string;
            lastAssistantMessage?: Array<{ type: string; text?: string }>;
        };
    };

/** 传输关闭错误（进程退出 / 被杀） */
export class DshTransportClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DshTransportClosedError';
    }
}

/** 请求超时错误 */
export class DshRequestTimeoutError extends Error {
    constructor(method: string, timeoutMs: number) {
        super(`dsh runtime request "${method}" timed out after ${timeoutMs}ms`);
        this.name = 'DshRequestTimeoutError';
    }
}

/** JSON-RPC 错误响应（保留协议 code/data） */
export class DshJsonRpcError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(method: string, code: number, message: string, data?: unknown) {
        super(`dsh runtime "${method}" failed (${code}): ${message}`);
        this.name = 'DshJsonRpcError';
        this.code = code;
        this.data = data;
    }
}

/** 客户端选项 */
export interface DshClientOptions {
    /** 可执行文件（通常为 node） */
    command: string;
    /** 命令参数（启动器 + cordis.yml 路径） */
    args: string[];
    /** 子进程环境变量（整体替换；undefined 继承父进程） */
    env?: Record<string, string>;
    /** 子进程工作目录 */
    cwd?: string;
    /** 通知回调 */
    onNotification: (notification: DshNotification) => void;
    /** 单个请求的默认超时（默认 60000ms） */
    requestTimeoutMs?: number;
    /** stderr 尾部保留长度（诊断用，默认 8192 字符） */
    stderrTailLimit?: number;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * DeepSeek Harness SDK 运行时的最小 JSON-RPC stdio 客户端。
 *
 * 生命周期：spawn 惰性发生在构造时；close() 走
 * shutdown 请求(1s) -> stdin EOF(6s) -> SIGTERM(3s) -> SIGKILL 的回收阶梯，幂等。
 */
export class DshJsonRpcClient {
    private readonly options: DshClientOptions;
    private readonly child: ChildProcess;
    private readonly pending = new Map<number, PendingRequest>();
    private nextId = 1;
    private stdoutBuffer = '';
    private stderrTail = '';
    private closed = false;
    private closePromise: Promise<void> | null = null;
    private exitCode: number | null = null;

    constructor(options: DshClientOptions) {
        this.options = options;
        this.child = spawn(options.command, options.args, {
            env: options.env,
            cwd: options.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        this.child.stdout?.setEncoding('utf-8');
        this.child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
        this.child.stderr?.setEncoding('utf-8');
        this.child.stderr?.on('data', (chunk: string) => {
            const limit = options.stderrTailLimit ?? 8192;
            this.stderrTail = (this.stderrTail + chunk).slice(-limit);
        });
        this.child.on('error', (err) => this.rejectAll(new DshTransportClosedError(`spawn failed: ${err.message}`)));
        this.child.on('close', (code) => {
            this.exitCode = code;
            this.rejectAll(
                new DshTransportClosedError(
                    `dsh runtime exited (code=${code})${this.stderrTail ? `\nstderr tail:\n${this.stderrTail}` : ''}`,
                ),
            );
        });
        this.child.on('exit', (code) => {
            this.exitCode = code ?? null;
        });
    }

    /** 是否已关闭（进程退出或已 close） */
    get isClosed(): boolean {
        return this.closed || this.child.exitCode !== null;
    }

    /** 进程退出码（未退出为 null） */
    get processExitCode(): number | null {
        return this.exitCode ?? this.child.exitCode ?? null;
    }

    /** stderr 尾部（诊断） */
    get stderrTailText(): string {
        return this.stderrTail;
    }

    /** 发送一个 JSON-RPC 请求并等待响应 */
    async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
        if (this.isClosed) {
            throw new DshTransportClosedError('dsh runtime is closed');
        }
        const id = this.nextId++;
        const timeout = timeoutMs ?? this.options.requestTimeoutMs ?? 60_000;
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new DshRequestTimeoutError(method, timeout));
            }, timeout);
            this.pending.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            this.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
        });
    }

    /** initialize 握手；校验 wire 稳定身份 */
    async initialize(params: DshInitializeParams, timeoutMs = 60_000): Promise<DshInitializeResult> {
        const result = await this.request<DshInitializeResult>('initialize', params, timeoutMs);
        if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') {
            throw new DshTransportClosedError(
                `unexpected runtime identity: ${JSON.stringify(result?.serverInfo)} (expected 'deepseek-harness-sdk-runtime')`,
            );
        }
        return result;
    }

    /** 提交一条用户消息（立即返回入队回执，不等待 agent 活动） */
    async prompt(params: DshSessionPromptParams, timeoutMs = 60_000): Promise<DshSessionPromptResult> {
        return this.request<DshSessionPromptResult>('session/prompt', params, timeoutMs);
    }

    /**
     * 关闭客户端：shutdown -> stdin EOF -> SIGTERM -> SIGKILL 阶梯，幂等。
     * 返回的 Promise 在进程真正退出后结算。
     */
    close(): Promise<void> {
        if (this.closePromise) return this.closePromise;
        this.closePromise = this.closeInternal();
        return this.closePromise;
    }

    private async closeInternal(): Promise<void> {
        this.closed = true;
        // 1) 优雅 shutdown（有界等待）
        try {
            await this.request('shutdown', undefined, 1_000);
        } catch {
            // 超时/失败继续走阶梯
        }
        // 2) stdin EOF
        const eofDead = this.waitExit(6_000);
        this.child.stdin?.end();
        if (await eofDead) return;
        // 3) SIGTERM
        const termDead = this.waitExit(3_000);
        try {
            this.child.kill('SIGTERM');
        } catch { /* already dead */ }
        if (await termDead) return;
        // 4) SIGKILL
        try {
            this.child.kill('SIGKILL');
        } catch { /* already dead */ }
        await this.waitExit(3_000);
    }

    /** 等待进程退出；超时返回 false */
    private waitExit(timeoutMs: number): Promise<boolean> {
        if (this.child.exitCode !== null) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), timeoutMs);
            this.child.once('close', () => {
                clearTimeout(timer);
                resolve(true);
            });
        });
    }

    private writeLine(line: string): void {
        if (this.child.stdin?.writable) {
            this.child.stdin.write(line + '\n');
        }
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let newlineIdx = this.stdoutBuffer.indexOf('\n');
        while (newlineIdx >= 0) {
            const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
            if (line) this.handleLine(line);
            newlineIdx = this.stdoutBuffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        let frame: unknown;
        try {
            frame = JSON.parse(line);
        } catch {
            return; // 非法 JSON 行按协议忽略
        }
        if (typeof frame !== 'object' || frame === null) return;
        const msg = frame as Record<string, unknown>;
        if (typeof msg.id === 'number' && typeof msg.method !== 'string') {
            // 响应帧
            const pending = this.pending.get(msg.id);
            if (!pending) return;
            this.pending.delete(msg.id);
            clearTimeout(pending.timer);
            if (typeof msg.error === 'object' && msg.error !== null) {
                const err = msg.error as { code?: number; message?: string; data?: unknown };
                pending.reject(
                    new DshJsonRpcError('<response>', err.code ?? -32603, err.message ?? 'unknown error', err.data),
                );
            } else {
                pending.resolve(msg.result);
            }
        } else if (typeof msg.method === 'string' && msg.id === undefined) {
            // 通知帧
            this.options.onNotification({
                method: msg.method,
                params: (msg.params ?? {}) as DshNotification extends { method: infer T } ? never : never,
            } as DshNotification);
        }
        // 带有 id+method 的帧为请求帧：协议中服务端从不发请求（审批流为预留能力），忽略
    }

    private rejectAll(err: Error): void {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timer);
            pending.reject(err);
        }
        this.pending.clear();
    }
}

/** 生成池 key / yml 文件名用的稳定 hash */
export function stableHash(value: unknown): string {
    return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}
