/**
 * @module dsh-provider
 * @description DeepSeek Harness (dsh) CLI Provider 实现
 *
 * 通过 spawn runtime-dsh/bin.mjs（自包含 dsh SDK 运行时）以 stdio JSON-RPC
 * 驱动一个无人值守 agent。事件经 DshEventProjector 投影为 adw 的
 * onOutput(data, meta) 契约（与 claude-provider 同形），前端零改动。
 *
 * 实例模型：
 * - SDK 的 initialize 握手钉死 (cwd, provider, model, maxTokens)；adw 的调用
 *   逐次携带这些参数，因此按组合键池化运行时实例（Map<key, instance>）。
 * - 每个 run() 独占实例（PoC 保守策略）：结束即回收（close 阶梯），最接近
 *   现有 bridge 的进程模型。同键并发 run 排队（简单互斥队列）。
 * - cordis.yml 按 (cwd, skills, mcpServers) 生成并落盘；文件名含内容 hash，
 *   内容不变时复用，配置变化自然开新文件。
 *
 * 已知限制（对齐评估结论）：
 * - SDK 协议无轮次中取消：中止 = close() 杀实例（会话已持久化，可用同一
 *   sessionId 重开续跑）。
 * - 无逐轮次上限：maxTurns 以 turn/end 计数软护栏实现（超限收割并标注截断）。
 * - 审批流未开通：supportsPermission=false，护栏由 cordis.yml 预配策略承担。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {getErrorMessage} from '../../utils/error-utils.js';
import {DshJsonRpcClient, DshTransportClosedError, stableHash} from './dsh-protocol.js';
import {DshEventProjector} from './dsh-projector.js';
import {buildCordisYml, DEFAULT_PERSONA} from './dsh-cordis.js';
import {ModelProviderStore} from '../model-provider-store.js';
import type {McpStdioMap} from './types.js';
import type {
    CLIProvider,
    CLIProviderCapabilities,
    CLIProviderStatus,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    SkillInfo,
    McpServerInfo,
} from './types.js';

/** dsh 运行时子项目根（相对本文件定位，编译后 dist 结构保持一致） */
function runtimeRoot(): string {
    // src: <root>/src/server/services/cli-providers/dsh-provider.ts
    // dist: <root>/dist/server/services/cli-providers/dsh-provider.js
    // 两种形态都向上走 5 级到仓库根
    return path.resolve(__dirname, '..', '..', '..', '..', 'runtime-dsh');
}

/** 运行时启动器路径（测试经 ADW_DSH_RUNTIME_BIN 注入 mock） */
function runtimeBin(): string {
    return process.env.ADW_DSH_RUNTIME_BIN || path.join(runtimeRoot(), 'bin.mjs');
}

/** 生成的 cordis.yml / 会话日志根目录（测试经 ADW_DSH_HOME 重定向） */
function generatedRoot(): string {
    if (process.env.ADW_DSH_HOME) return path.resolve(process.env.ADW_DSH_HOME);
    return path.join(os.homedir(), '.ai-dev-workbench', 'dsh');
}

/** 引擎要求（dsh 运行时 Node >= 22.19） */
const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_NODE_MINOR = 19;

/** 解析 'v22.15.0' -> [22, 15]；失败返回 null */
function parseNodeVersion(v: string): [number, number] | null {
    const match = /^v?(\d+)\.(\d+)\./.exec(v);
    if (!match) return null;
    return [Number(match[1]), Number(match[2])];
}

/** 比较当前 Node 是否满足运行时要求 */
export function nodeMeetsRuntimeRequirement(): boolean {
    const parsed = parseNodeVersion(process.version);
    if (!parsed) return false;
    const [major, minor] = parsed;
    return major > REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor >= REQUIRED_NODE_MINOR);
}

/** 等待 ms */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 单个运行时实例的运行上下文（一个 dsh 子进程的全部状态） */
interface RunContext {
    client: DshJsonRpcClient;
    projector: DshEventProjector;
    /** 根会话是否出现过 running（区分“未启动”与“已完成”） */
    sawRunning: boolean;
    /** idle 信号（onNotification 置位，awaitIdle 轮询消费后复位） */
    idleSignaled: boolean;
    /** 运行时报告的版本 */
    runtimeVersion?: string;
}

