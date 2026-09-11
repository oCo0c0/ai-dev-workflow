/**
 * @module pi-rpc-process
 * @description pi RPC 子进程管理（pi 作为底层 harness 的传输层）
 *
 * 通过 spawn `@earendil-works/pi-coding-agent` 的 rpc-entry（即 `pi --mode rpc`）
 * 获得一个长驻无头 agent 子进程：
 * - stdin  写 JSONL 命令（prompt / steer / abort / new_session / get_state / ...）
 * - stdout 读 JSONL 行：`{type:'response'}` 为命令应答（按 id 关联），
 *   其余为事件流（AgentSessionEvent、extension_ui_request 等）
 * - stdin 关闭时子进程优雅退出（官方语义），超时则强杀进程树
 *
 * 设计要点：
 * - 命令/应答按自增 id 关联，带超时；进程退出时全部拒绝
 * - 事件行原样回调（onEvent），由 Provider 层做归一化
 * - spawn 函数可注入（测试用假子进程）
 * - rpc 入口解析：ADW_PI_RPC_ENTRY 环境变量 > 从本文件向上逐级找
 *   node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js
 *   （包为 ESM-only 且 exports 无 require 条件，require.resolve 不可用）
 */

import {spawn, type ChildProcess} from 'child_process';
import {createInterface} from 'readline';
import {existsSync, readdirSync} from 'fs';
import path from 'path';

/** pi RPC 子进程启动参数 */
export interface PiRpcSpawnOptions {
    /** 工作区目录（子进程 cwd，决定 pi 的项目资源发现范围） */
    cwd: string;
    /** 会话存储目录（--session-dir） */
    sessionDir: string;
    /** 续接指定会话文件（--session，绝对路径） */
    sessionFile?: string;
    /** LLM 提供商（--provider） */
    provider?: string;
    /** 模型 id（--model） */
    model?: string;
    /** 思考等级（--thinking：off/minimal/low/medium/high/xhigh/max） */
    thinkingLevel?: string;
    /** 内置工具白名单（--tools） */
    tools?: string[];
    /** 显式加载的扩展文件路径（-e） */
    extensionPath?: string;
    /** 追加环境变量（各家 API key、平台网关地址等） */
    env?: Record<string, string>;
    /** rpc 入口 JS 覆盖（默认自动解析） */
    rpcEntry?: string;
}

/** 子进程生命周期回调 */
export interface PiRpcHooks {
    /** 事件行（非 response 的 JSON 行：agent 事件 / extension_ui_request / extension_error） */
    onEvent?: (event: Record<string, unknown>) => void;
    /** stderr 输出（诊断信息） */
    onStderr?: (text: string) => void;
    /** 进程退出（异常退出时 pending 命令已被拒绝） */
    onExit?: (code: number | null) => void;
}

/** 可注入的 spawn 实现（测试用） */
export type PiSpawnFn = (
    command: string,
    args: string[],
    options: {cwd: string; env: Record<string, string>},
) => ChildProcess;

/** 默认启用的内置工具：读写编辑 + 双 shell + 安全搜索 */
export const DEFAULT_PI_TOOLS = ['read', 'bash', 'powershell', 'edit', 'write', 'grep', 'find', 'ls'];

/** 单命令应答超时 */
const COMMAND_TIMEOUT_MS = 120_000;
/** 启动就绪握手超时（Windows 冷启动 + 扩展 session_start 拉取工具目录） */
const READY_TIMEOUT_MS = 60_000;
/** 优雅退出等待（stdin 关闭后给子进程的收尾时间） */
const GRACEFUL_EXIT_MS = 5_000;

/**
 * 解析 pi rpc-entry 的绝对路径
 * @description 优先环境变量 ADW_PI_RPC_ENTRY；否则从本模块位置向上查找
 * node_modules 中的包内入口（pnpm 符号链接布局同样适用）。
 */
export function resolveRpcEntry(explicit?: string): string {
    const candidate = explicit ?? process.env.ADW_PI_RPC_ENTRY;
    if (candidate && existsSync(candidate)) return path.resolve(candidate);

    const rel = path.join(
        'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'rpc-entry.js',
    );
    // 服务端固定编译为 CommonJS，__dirname 恒可用
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const p = path.join(dir, rel);
        if (existsSync(p)) return p;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        'pi rpc-entry not found. Set ADW_PI_RPC_ENTRY or install @earendil-works/pi-coding-agent',
    );
}

