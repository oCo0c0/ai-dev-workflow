/**
 * @module pi-provider
 * @description Pi Coding Agent Provider 实现
 *
 * 通过 @earendil-works/pi-coding-agent SDK 直接与 LLM API 交互，
 * 无需 Claude/Codex CLI 或 SDK。pi 自己管理 agent 循环（工具调用、
 * 上下文压缩、流式输出等），原生支持 20+ LLM 提供商。
 *
 * pi SDK 是 ESM-only 包，通过 dynamic import() 加载。
 */

import { getErrorMessage } from '../../utils/error-utils.js';
import type {
    CLIProvider,
    CLIProviderCapabilities,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    CLIProviderStatus,
    McpServerInfo,
    SkillInfo,
} from './types.js';

// pi SDK 的类型声明（避免 CJS moduleResolution 无法解析 ESM-only 包的 exports）
// 运行时通过 dynamic import() 加载，类型仅用于编译期检查
interface AgentSession {
    id?: string;
    dispose(): void;
    abort(): Promise<void>;
    prompt(text: string, options?: Record<string, unknown>): Promise<void>;
    subscribe(listener: (event: AgentSessionEvent) => void): () => void;
}

interface AgentSessionEvent {
    type: string;
    [key: string]: unknown;
}

/**
 * Pi Coding Agent Provider
 * @description 通过 pi SDK 的 createAgentSession 直接与 LLM API 交互
 */
export class PiProvider implements CLIProvider {
    readonly id = 'pi' as const;
    readonly label = 'Pi Coding Agent';

    readonly capabilities: CLIProviderCapabilities = {
        // pi 没有 Claude Agent SDK 那样的 canUseTool 权限确认机制
        supportsPermission: false,
        // pi 使用 SKILL.md 文件注入技能，不在运行时动态注入
        supportsRuntimeSkills: false,
        // pi 通过 settings.json 管理 MCP，不在运行时动态注入
        supportsRuntimeMcp: false,
        // pi 有自动上下文压缩，不限轮次
        supportsMaxTurns: false,
        // pi 支持 reasoning/thinking 级别
        supportsReasoningEffort: true,
        supportsExtendedThinking: true,
    };

    /** 当前活跃的 pi session */
    private currentSession: AgentSession | null = null;
    /** 会话 ID 映射 */
    private sessionMapping = new Map<string, AgentSession>();

    async detect(): Promise<CLIProviderStatus> {
        try {
            const pi = await this.importPiSdk();

            // 读取本地 pi 配置：有哪些 LLM 提供商配置了 API key
            const authStorage = pi.AuthStorage.create();
            const modelRegistry = pi.ModelRegistry.create(authStorage);

            const meta: Record<string, unknown> = {};

            try {
                // 获取所有已配置 API key 的提供商
                const available = await modelRegistry.getAvailable();
                const providers = new Set<string>();
                const models: Array<{ provider: string; id: string; name: string }> = [];
                for (const m of available) {
                    providers.add(m.provider);
                    models.push({
                        provider: m.provider,
                        id: m.id,
                        name: (m as any).name || m.id,
                    });
                }
                meta.availableProviders = Array.from(providers);
                meta.availableModels = models.slice(0, 20); // 限制数量
            } catch {
                // 读取失败不影响可用性判断
            }

            return {
                available: true,
                version: 'pi-sdk',
                path: '@earendil-works/pi-coding-agent',
                meta,
            };
        } catch (err) {
            return {
                available: false,
                error: getErrorMessage(err) || '@earendil-works/pi-coding-agent not installed. Run: pnpm add @earendil-works/pi-coding-agent',
            };
        }
    }

