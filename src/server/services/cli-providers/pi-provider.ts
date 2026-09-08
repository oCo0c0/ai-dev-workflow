/**
 * @module pi-provider
 * @description Pi Coding Agent Provider —— RPC 子进程 harness 形态
 *
 * 架构（对标 DeepSeek Harness / OpenCode 的「CLI 作为底层」接入方式）：
 * adw 不再进程内 import pi SDK 跑 agent 循环，而是每次 run spawn 一个
 * `pi --mode rpc` 子进程（rpc-entry），stdin/stdout JSONL 协议交互：
 *
 * - 进程模型：process-per-run——每次 run 起新进程、跑完即退。
 *   会话持久化在 ~/.ai-dev-workbench/pi-sessions/<cwd>/（pi 原生 JSONL，
 *   一会话一文件），续接时以 --session <file> 恢复完整历史。
 *   并发任务天然隔离；pi 的任何缺陷（工具挂死/循环异常）只影响该子进程。
 * - 事件归一化：RPC 事件流（JsonAgentSessionEvent，与 SDK 事件同源）→
 *   onOutput(data, {type: thinking|tool_use|tool_result})，编排层零改动。
 * - 权限确认：不再覆盖 pi 内部 beforeToolCall 钩子；由 adw 平台扩展
 *   （resources/pi-extensions/adw-platform.ts，经 -e 显式加载）走官方
 *   tool_call + ui.confirm 协议，RPC 模式映射为 extension_ui_request(confirm)
 *   ↔ extension_ui_response，本 Provider 负责与前端弹窗协议互转。
 * - MCP：平台网关 REST 面（/api/platform）+ 扩展 registerTool 投影，
 *   清单单一事实来源不变（MCPRegistryService）。
 * - 模型：--provider/--model 启动参数 + 各家 API key 经环境变量注入
 *   （「模型供应商页」pi:* 记录 → pi 认可的 *_API_KEY 环境变量）。
 *
 * Claude / Codex Provider 保持 SDK 形态不受影响。
 */

import path from 'path';
import os from 'os';
import {createHash} from 'crypto';
import {existsSync} from 'fs';
import {getErrorMessage} from '../../utils/error-utils.js';
import {ModelProviderStore} from '../model-provider-store.js';
import {getMcpGateway} from '../../platform/mcp-gateway.js';
import {
    PiRpcProcess,
    DEFAULT_PI_TOOLS,
    findSessionFile,
    resolveRpcEntry,
} from './pi-rpc-process.js';
import type {
    CLIProvider,
    CLIProviderCapabilities,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    CLIProviderStatus,
    McpServerInfo,
    ProviderModelSettings,
    SkillInfo,
} from './types.js';

/** pi 会话存储根目录（adw 自有目录，不污染 ~/.pi/agent） */
export const PI_SESSIONS_ROOT = path.join(os.homedir(), '.ai-dev-workbench', 'pi-sessions');

/**
 * 计算 cwd 对应的 pi 会话目录
 * @description 目录名 = 净化后的 cwd + 短哈希，保证不同 cwd 不冲突
 */
export function piSessionDir(cwd: string): string {
    const encoded = cwd.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-60);
    const hash = createHash('md5').update(cwd).digest('hex').slice(0, 8);
    return path.join(PI_SESSIONS_ROOT, `${encoded}-${hash}`);
}

/** detect() 探测进程的会话目录（一次性，不产生会话文件） */
const DETECT_SESSION_DIR = path.join(PI_SESSIONS_ROOT, '_detect');

/** adw 平台扩展文件（相对仓库根；rpc-entry 同款向上查找策略） */
const EXTENSION_REL_PATH = path.join('resources', 'pi-extensions', 'adw-platform.ts');

/**
 * 「模型供应商页」provider id → pi 认可的 API key 环境变量名
 * @description 仅映射帮助文档明示的变量；未列出的提供商走 pi 自身
 * 的 ~/.pi/agent/auth.json / OAuth。
 */