/**
 * pi RPC 子进程封装
 * @description 一次实例对应一个子进程；进程死亡后实例作废（不自动重启，
 * 由上层按需重建——会话已持久化在 sessionDir，重建无损）。
 */
export class PiRpcProcess {
    private child: ChildProcess;
    private readonly hooks: PiRpcHooks;
    private seq = 0;
    private pending = new Map<string, {resolve: (data: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout}>();
    private dead = false;
    private killRequested = false;

    private constructor(child: ChildProcess, hooks: PiRpcHooks) {
        this.child = child;
        this.hooks = hooks;
        this.wire(child);
    }

    /** 组装命令行参数 */
    private static buildArgs(opts: PiRpcSpawnOptions, rpcEntry: string): string[] {
        const args = [rpcEntry, '--session-dir', opts.sessionDir];
        if (opts.sessionFile) args.push('--session', opts.sessionFile);
        if (opts.provider) args.push('--provider', opts.provider);
        if (opts.model) args.push('--model', opts.model);
        if (opts.thinkingLevel) args.push('--thinking', opts.thinkingLevel);
        if (opts.tools && opts.tools.length > 0) args.push('--tools', opts.tools.join(','));
        if (opts.extensionPath) {
            // 只显式加载 adw 扩展，关闭用户侧扩展发现（避免工作区 .pi 干扰平台管线）
            args.push('--no-extensions', '-e', opts.extensionPath);
        } else {
            args.push('--no-extensions');
        }
        return args;
    }

    /**
     * 启动并等待就绪（get_state 应答）
     * @param readyTimeoutMs 就绪握手超时（默认 {@link READY_TIMEOUT_MS}，测试可缩短）
     * @throws spawn 失败 / 就绪超时（超时后会杀掉子进程再抛出）
     */
    static async start(
        opts: PiRpcSpawnOptions,
        hooks: PiRpcHooks = {},
        spawnFn: PiSpawnFn = (command, args, o) => spawn(command, args, {
            ...o,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        }) as ChildProcess,
        readyTimeoutMs: number = READY_TIMEOUT_MS,
    ): Promise<PiRpcProcess> {
        const rpcEntry = resolveRpcEntry(opts.rpcEntry);
        const args = PiRpcProcess.buildArgs(opts, rpcEntry);
        // process.env 值类型含 undefined，过滤后合并（否则 TS2322）
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) env[key] = value;
        }
        Object.assign(env, opts.env ?? {});
        // 桌面版：process.execPath 是 Electron 二进制，必须保持纯 Node 模式启动；
        // 服务端引导（server-bootstrap）会删除该变量防泄漏，这里必须显式补回，
        // 否则子进程会拉起新 GUI 实例并被主窗口单实例锁立即退出（exit 0）
        if (process.env.ADW_DESKTOP === '1') {
            env.ELECTRON_RUN_AS_NODE = '1';
        }
        const child = spawnFn(process.execPath, args, {cwd: opts.cwd, env});
        const proc = new PiRpcProcess(child, hooks);