/** 池中实例记录 */
interface PooledInstance {
    ctx: RunContext;
    /** 互斥：同一实例一次只服务一个 run */
    busy: boolean;
    /** 排队等待者（释放锁时按序唤醒一个） */
    queue: Array<() => void>;
}

export class DshProvider implements CLIProvider {
    readonly id = 'dsh' as const;
    readonly label = 'DeepSeek Harness';
    readonly capabilities: CLIProviderCapabilities = {
        supportsPermission: false,      // SDK 审批流为预留能力；护栏走 cordis.yml 预配策略
        supportsRuntimeSkills: false,   // 技能为组装期配置：经 dsh-cordis 生成式注入（池键含技能目录）
        supportsRuntimeMcp: false,      // MCP 同为组装期配置：生成式注入，下个新实例生效
        supportsMaxTurns: false,        // SDK 无逐轮次参数：provider 以 turn/end 计数软护栏模拟
        supportsReasoningEffort: false, // 推理强度为 llm-deepseek 适配器级默认（max effort）
        supportsExtendedThinking: false,
    };

    /** 实例池：key = cwd|skillsKey|mcpKey */
    private readonly pool = new Map<string, PooledInstance>();

    // -------------------------------------------------------------------------
    // CLIProvider 接口
    // -------------------------------------------------------------------------

    async detect(): Promise<CLIProviderStatus> {
        const problems: string[] = [];

        // 1) Node 版本（adw 服务进程与运行时子进程同源）
        if (!nodeMeetsRuntimeRequirement()) {
            problems.push(
                `当前 Node ${process.version} 低于 dsh 运行时要求 v${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}+`,
            );
        }

        // 2) 运行时子项目就绪（bin + 依赖树）
        const root = runtimeRoot();
        const binPath = path.join(root, 'bin.mjs');
        if (!fs.existsSync(binPath)) {
            problems.push(`运行时启动器不存在：${binPath}`);
        }
        if (!fs.existsSync(path.join(root, 'node_modules'))) {
            problems.push('运行时依赖未安装：请在仓库根执行 pnpm install');
        }

        // 3) 凭据提示（不阻塞 available；运行时错误会更明确）
        if (process.env.DEEPSEEK_API_KEY === undefined && !this.readApiKey()) {
            problems.push('未配置 DeepSeek API Key：请在「模型供应商」页面添加 DeepSeek Harness 记录，或设置 DEEPSEEK_API_KEY 环境变量');
        }

        const ready = fs.existsSync(binPath) && fs.existsSync(path.join(root, 'node_modules'));

        return {
            available: ready,
            version: ready ? `dsh-runtime@workspace (node ${process.version})` : undefined,
            path: root,
            error: problems.length > 0 ? problems.join('；') : undefined,
            meta: {
                sessionRoot: path.join(generatedRoot(), 'sessions'),
                runtimeRequired: `v${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}+`,
            },
        };
    }

    async initialize(): Promise<void> {
        // 惰性：实例在首次 run() 时按需拉起；这里只确保目录结构存在
        fs.mkdirSync(path.join(generatedRoot(), 'configs'), {recursive: true});
        fs.mkdirSync(path.join(generatedRoot(), 'sessions'), {recursive: true});
    }

    /**
     * 从模型供应商配置（models.json）读取 kind='dsh' 记录的明文 API Key。
     * 对齐 pi-provider：页面配置的 key 优先，环境变量 DEEPSEEK_API_KEY 兜底。
     */
    private readApiKey(): string | undefined {
        try {
            const rec = new ModelProviderStore().list().find(
                (r) => r.kind === 'dsh' && r.enabled !== false && r.apiKey,
            );
            return rec?.apiKey;
        } catch {
            return undefined;
        }
    }