const PI_PROVIDER_ENV_KEYS: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    google: 'GEMINI_API_KEY',
    groq: 'GROQ_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    xai: 'XAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    fireworks: 'FIREWORKS_API_KEY',
    together: 'TOGETHER_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    baseten: 'BASETEN_API_KEY',
    zai: 'ZAI_API_KEY',
    'zai-cn': 'ZAI_CODING_CN_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    kimi: 'KIMI_API_KEY',
    qwen: 'QWEN_TOKEN_PLAN_API_KEY',
    'qwen-cn': 'QWEN_TOKEN_PLAN_CN_API_KEY',
    xiaomi: 'XIAOMI_API_KEY',
    azure: 'AZURE_OPENAI_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    cloudflare: 'CLOUDFLARE_API_KEY',
};

/** 单工具执行看门狗：超限强制中止本次运行 */
const TOOL_WATCHDOG_MS = 10 * 60 * 1000;
/** 整轮运行看门狗（兜底：事件流彻底沉寂的病态场景） */
const RUN_WATCHDOG_MS = 30 * 60 * 1000;
/** abort 后等待 agent_end 的宽限期，超时直接收尾 */
const ABORT_GRACE_MS = 8_000;

/** 从工具 partialResult / result 中提取可展示文本（形状随工具而异，启发式提取） */
function extractToolText(source: unknown): string {
    if (source == null) return '';
    if (typeof source === 'string') return source;
    if (Array.isArray(source)) {
        return source.map((c) => extractToolText(c)).join('');
    }
    if (typeof source === 'object') {
        const obj = source as Record<string, unknown>;
        for (const key of ['text', 'stdout', 'output', 'content']) {
            const v = obj[key];
            if (typeof v === 'string') return v;
        }
        return '';
    }
    return String(source);
}

/** 挂起的权限确认（permissionRequestId → 应答通道） */
interface PendingPermission {
    proc: PiRpcProcess;
    /** pi extension_ui_request 的 id（extension_ui_response 回写用） */
    uiId: string;
}

/**
 * Pi Coding Agent Provider（RPC harness）
 */
export class PiProvider implements CLIProvider {
    readonly id = 'pi' as const;
    readonly label = 'Pi Coding Agent';

    readonly capabilities: CLIProviderCapabilities = {
        // 扩展 tool_call + ui.confirm 协议（RPC 模式 extension_ui_request）
        supportsPermission: true,
        // pi 使用 SKILL.md 文件注入技能，不在运行时动态注入
        supportsRuntimeSkills: false,
        // MCP 由平台网关统一管理，扩展 registerTool 投影（input.mcpServers 被忽略）
        supportsRuntimeMcp: true,
        // pi 有自动上下文压缩，轮次由模型自主决定
        supportsMaxTurns: false,
        supportsReasoningEffort: true,
        supportsExtendedThinking: true,
        // pi 有自己的 20+ provider 体系，不支持注入 Anthropic 兼容端点
        supportsCustomEndpoint: false,
    };

    readonly defaultModelSettings: ProviderModelSettings = {
        modelProvider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        streaming: true,
        reasoningEffort: 'medium',
    };

    /** 挂起中的权限确认 */
    private pendingPermissions = new Map<string, PendingPermission>();

    /** 可注入的进程启动函数（测试替换用） */
    private startRpc: typeof PiRpcProcess.start;

    constructor(startRpc: typeof PiRpcProcess.start = PiRpcProcess.start) {
        this.startRpc = startRpc;
    }

    async detect(): Promise<CLIProviderStatus> {
        let entry: string;
        try {
            entry = resolveRpcEntry();
        } catch (err) {
            return {
                available: false,
                error: getErrorMessage(err) || '@earendil-works/pi-coding-agent not installed. Run: pnpm add @earendil-works/pi-coding-agent',
            };
        }

        // 真实版本号：node <cli.js> --version（cli.js 与 rpc-entry 同目录）
        const version = await this.detectVersion(entry).catch(() => undefined);

        // 可用模型目录：一次性 RPC 子进程 get_available_models
        const models = await this.detectAvailableModels();

        const meta: Record<string, unknown> = {};
        if (models) {
            const providers = new Set(models.map((m) => m.provider));
            meta.availableProviders = Array.from(providers);
            meta.availableModels = models.slice(0, 30);
        }

        return {
            available: true,
            version: version ?? 'unknown',
            path: entry,
            meta,
        };
    }

