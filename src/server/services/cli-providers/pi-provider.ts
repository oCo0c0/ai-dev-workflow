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
import {ModelProviderStore} from '../model-provider-store.js';
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
            // 获取模型配置：优先用调用方（页面配置）传入的 provider/model，未指定时自动检测，绝不硬编码默认供应商
            let modelProvider = (options as any)?.piProvider as string | undefined;
            let modelId = options?.model as string | undefined;

            // 创建 AuthStorage（读取 pi 的认证配置）
            const authStorage = pi.AuthStorage.create();

            // 1) pi 自身认证存储里已配置 key 的提供商（自动检测）
            let availableModels: Array<{ provider: string; id: string }> = [];
            try {
                availableModels = (await pi.ModelRegistry.create(authStorage).getAvailable()) ?? [];
            } catch {
                // 读取失败时忽略，继续走后续兑底
            }

            if (!modelProvider) {
                const first = availableModels[0];
                if (first) {
                    modelProvider = first.provider;
                    if (!modelId) modelId = first.id;
                }
            }

            // 2) 应用自有模型供应商配置（models.json 的 pi:<provider> 记录）
            if (!modelProvider) {
                try {
                    const store = new ModelProviderStore();
                    const rec = store.list().find(
                        (r) => r.kind === 'pi' && r.enabled !== false && r.apiKey
                    );
                    if (rec) {
                        modelProvider = rec.id.startsWith('pi:') ? rec.id.slice(3) : rec.id;
                        if (!modelId) modelId = rec.defaultModel || rec.models?.[0];
                    }
                } catch {
                    // 忽略
                }
            }

            // 仍未确定提供商 → 明确报错，指导用户去页面配置
            if (!modelProvider) {
                throw new Error(
                    '未配置 pi 的 LLM 提供商。请在「模型配置」里选择提供商并配置 API Key（~/.pi/agent/auth.json 或环境变量）'
                );
            }

            // 已确定提供商但缺模型时，从可用模型里匹配；仍缺则报错
            if (!modelId) {
                modelId = availableModels.find((m) => m.provider === modelProvider)?.id;
            }
            if (!modelId) {
                throw new Error(
                    `未配置 pi 提供商「${modelProvider}」的模型。请在「模型配置」里选择模型`
                );
            }

            // 免 CLI 依赖：若调用方未显式传入 apiKey，则从自有模型供应商配置兜底注入
            if (!(options as any)?.apiKey) {
                try {
                    const store = new ModelProviderStore();
                    const ownRec = store.get(`pi:${modelProvider}`);
                    if (ownRec?.apiKey) {
                        authStorage.setRuntimeApiKey(modelProvider, ownRec.apiKey);
                    }
                } catch {
                    // 自有配置读取失败时静默降级
                }
            }

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
            // 思考文本缓冲区：与 Claude/Codex 一致，把 thinking_delta 归集为 {type:'thinking'}
            // 事件，供协调器写入「思考过程」面板，而非混入普通执行日志
            let thinkingBuf = '';
            // 工具输出缓冲区：把 tool_execution_update 的文本归集为 tool_result 内容，
            // 供「执行步骤」面板展开查看，而非混入普通执行日志
            let toolBuf = '';
            // 最近一次 toolcall_start 的 toolUseId，用于 tool_execution_end 关联步骤
            let pendingToolUseId = '';

            // 仅当有缓冲内容时才 emit 执行日志
            const flushBuffer = () => {
                if (textBuf) {
                    options?.onOutput?.(textBuf);
                    textBuf = '';
                }
            };

            // 累积的思考文本在关键边界（工具调用开始 / 消息结束 / Agent 结束）作为一条 thinking 事件发出
            const flushThinking = () => {
                if (thinkingBuf) {
                    options?.onOutput?.(thinkingBuf, {type: 'thinking'});
                    thinkingBuf = '';
                }
            };

            // 工具输出随 tool_result 一并发出（内容作为 onOutput 第一参数，
            // 由协调器 handleToolResult 写入「执行步骤」面板的 stepLog）
            const takeToolOutput = () => {
                const out = toolBuf;
                toolBuf = '';
                return out;
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
                                    // 思考文本累积到独立缓冲，在关键边界作为 thinking 事件发出
                                    thinkingBuf += msgEvent.delta || '';
                                    break;
                                case 'toolcall_start':
                                    // tool 开始 → 先 flush 思考与文本，再发出 tool_use
                                    flushThinking();
                                    flushBuffer();
                                    pendingToolUseId = msgEvent.toolCall?.id || '';
                                    options?.onOutput?.('', {
                                        type: 'tool_use',
                                        toolName: msgEvent.toolCall?.name || 'Tool',
                                        toolInput: msgEvent.toolCall?.arguments || {},
                                        toolUseId: pendingToolUseId,
                                    });
                                    break;
                                case 'toolcall_end':
                                    // 模型侧工具声明结束；结果随 tool_execution_end 一并发出
                                    break;
                            }
                            break;
                        }

                        case 'tool_execution_update':
                            // 工具输出累积到独立缓冲，作为 tool_result 内容（进入「执行步骤」面板）
                            if (typeof evt.textDelta === 'string') {
                                toolBuf += evt.textDelta;
                            }
                            break;
                        case 'tool_execution_end':
                            // 工具结束 → 发出 tool_result（携带工具输出内容 + 关联的 toolUseId）
                            flushThinking();
                            options?.onOutput?.(takeToolOutput(), {
                                type: 'tool_result',
                                toolName: evt.toolName,
                                toolUseId: pendingToolUseId,
                                isError: evt.isError,
                            });
                            pendingToolUseId = '';
                            break;

                        case 'message_end':
                            // 消息完成 → flush 思考 + 剩余文本
                            flushThinking();
                            flushBuffer();
                            break;

                        case 'agent_end':
                            flushThinking();
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
        // pi 官方不支持 MCP（README: No MCP），但预留读取 ~/.pi/agent/settings.json 的 mcpServers 段，
        // 便于将来 pi 扩展或用户手动配置后 adw 侧可见。
        try {
            const fs = await import('fs');
            const os = await import('os');
            const path = await import('path');
            const settingsFile = path.join(os.homedir(), '.pi', 'agent', 'settings.json');
            if (!fs.existsSync(settingsFile)) return [];
            const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            const mcp = parsed?.mcpServers;
            if (!mcp || typeof mcp !== 'object') return [];
            return Object.entries(mcp as Record<string, {command?: string; args?: string[]; env?: Record<string, string>}>)
                .filter(([, c]) => typeof c?.command === 'string' && c.command.trim() !== '')
                .map(([name, c]) => ({
                    name,
                    type: 'custom',
                    command: c?.command ?? '',
                    args: Array.isArray(c?.args) ? c.args : [],
                    env: (typeof c?.env === 'object' && c.env !== null) ? c.env : {},
                    enabled: true,
                }));
        } catch {
            return [];
        }
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