    /** 运行时子进程环境：继承父进程 + 注入页面配置的 DeepSeek API Key（环境变量兜底） */
    private runtimeEnv(): Record<string, string> {
        const env = {...process.env} as Record<string, string>;
        const key = this.readApiKey() ?? process.env.DEEPSEEK_API_KEY;
        if (key) env.DEEPSEEK_API_KEY = key;
        return env;
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        const cwd = input.cwd || options?.workspacePath || process.cwd();
        const model = options?.model || 'deepseek-chat';

        // --- 生成 cordis.yml（含技能/MCP 注入），得到配置路径与池键 ---
        const {configPath, poolKey} = this.prepareRuntime(cwd, input.skills, input.mcpServers);

        // --- 获取实例（同键互斥排队；池中实例死亡时自动重建） ---
        for (;;) {
            const instance = await this.acquire(poolKey, cwd, model, configPath, options);
            if (!instance.ctx.client.isClosed) {
                try {
                    return await this.runOnInstance(instance, input, options);
                } finally {
                    this.release(poolKey, instance);
                }
            }
            // 拿到的是死实例（前一次 run 崩溃遗留）：出池重试
            this.dropInstance(poolKey, instance);
        }
    }

    /**
     * 技能清单：dsh 运行时经 skills-filesystem 直接扫描 adw 技能目录快照；
     * 前端的技能管理走 /api/skills 自有 CRUD（与 provider 无关），返回空列表。
     */
    async loadSkills(): Promise<SkillInfo[]> {
        return [];
    }

    /** dsh 的 MCP 由 adw 的 MCPConfigService 统一管理并生成式注入，不单独读取 */
    async loadMcpServers(): Promise<McpServerInfo[]> {
        return [];
    }

    /** 释放全部实例 */
    async dispose(): Promise<void> {
        const closing: Array<Promise<void>> = [];
        for (const [key, instance] of Array.from(this.pool.entries())) {
            closing.push(instance.ctx.client.close());
            this.pool.delete(key);
        }
        await Promise.allSettled(closing);
    }

    /** 能力声明为不支持权限交互：空实现（与接口注释一致） */
    confirmPermission(): void {
        /* not supported */
    }

    // -------------------------------------------------------------------------
    // 内部：运行时准备
    // -------------------------------------------------------------------------

    /**
     * 生成（或复用）cordis.yml，返回配置路径与池键。
     */
    private prepareRuntime(
        cwd: string,
        skills: string[] | 'all' | undefined,
        mcpServers: McpStdioMap | undefined,
    ): {configPath: string; poolKey: string} {
        const root = generatedRoot();

        // 技能目录快照：显式列出的技能 -> 复制为 dsh 可扫描目录（含 SKILL.md 的子目录）
        let skillsDir: string | undefined;
        let skillsKey = 'none';
        if (Array.isArray(skills) && skills.length > 0) {
            skillsDir = this.materializeSkillSnapshot(skills);
            skillsKey = stableHash([...skills].sort());
        }

        // MCP：仅取 stdio 条目（dsh-mcp-client stdio 传输）
        const mcpEntries: Record<string, {command: string; args: string[]; env?: Record<string, string>}> = {};
        for (const [name, server] of Object.entries(mcpServers ?? {})) {
            mcpEntries[name] = {command: server.command, args: server.args, env: server.env};
        }
        const mcpKey = Object.keys(mcpEntries).sort().join(',') || 'none';

        const persona = process.env.ADW_DSH_PERSONA || DEFAULT_PERSONA;
        const yml = buildCordisYml({
            cwd,
            sessionRoot: path.join(root, 'sessions'),
            dshHome: root,
            persona,
            skillsDir,
            mcpServers: Object.keys(mcpEntries).length > 0 ? mcpEntries : undefined,
        });

        // 内容 hash 命名：配置不变则路径不变，运行时/排查可对号入座
        const hash = stableHash({cwd, skillsKey, mcpKey, persona});
        const configPath = path.join(root, 'configs', `agent-${hash}.cordis.yml`);
        if (!fs.existsSync(configPath) || fs.readFileSync(configPath, 'utf-8') !== yml) {
            fs.writeFileSync(configPath, yml, 'utf-8');
        }

        return {configPath, poolKey: `${cwd}|${skillsKey}|${mcpKey}`};
    }

    /** 把选中的 adw 内置技能复制为 dsh 可扫描的目录快照（<name>/SKILL.md 结构） */
    private materializeSkillSnapshot(skills: string[]): string {
        const snapshotRoot = path.join(generatedRoot(), 'skills-snapshot');
        fs.mkdirSync(snapshotRoot, {recursive: true});
        // adw 内置技能位于 <root>/skills/<name>/SKILL.md（与 Claude Code 同构）
        const sourceRoot = path.resolve(__dirname, '..', '..', '..', '..', 'skills');
        for (const name of skills) {
            const src = path.join(sourceRoot, name);
            if (!fs.existsSync(src)) continue;
            fs.cpSync(src, path.join(snapshotRoot, name), {recursive: true, force: true});
        }
        return snapshotRoot;
    }