    /** 读 pi CLI 版本（cli.js --version） */
    private async detectVersion(rpcEntry: string): Promise<string | undefined> {
        const cliJs = path.join(path.dirname(rpcEntry), 'cli.js');
        if (!existsSync(cliJs)) return undefined;
        const {execFile} = await import('child_process');
        return new Promise<string | undefined>((resolve) => {
            execFile(process.execPath, [cliJs, '--version'], {timeout: 15_000}, (err, stdout) => {
                if (err) return resolve(undefined);
                resolve(String(stdout).trim().split('\n').pop()?.trim() || undefined);
            });
        });
    }

    /** 一次性 RPC 子进程探测可用模型（失败返回 undefined，不影响可用性） */
    private async detectAvailableModels(): Promise<Array<{provider: string; id: string; name?: string}> | undefined> {
        let proc: PiRpcProcess | null = null;
        try {
            proc = await this.startRpc(
                {cwd: process.cwd(), sessionDir: DETECT_SESSION_DIR},
                {},
                undefined,
                30_000,
            );
            const data = await proc.send({type: 'get_available_models'}, 20_000) as
                | {models?: Array<{provider: string; id: string; name?: string}>}
                | undefined;
            const models = (data?.models ?? []).map((m) => ({provider: m.provider, id: m.id, name: m.name ?? m.id}));

            // 合并自有模型供应商配置（pi:* 记录经环境变量注入凭证，pi 侧自动检测看不到）
            try {
                const store = new ModelProviderStore();
                for (const rec of store.list()) {
                    if (rec.kind !== 'pi' || rec.enabled === false || !rec.apiKey) continue;
                    const providerId = rec.id.startsWith('pi:') ? rec.id.slice(3) : rec.id;
                    if (models.some((m) => m.provider === providerId)) continue;
                    const modelId = rec.defaultModel || rec.models?.[0];
                    if (modelId) models.push({provider: providerId, id: modelId, name: modelId});
                }
            } catch {
                // 自有配置读取失败时静默降级
            }
            return models;
        } catch {
            return undefined;
        } finally {
            await proc?.kill().catch(() => undefined);
        }
    }