        try {
            // 就绪握手：拿到 get_state 应答即认为协议可用
            await proc.send({type: 'get_state'}, readyTimeoutMs);
            return proc;
        } catch (err) {
            await proc.kill().catch(() => undefined);
            throw err;
        }
    }

    /** 进程是否存活 */
    get alive(): boolean {
        return !this.dead && this.child.exitCode === null && this.child.killed === false;
    }

    get pid(): number | undefined {
        return this.child.pid;
    }

    /** 接线：stdout 逐行解析 / stderr 转发 / 退出清理 */
    private wire(child: ChildProcess): void {
        if (child.stdout) {
            createInterface({input: child.stdout}).on('line', (line) => this.handleLine(line));
        }
        if (child.stderr) {
            createInterface({input: child.stderr}).on('line', (line) => {
                const text = line.trim();
                if (text) this.hooks.onStderr?.(text);
            });
        }
        child.on('error', (err) => {
            this.failAll(new Error(`pi rpc process error: ${err.message}`));
        });
        child.on('exit', (code) => {
            this.dead = true;
            this.failAll(new Error(`pi rpc process exited (code ${code ?? 'null'})`));
            this.hooks.onExit?.(code);
        });
    }

    /** 解析一行 stdout：response 走应答关联，其余走事件回调 */
    private handleLine(raw: string): void {
        const line = raw.trim();
        if (!line) return;
        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(line) as Record<string, unknown>;
        } catch {
            // 非 JSON 行（不应出现）：当诊断信息转发
            this.hooks.onStderr?.(`[pi-stdout] ${line}`);
            return;
        }
        if (parsed.type === 'response') {
            this.resolveResponse(parsed);
            return;
        }
        this.hooks.onEvent?.(parsed);
    }

    /** 按 id（或命令名兜底）应答 pending 命令 */
    private resolveResponse(parsed: Record<string, unknown>): void {
        const id = typeof parsed.id === 'string' ? parsed.id : undefined;
        let entry = id ? this.pending.get(id) : undefined;
        if (!entry) {
            // 无 id 的错误应答：按命令名找唯一 pending
            const command = typeof parsed.command === 'string' ? parsed.command : undefined;
            if (command) {
                const matches = Array.from(this.pending.entries())
                    .filter(([, p]) => (p as unknown as {command?: string}).command === command);
                if (matches.length === 1) entry = matches[0][1];
            }
        }
        if (!entry) return;
        if (id) this.pending.delete(id);
        clearTimeout(entry.timer);
        if (parsed.success === true) {
            entry.resolve(parsed.data);
        } else {
            entry.reject(new Error(typeof parsed.error === 'string' ? parsed.error : 'pi rpc command failed'));
        }
    }

    /** 拒绝全部 pending（进程退出/错误） */
    private failAll(err: Error): void {
        for (const [id, p] of this.pending) {
            clearTimeout(p.timer);
            this.pending.delete(id);
            p.reject(err);
        }
    }

    /**
     * 发送命令并等待应答
     * @returns 应答 data（success:true 时；无 data 返回 undefined）
     * @throws 应答 success:false、超时或进程已死
     */
    async send(command: Record<string, unknown>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<unknown> {
        if (!this.alive) {
            throw new Error('pi rpc process is not alive');
        }
        const id = `adw-${++this.seq}`;
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`pi rpc command "${String(command.type)}" timeout after ${timeoutMs}ms`));
            }, timeoutMs);
            const record = {
                resolve,
                reject,
                timer,
                command: String(command.type),
            } as {resolve: (d: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; command?: string};
            this.pending.set(id, record);
            this.writeLine(JSON.stringify({...command, id}));
        });
    }

    /** 单向写入（extension_ui_response 等无需应答的命令） */
    notify(command: Record<string, unknown>): void {
        if (!this.alive) return;
        this.writeLine(JSON.stringify(command));
    }

    private writeLine(line: string): void {
        const stdin = this.child.stdin;
        if (!stdin || stdin.destroyed) return;
        stdin.write(`${line}\n`);
    }

    /**
     * 关停子进程：stdin 关闭触发官方优雅退出（内部会清理 bash 进程树），
     * 超时未退则 taskkill /T /F（Windows）或 SIGKILL。
     */
    async kill(): Promise<void> {
        if (this.killRequested) return;
        this.killRequested = true;
        if (this.dead) return;

        const exited = new Promise<void>((resolve) => {
            this.child.once('exit', () => resolve());
            setTimeout(resolve, GRACEFUL_EXIT_MS).unref?.();
        });
        try {
            this.child.stdin?.end();
        } catch {
            // stdin 已损坏：直接走强杀
        }
        await exited;

        if (!this.dead && this.child.pid) {
            try {
                if (process.platform === 'win32') {
                    const {execFile} = await import('child_process');
                    execFile('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], () => undefined);
                } else {
                    this.child.kill('SIGKILL');
                }
            } catch {
                // 尽力而为
            }
        }
    }
}

/**
 * 按 sessionId 查找 pi 会话文件
 * @description pi 会话文件名为 `<timestamp>_<sessionId>.jsonl`（sessionId 为会话头
 * 中的 UUID，与文件名不同）。兼容 adw 旧约定的 `<sessionId>.jsonl` 精确名。
 * sessionId 做字符白名单校验防路径穿越。
 */
export function findSessionFile(sessionId: string, sessionDir: string): string | undefined {
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return undefined;
    const exact = path.join(sessionDir, `${sessionId}.jsonl`);
    if (existsSync(exact)) return exact;
    try {
        const suffix = `_${sessionId}.jsonl`;
        const match = readdirSync(sessionDir).find((f) => f.endsWith(suffix));
        return match ? path.join(sessionDir, match) : undefined;
    } catch {
        return undefined;
    }
}