    // -------------------------------------------------------------------------
    // 内部：实例池
    // -------------------------------------------------------------------------

    /** 获取（或创建）池中实例并加锁；排队者被唤醒后重验实例存活性 */
    private async acquire(
        poolKey: string,
        cwd: string,
        model: string,
        configPath: string,
        options?: CLIProviderOptions,
    ): Promise<PooledInstance> {
        for (;;) {
            let instance = this.pool.get(poolKey);
            if (!instance) {
                const ctx = await this.launch(cwd, model, configPath, options);
                instance = {ctx, busy: false, queue: []};
                this.pool.set(poolKey, instance);
            }
            if (!instance.busy) {
                instance.busy = true;
                // 等待期间实例可能已被替换（死亡回收）：再验一次
                if (instance.ctx.client.isClosed) {
                    this.dropInstance(poolKey, instance);
                    continue;
                }
                return instance;
            }
            // 忙：排队等待唤醒，醒来后重走循环（实例可能已换）
            await new Promise<void>((resolve) => instance!.queue.push(resolve));
        }
    }

    /** 释放实例锁；死亡实例回收出池并唤醒全部等待者 */
    private release(poolKey: string, instance: PooledInstance): void {
        if (instance.ctx.client.isClosed) {
            this.dropInstance(poolKey, instance);
            return;
        }
        instance.busy = false;
        const next = instance.queue.shift();
        if (next) next();
    }

    /** 出池并唤醒全部排队者 */
    private dropInstance(poolKey: string, instance: PooledInstance): void {
        if (this.pool.get(poolKey) === instance) {
            this.pool.delete(poolKey);
        }
        const waiters = instance.queue.splice(0);
        waiters.forEach((w) => w());
    }

    /** 拉起运行时子进程并完成 initialize 握手 */
    private async launch(
        cwd: string,
        model: string,
        configPath: string,
        options?: CLIProviderOptions,
    ): Promise<RunContext> {
        if (!nodeMeetsRuntimeRequirement()) {
            throw new Error(
                `dsh 运行时要求 Node v${REQUIRED_NODE_MAJOR}.${REQUIRED_NODE_MINOR}+，当前 ${process.version}`,
            );
        }
        const binPath = runtimeBin();
        if (!fs.existsSync(binPath)) {
            throw new Error(`dsh 运行时启动器缺失（${binPath}）；请先在仓库根执行 pnpm install`);
        }

        // 上下文先声明后填充：onNotification 闭包需要引用 projector / 状态标志
        const ctx = {} as RunContext;

        const client = new DshJsonRpcClient({
            command: process.execPath,
            args: [binPath, configPath],
            cwd: path.dirname(binPath),
            env: this.runtimeEnv(),
            onNotification: (n) => {
                if (n.method === 'session.status') {
                    if (n.params.status === 'running') {
                        ctx.sawRunning = true;
                    } else {
                        ctx.idleSignaled = true;
                    }
                    // 其余会话过滤交给投影器（子 agent 事件也有展示价值）
                }
                ctx.projector?.handle(n);
            },
        });

        const projector = new DshEventProjector({onOutput: options?.onOutput ?? (() => {})});
        ctx.client = client;
        ctx.projector = projector;
        ctx.sawRunning = false;
        ctx.idleSignaled = false;

        // initialize 握手（进程级一次；失败抛出 -> 上层把失败带给调用方）
        const init = await client.initialize({
            cwd,
            provider: 'deepseek-official',
            model,
            maxTokens: 16_384,
        });
        ctx.runtimeVersion = init.serverInfo.version;

        return ctx;
    }

    // -------------------------------------------------------------------------
    // 内部：单次运行
    // -------------------------------------------------------------------------