    async initialize(): Promise<void> {
        // 校验 rpc 入口与扩展文件可解析（spawn 在 run 时按需进行）
        resolveRpcEntry();
        this.resolveExtensionPath();
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        const cwd = input.cwd || process.cwd();
        const sessionDir = piSessionDir(cwd);

        // 中止信号已触发：直接返回，不起进程
        if (options?.signal?.aborted) {
            return {exitCode: null, stdout: '', stderr: '', aborted: true};
        }

        // === 启动参数组装 ===
        const model = this.resolveSpawnModel(options);
        const env = this.buildSpawnEnv(model.provider, (options as {apiKey?: string} | undefined)?.apiKey);
        // 权限模式与 Claude bridge 语义对齐：调用方未提供 onPermissionRequest
        //（经典 plan/execution 流程）时自动放行；agent-execution 流程走确认弹窗
        env.ADW_PERMISSION_MODE = options?.onPermissionRequest ? 'confirm' : 'auto-allow';
        const extensionPath = this.resolveExtensionPath();
        const sessionFile = input.sessionId ? findSessionFile(input.sessionId, sessionDir) : undefined;
        if (input.sessionId && !sessionFile) {
            options?.onOutput?.(`[pi 会话 "${input.sessionId}" 不存在或已失效，已自动开启新会话]\n`);
        }

        let stdout = '';
        let stderr = '';
        let isAborted = false;
        // 模型调用错误（pi 契约：错误编码为 stopReason='error' 的消息，不抛出）
        let lastErrorMessage = '';

        // 输出缓冲（与旧实现同语义：delta 累积、关键边界批量发出）
        let textBuf = '';
        let thinkingBuf = '';
        let toolBuf = '';

        const flushBuffer = () => {
            if (textBuf) {
                options?.onOutput?.(textBuf);
                textBuf = '';
            }
        };
        const flushThinking = () => {
            if (thinkingBuf) {
                options?.onOutput?.(thinkingBuf, {type: 'thinking'});
                thinkingBuf = '';
            }
        };
        const takeToolOutput = () => {
            const out = toolBuf;
            toolBuf = '';
            return out;
        };

        // 看门狗（工具级 + 整轮级）
        const toolWatchdogs = new Map<string, ReturnType<typeof setTimeout>>();
        let runWatchdog: ReturnType<typeof setTimeout> | null = null;
        const clearAllWatchdogs = () => {
            for (const t of toolWatchdogs.values()) clearTimeout(t);
            toolWatchdogs.clear();
            if (runWatchdog) {
                clearTimeout(runWatchdog);
                runWatchdog = null;
            }
        };

        // 完成信号（agent_end / abort 双路径）
        let resolveCompletion!: () => void;
        const completion = new Promise<void>((resolve) => {
            resolveCompletion = resolve;
        });
        const finish = () => {
            clearAllWatchdogs();
            resolveCompletion();
        };

        // 当前 run 绑定的事件处理（process-per-run：进程事件即本 run 事件）
        const handleEvent = (evt: Record<string, any>) => {
            switch (evt.type) {
                case 'message_update': {
                    const msgEvent = evt.assistantMessageEvent as Record<string, any> | undefined;
                    switch (msgEvent?.type) {
                        case 'text_delta':
                            stdout += msgEvent.delta || '';
                            textBuf += msgEvent.delta || '';
                            break;
                        case 'thinking_delta':
                            thinkingBuf += msgEvent.delta || '';
                            break;
                        case 'toolcall_start':
                            // JSON 协议下 toolcall_start 不携带参数（partial 已剥离）；
                            // 参数在 tool_execution_start 的 args 中提供
                            flushThinking();
                            flushBuffer();
                            break;
                    }
                    break;
                }

                case 'tool_execution_start': {
                    const toolCallId = String(evt.toolCallId ?? '');
                    const timer = setTimeout(() => {
                        options?.onOutput?.(`\n[工具 ${evt.toolName} 执行超过 10 分钟未返回，已强制中止本次运行]\n`);
                        procRef?.send({type: 'abort'}).catch(() => undefined);
                        finish();
                    }, TOOL_WATCHDOG_MS);
                    if (toolCallId) toolWatchdogs.set(toolCallId, timer);
                    flushThinking();
                    flushBuffer();
                    options?.onOutput?.('', {
                        type: 'tool_use',
                        toolName: evt.toolName || 'Tool',
                        toolInput: evt.args ?? {},
                        toolUseId: toolCallId,
                    });
                    break;
                }

                case 'tool_execution_update':
                    toolBuf += extractToolText(evt.partialResult);
                    break;

                case 'tool_execution_end': {
                    const endedId = String(evt.toolCallId ?? '');
                    const timer = endedId ? toolWatchdogs.get(endedId) : undefined;
                    if (timer) {
                        clearTimeout(timer);
                        toolWatchdogs.delete(endedId);
                    }
                    if (!toolBuf && evt.result) {
                        // 无增量输出时回退取最终结果的文本内容
                        toolBuf = extractToolText(evt.result.content);
                    }
                    flushThinking();
                    options?.onOutput?.(takeToolOutput(), {
                        type: 'tool_result',
                        toolName: evt.toolName,
                        toolUseId: endedId,
                        isError: evt.isError === true,
                    });
                    break;
                }

                case 'message_end': {
                    const finished = evt.message as {stopReason?: string; errorMessage?: string} | undefined;
                    if (finished?.stopReason === 'error' && finished.errorMessage) {
                        lastErrorMessage = finished.errorMessage;
                    }
                    flushThinking();
                    flushBuffer();
                    break;
                }

                case 'agent_end':
                    flushThinking();
                    flushBuffer();
                    finish();
                    break;

                // === 扩展 UI 通道（adw 平台扩展） ===
                case 'extension_ui_request': {
                    if (evt.method === 'confirm' && typeof evt.id === 'string') {
                        const permissionRequestId = `pi-${evt.id}`;
                        this.pendingPermissions.set(permissionRequestId, {
                            // procRef 在进程启动后立即可用；confirm 只会发生在 prompt 之后
                            proc: procRef as unknown as PiRpcProcess,
                            uiId: evt.id,
                        });
                        options?.onPermissionRequest?.({
                            permissionRequestId,
                            toolName: String(evt.title ?? 'Tool'),
                            toolInput: {summary: String(evt.message ?? '')},
                            toolUseId: evt.id,
                            title: String(evt.title ?? 'Tool'),
                            displayName: String(evt.title ?? 'Tool'),
                        });
                    } else if (evt.method === 'notify') {
                        options?.onOutput?.(`${String(evt.message ?? '')}\n`);
                    }
                    break;
                }

                case 'extension_error':
                    options?.onOutput?.(`[pi 扩展错误] ${String(evt.error ?? '')}\n`);
                    break;
            }
        };

        let procRef: PiRpcProcess | null = null;
        try {
            procRef = await this.startRpc(
                {
                    cwd,
                    sessionDir,
                    sessionFile,
                    provider: model.provider,
                    model: model.model,
                    thinkingLevel: mapReasoningToThinkingLevel(options?.reasoningEffort),
                    tools: DEFAULT_PI_TOOLS,
                    extensionPath,
                    env,
                },
                {
                    onEvent: handleEvent,
                    onStderr: (text) => {
                        stderr += `${text}\n`;
                    },
                },
            );
            const proc = procRef;

            // 中止信号 → abort 命令 + 宽限期后强制收尾（双保险）
            const signal = options?.signal;
            signal?.addEventListener('abort', () => {
                isAborted = true;
                proc.send({type: 'abort'}).catch(() => undefined);
                setTimeout(finish, ABORT_GRACE_MS).unref?.();
            }, {once: true});

            // 整轮看门狗
            runWatchdog = setTimeout(() => {
                options?.onOutput?.('\n[pi 运行超过 30 分钟无进展，已强制中止]\n');
                proc.send({type: 'abort'}).catch(() => undefined);
                finish();
            }, RUN_WATCHDOG_MS);
            runWatchdog.unref?.();

            // 发送 prompt：应答 success 即预检通过（preflight），完成由 agent_end 驱动
            await proc.send({type: 'prompt', message: input.prompt});
            await completion;

            // 模型侧错误显式透传（不允许 exitCode=0 掩盖）
            if (lastErrorMessage) {
                stderr = `pi 模型调用失败: ${lastErrorMessage}\n${stderr}`;
                options?.onError?.(stderr);
            }

            // 取 sessionId（进程仍存活时；已死则退回输入值）
            let sessionId = input.sessionId;
            try {
                const state = await proc.send({type: 'get_state'}, 5_000) as {sessionId?: string} | undefined;
                sessionId = state?.sessionId ?? sessionId;
            } catch {
                // 进程已退出（如整轮看门狗路径）：保留输入 sessionId
            }

            return {
                exitCode: isAborted ? null : (lastErrorMessage ? 1 : 0),
                stdout,
                stderr: stderr || undefined,
                aborted: isAborted,
                sessionId,
            };
        } catch (err) {
            const message = getErrorMessage(err);
            options?.onError?.(message);
            return {
                exitCode: 1,
                stdout,
                stderr: message,
                aborted: options?.signal?.aborted ?? false,
                sessionId: input.sessionId,
            };
        } finally {
            clearAllWatchdogs();
            // 清理本 run 挂起的权限确认（防泄漏；对应 confirm 已无从应答）
            for (const [key, pending] of this.pendingPermissions) {
                if (pending.proc === procRef) this.pendingPermissions.delete(key);
            }
            await procRef?.kill().catch(() => undefined);
        }
    }