    async initialize(): Promise<void> {
        // pi SDK 不需要预启动子进程，按需创建 session
        // 验证动态导入是否正常工作
        await this.importPiSdk();
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        const pi = await this.importPiSdk();

        try {
            // 获取模型配置
            const modelProvider = (options as any)?.piProvider || 'anthropic';
            const modelId = options?.model || 'claude-sonnet-4-20250514';

            // 创建 AuthStorage（读取 pi 的认证配置）
            const authStorage = pi.AuthStorage.create();

            // 运行时注入 API key（如果通过 options 传入）
            if ((options as any)?.apiKey) {
                authStorage.setRuntimeApiKey(modelProvider, (options as any).apiKey);
            }

            // 创建 ModelRegistry
            const modelRegistry = pi.ModelRegistry.create(authStorage);

            // 查找模型（modelRegistry.find 已覆盖内置 + custom models.json）
            const model = modelRegistry.find(modelProvider, modelId);

            // 创建 in-memory session
            const sessionManager = pi.SessionManager.inMemory(input.cwd);

            const { session } = await pi.createAgentSession({
                model,
                modelRegistry,
                authStorage,
                sessionManager,
                cwd: input.cwd,
                thinkingLevel: mapReasoningToThinkingLevel(options?.reasoningEffort),
            });

            // 存储 session（用于后续续接）
            this.currentSession = session;
            if (input.sessionId) {
                this.sessionMapping.set(input.sessionId, session);
            }

            let stdout = '';
            let stderr = '';
            let isAborted = false;

            // 累积文本缓冲区：pi 的 text_delta 逐字符/词发出，
            // 不在逐 delta 时调用 onOutput（会炸日志），而是累积后在关键节点批量发送
            let textBuf = '';

            // 仅当有缓冲内容时才 emit 执行日志
            const flushBuffer = () => {
                if (textBuf) {
                    options?.onOutput?.(textBuf);
                    textBuf = '';
                }
            };

            // 用于等待 agent 完成的 Promise
            const completionPromise = new Promise<void>((resolve, reject) => {
                const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
                    // 检查中止信号
                    if (options?.signal?.aborted && !isAborted) {
                        isAborted = true;
                        session.abort().catch(() => {});
                        return;
                    }

                    // 事件数据在 pi 中通过动态 key 传递，统一用 any 访问
                    const evt = event as Record<string, any>;

                    switch (event.type) {
                        case 'message_update': {
                            const msgEvent = evt.assistantMessageEvent as Record<string, any>;
                            switch (msgEvent?.type) {
                                case 'text_delta':
                                    stdout += msgEvent.delta || '';
                                    textBuf += msgEvent.delta || '';
                                    break;
                                case 'thinking_delta':
                                    // thinking 也累积不单独 emit
                                    textBuf += msgEvent.delta || '';
                                    break;
                                case 'toolcall_start':
                                    // tool 开始 → flush 前面的文本
                                    flushBuffer();
                                    options?.onOutput?.('', {
                                        type: 'tool_use',
                                        toolName: msgEvent.toolCall?.name || 'Tool',
                                        toolInput: msgEvent.toolCall?.arguments || {},
                                        toolUseId: msgEvent.toolCall?.id || '',
                                    });
                                    break;
                                case 'toolcall_end':
                                    options?.onOutput?.('', {
                                        type: 'tool_result',
                                        toolUseId: msgEvent.toolCall?.id || '',
                                        isError: false,
                                    });
                                    break;
                            }
                            break;
                        }

                        case 'tool_execution_update':
                            // 工具输出也累积
                            if (typeof evt.textDelta === 'string') {
                                textBuf += evt.textDelta;
                            }
                            break;
                        case 'tool_execution_end':
                            // 工具结束 → flush 输出 + tool_result
                            flushBuffer();
                            options?.onOutput?.('', {
                                type: 'tool_result',
                                toolName: evt.toolName,
                                isError: evt.isError,
                            });
                            break;

                        case 'message_end':
                            // 消息完成 → flush 剩余文本
                            flushBuffer();
                            break;

                        case 'agent_end':
                            flushBuffer();
                            unsubscribe();
                            resolve();
                            break;

                        case 'agent_start':
                            // Agent 开始处理
                            break;

                        case 'turn_end':
                            // 单轮结束
                            break;
                    }
                });

                // 处理中止信号
                if (options?.signal) {
                    const onAbort = () => {
                        isAborted = true;
                        session.abort().catch(() => {});
                        unsubscribe();
                        resolve();
                    };
                    options.signal.addEventListener('abort', onAbort, { once: true });
                }
            });

            // 发送 prompt
            await session.prompt(input.prompt);

            // 等待完成
            await completionPromise;

            const sessionId = input.sessionId || `pi-${Date.now()}`;

            return {
                exitCode: isAborted ? null : 0,
                stdout,
                stderr,
                aborted: isAborted,
                sessionId,
            };
        } catch (err) {
            const message = getErrorMessage(err);
            options?.onError?.(message);
            return {
                exitCode: 1,
                stdout: '',
                stderr: message,
                aborted: options?.signal?.aborted ?? false,
            };
        }
    }

    async loadSkills(): Promise<SkillInfo[]> {
        // pi 使用 SKILL.md 文件系统方式管理 skill，
        // 与 Claude/Codex 的独立 skill 系统不同。
        // pi 的 skill 通过 ResourceLoader 自动发现。
        return [];
    }

    async loadMcpServers(): Promise<McpServerInfo[]> {
        // pi 通过 ~/.pi/agent/settings.json 管理 MCP 配置，
        // 而不是像 Claude/Codex 那样有独立的 MCP 服务器配置。
        return [];
    }

    async dispose(): Promise<void> {
        if (this.currentSession) {
            this.currentSession.dispose();
            this.currentSession = null;
        }
        this.sessionMapping.clear();
    }

    /** pi 无 canUseTool 机制，空实现 */
    confirmPermission(
        _permissionRequestId: string,
        _decision: 'allow' | 'deny',
        _message?: string,
        _modifiedInput?: Record<string, unknown>,
    ): void {
        // no-op: pi uses its own permission system
    }

    /**
     * 动态导入 pi SDK（ESM-only 包，CJS 环境用 dynamic import）
     */
    private async importPiSdk(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
        // 使用 Function 构造器绕过 tsc 的静态分析
        const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (
            m: string,
        ) => Promise<typeof import('@earendil-works/pi-coding-agent')>;
        return dynamicImport('@earendil-works/pi-coding-agent');
    }
}

/**
 * 将我们项目的 reasoningEffort 映射为 pi 的 thinkingLevel
 */
function mapReasoningToThinkingLevel(
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
): 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
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
            return 'medium';
    }
}