    private async runOnInstance(
        instance: PooledInstance,
        input: CLIProviderInput,
        options?: CLIProviderOptions,
    ): Promise<CLIProviderResult> {
        const {client, projector} = instance.ctx;

        // 会话 id：续接用传入值，新建用 adw 侧生成的 UUID
        // （SDK 约定：未知 sessionId 惰性创建 agent+session 对）
        const sessionId = input.sessionId || crypto.randomUUID();
        projector.setRootSessionId(sessionId);
        // 每轮 run 复位活动区间标志与错误（实例可能被续用）
        instance.ctx.sawRunning = false;
        instance.ctx.idleSignaled = false;
        projector.clearError();

        const maxTurns = input.maxTurns ?? 50;

        try {
            // 入队提示词（立即返回回执；agent 活动由通知流驱动）
            await client.prompt({
                sessionId,
                contentBlocks: [{type: 'text', text: input.prompt}],
            });

            // 活动区间：等待 agent 从 running 回到 idle（含中止与软护栏）
            await this.awaitIdle(instance, options, maxTurns);

            const finalResponse = projector.getFinalResponse();
            // LLM 调用失败（缺 key/限流/网络）表现为 turn/end 的 error，而非进程崩溃；
            // 无正文且携带错误时按失败返回，避免前端看到“成功但空白”。
            const turnError = projector.getLastError();
            if (turnError && !finalResponse) {
                return {
                    exitCode: 1,
                    stdout: '',
                    stderr: turnError,
                    sessionId,
                    aborted: false,
                };
            }

            return {
                exitCode: 0,
                stdout: finalResponse,
                stderr: '',
                sessionId,
                aborted: false,
            };
        } catch (err) {
            // 中止：杀实例（协议无轮次中取消；会话已持久化，同 sessionId 可续跑）
            if (options?.signal?.aborted) {
                await client.close().catch(() => undefined);
                return {
                    exitCode: null,
                    stdout: projector.getFinalResponse(),
                    stderr: '',
                    aborted: true,
                    sessionId,
                };
            }
            // 传输断开等致命错误：回收实例并返回失败结果
            await client.close().catch(() => undefined);
            return {
                exitCode: 1,
                stdout: projector.getFinalResponse(),
                stderr: getErrorMessage(err),
                aborted: false,
                sessionId,
            };
        }
    }

    /**
     * 等待 agent 完成活动区间（回到 idle）。
     * - 250ms 轮询消费 idleSignaled（onNotification 置位）
     * - 每轮检查中止信号
     * - maxTurns 软护栏：根会话 turn/end 计数超限即收割
     * - 空转超时：agent 始终未进入 running（如运行时异常）时由总超时兜底
     */
    private async awaitIdle(
        instance: PooledInstance,
        options: CLIProviderOptions | undefined,
        maxTurns: number,
    ): Promise<void> {
        const {client, projector} = instance.ctx;
        const startedAt = Date.now();
        /** 未观察到任何活动的总超时（正常 prompt 后 agent 应立即转 running） */
        const NO_ACTIVITY_TIMEOUT_MS = 120_000;
        /** 活动中的单轮最长等待（防御；正常由 idle 信号退出） */
        const HARD_TIMEOUT_MS = 30 * 60_000;

        for (;;) {
            if (options?.signal?.aborted) {
                throw new DshTransportClosedError('aborted by signal');
            }

            // maxTurns 软护栏
            if (projector.getTurnCount() > maxTurns) {
                await client.close().catch(() => undefined);
                throw new Error(`dsh 运行超出最大轮次限制（${maxTurns}），已中止`);
            }

            // idle 信号（一次性消费）
            if (instance.ctx.idleSignaled) {
                instance.ctx.idleSignaled = false;
                if (instance.ctx.sawRunning) return;
                // sawRunning=false 的 idle：可能是其他会话的状态翻转，继续等
            }

            const elapsed = Date.now() - startedAt;
            if (!instance.ctx.sawRunning && elapsed > NO_ACTIVITY_TIMEOUT_MS) {
                throw new DshTransportClosedError(
                    `dsh agent 在 ${NO_ACTIVITY_TIMEOUT_MS / 1000}s 内未开始活动（运行时可能未正常启动）`,
                );
            }
            if (elapsed > HARD_TIMEOUT_MS) {
                await client.close().catch(() => undefined);
                throw new DshTransportClosedError(`dsh 运行超过总时限（${HARD_TIMEOUT_MS / 60000}min），已中止`);
            }

            await sleep(250);
        }
    }
}