    async loadSkills(): Promise<SkillInfo[]> {
        // pi 使用 SKILL.md 文件系统方式管理 skill（ResourceLoader 自动发现）
        return [];
    }

    async loadMcpServers(): Promise<McpServerInfo[]> {
        // 平台化：pi 引擎的 MCP 视图 = 平台注册中心（网关统一转发）
        try {
            const {MCPRegistryService} = await import('../mcp-registry-service.js');
            const registry = new MCPRegistryService();
            return registry.list()
                .filter((s) => s.enabled !== false)
                .map((s) => ({
                    name: s.name,
                    type: s.type ?? 'custom',
                    command: s.command,
                    args: s.args,
                    env: s.env,
                    enabled: s.enabled !== false,
                    status: 'disconnected' as const,
                }));
        } catch {
            return [];
        }
    }

    async dispose(): Promise<void> {
        // process-per-run：无常驻子进程；拒绝挂起中的权限确认即可
        this.pendingPermissions.clear();
    }

    /**
     * 反向写回工具权限决策：extension_ui_response 回传给子进程
     * @description 与 Claude bridge 的 agent.confirmPermission 同语义
     */
    confirmPermission(
        permissionRequestId: string,
        decision: 'allow' | 'deny',
        _message?: string,
        _modifiedInput?: Record<string, unknown>,
    ): void {
        const pending = this.pendingPermissions.get(permissionRequestId);
        if (!pending) return;
        this.pendingPermissions.delete(permissionRequestId);
        pending.proc.notify({
            type: 'extension_ui_response',
            id: pending.uiId,
            confirmed: decision === 'allow',
        });
    }

    // === 私有方法 ===

    /**
     * 解析启动用模型：调用方显式传入 > 自有配置首个可用
     * @returns provider/model id（均可能为 undefined → pi 自动检测）
     */
    private resolveSpawnModel(options?: CLIProviderOptions): {provider?: string; model?: string} {
        const provider = options?.modelProvider;
        const model = options?.model;
        if (provider) return {provider, model};

        try {
            const store = new ModelProviderStore();
            const rec = store.list().find(
                (r) => r.kind === 'pi' && r.enabled !== false && r.apiKey,
            );
            if (rec) {
                return {
                    provider: rec.id.startsWith('pi:') ? rec.id.slice(3) : rec.id,
                    model: model || rec.defaultModel || rec.models?.[0],
                };
            }
        } catch {
            // 忽略：走 pi 自动检测
        }
        return {model};
    }

    /**
     * 构造子进程环境变量：全部启用的 pi:* 供应商 key（支持运行中换提供商）+
     * 平台网关回连地址（扩展拉取工具目录/回传调用）
     */
    private buildSpawnEnv(provider: string | undefined, explicitApiKey?: string): Record<string, string> {
        const env: Record<string, string> = {};

        try {
            const store = new ModelProviderStore();
            for (const rec of store.list()) {
                if (rec.kind !== 'pi' || rec.enabled === false || !rec.apiKey) continue;
                const providerId = rec.id.startsWith('pi:') ? rec.id.slice(3) : rec.id;
                const envName = PI_PROVIDER_ENV_KEYS[providerId];
                if (envName) env[envName] = rec.apiKey;
            }
        } catch {
            // 读取失败：依赖 pi 自身凭证（auth.json / 外部环境变量）
        }

        // 调用方显式传入的 key 优先（对应本次选定的 provider）
        if (explicitApiKey && provider) {
            const envName = PI_PROVIDER_ENV_KEYS[provider];
            if (envName) env[envName] = explicitApiKey;
        }

        const endpoint = getMcpGateway().getPlatformEndpoint();
        if (endpoint) {
            env.ADW_PLATFORM_URL = endpoint.url;
            if (endpoint.apiKey) env.ADW_PLATFORM_KEY = endpoint.apiKey;
        }
        return env;
    }

    /** 解析 adw 平台扩展文件路径（不存在返回 undefined，降级为无扩展运行） */
    private resolveExtensionPath(): string | undefined {
        let dir = __dirname;
        for (let i = 0; i < 8; i++) {
            const p = path.join(dir, EXTENSION_REL_PATH);
            if (existsSync(p)) return p;
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
        return undefined;
    }
}

/**
 * 将项目的 reasoningEffort 映射为 pi 的 thinkingLevel
 */
function mapReasoningToThinkingLevel(
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    switch (effort) {
        case 'low':
            return 'low';
        case 'medium':
            return 'medium';
        case 'high':
            return 'high';
        case 'xhigh':
        case 'max':
            return 'xhigh';
        default:
            return undefined; // 未指定：pi 按 settings/会话默认
    }
}
