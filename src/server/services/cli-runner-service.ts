/**
 * @module cli-runner-service
 * @description CLI 运行器服务模块（Facade 模式）
 *
 * 作为 CLI Provider 的统一门面，对外保持原有接口不变（checkAvailability / runBridge），
 * 内部委托给当前激活的 CLIProvider 实现（Claude Code / OpenAI Codex）。
 *
 * 支持运行时切换 Provider，首次启动时通过引导流程选择。
 */

import {getErrorMessage} from '../utils/error-utils.js';
import {getProvider} from './cli-providers';
import type {CLIProvider, McpStdioMap} from './cli-providers/types.js';
import {ClaudeProvider} from './cli-providers/claude-provider.js';
import {ConfigService} from './config-service.js';
import {ModelProviderStore} from './model-provider-store.js';
import type {ModelProviderRecord} from './model-provider-types.js';

// === 数据模型（保持原有接口不变，向后兼容） ===

/**
 * CLI 运行器的配置选项接口
 * @interface CLIRunnerOptions
 */
export interface CLIRunnerOptions {
    /** 工作区路径 */
    workspacePath: string;
    /** 标准输出回调函数（meta 用于传递结构化事件类型） */
    onOutput?: (data: string, meta?: Record<string, unknown>) => void;
    /** 标准错误回调函数 */
    onError?: (data: string) => void;
    /** 中止信号 */
    signal?: AbortSignal;
    /** 工具权限请求回调（agent 执行时注入；不传则 bridge 不启用权限确认） */
    onPermissionRequest?: (meta: Record<string, unknown>) => void;
    /**
     * 覆盖推理强度（跨 Provider 通用：Claude/Codex/Pi 各自映射）。
     * 仅显式传值时生效，用于轻量调用降低推理强度。
     */
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** 覆盖是否启用扩展思考（仅显式传值时生效；对不支持的 Provider 无影响） */
    extendedThinking?: boolean;
}

/**
 * CLI 版本信息接口
 * @interface CLIVersionInfo
 */
export interface CLIVersionInfo {
    /** CLI 是否可用 */
    available: boolean;
    /** CLI 版本号 */
    version?: string;
    /** CLI 路径 */
    path?: string;
    /** 不可用时的错误信息 */
    error?: string;
}

/**
 * CLI 执行结果接口
 * @interface CLIExecutionResult
 */
export interface CLIExecutionResult {
    /** 进程退出码 */
    exitCode: number | null;
    /** 标准输出 */
    stdout: string;
    /** 标准错误 */
    stderr: string;
    /** 是否被中止 */
    aborted: boolean;
    /** 会话 ID */
    sessionId?: string;
}

// === CLI 运行器服务（Facade） ===

/**
 * CLI 运行器服务类
 *
 * Facade 模式：对外保持原有 API 不变，内部委托给 CLIProvider 实现。
 * 支持通过构造函数指定初始 Provider，支持运行时切换。
 */
export class CLIRunnerService {
    /** 当前激活的 Provider */
    private provider!: CLIProvider;
    /** 当前 Provider ID */
    private activeProviderId!: string;
    /** 当前激活的自定义供应商记录 id（models.json 中 kind='custom'），null = 内置 provider */
    private modelRecordId: string | null = null;

    /**
     * 构造 CLI 运行器服务
     * @param activeProviderId - 初始 Provider ID，默认 'claude'（内置或自定义供应商记录 id）
     */
    constructor(activeProviderId: string = 'claude') {
        const builtin = activeProviderId === 'claude' || activeProviderId === 'codex' || activeProviderId === 'pi' || activeProviderId === 'dsh';
        if (!builtin) {
            // 自定义供应商记录：经 Claude 引擎调用 Anthropic 兼容端点（如智谱）
            const rec = this.readCustomRecord(activeProviderId);
            if (rec) {
                this.modelRecordId = activeProviderId;
                this.provider = getProvider('claude')!;
                this.activeProviderId = activeProviderId;
                this.applyModelRecord(rec);
                this.provider.initialize().catch(() => {
                });
                return;
            }
            // 记录不存在 → fallback 到 claude
            this.provider = getProvider('claude')!;
            this.activeProviderId = 'claude';
            this.provider.initialize().catch(() => {
            });
            return;
        }

        const provider = getProvider(activeProviderId);
        if (!provider) {
            // fallback 到 claude
            this.provider = getProvider('claude')!;
            this.activeProviderId = 'claude';
        } else {
            this.provider = provider;
            this.activeProviderId = activeProviderId;
        }

        // 预热：非阻塞启动 Provider
        this.provider.initialize().catch(() => {
            // 启动失败时静默忽略，首次实际请求时会重试
        });
    }

    /**
     * 获取当前激活的 Provider ID
     */
    getActiveProviderId(): string {
        return this.activeProviderId;
    }

    /**
     * 获取当前激活的 Provider
     */
    getProvider(): CLIProvider {
        return this.provider;
    }

    /**
     * 读取 models.json 中的自定义供应商记录（kind='custom' 且启用）。
     * 不存在/非法时返回 undefined。
     */
    private readCustomRecord(id: string): ModelProviderRecord | undefined {
        try {
            const rec = new ModelProviderStore().get(id);
            return rec && rec.kind === 'custom' ? rec : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * 将自定义供应商记录注入到 Claude 引擎（baseUrl/apiKey/defaultModel）。
     * bridge 会在下一次 initialize 重启时加载新 env。
     */
    private applyModelRecord(rec: ModelProviderRecord): void {
        const claude = getProvider('claude') as ClaudeProvider | undefined;
        if (claude) {
            claude.setModelRecord({
                baseUrl: rec.baseUrl,
                apiKey: rec.apiKey,
                defaultModel: rec.defaultModel,
            });
        }
    }

    /**
     * 切换到指定的 Provider
     * @param providerId - 目标 Provider ID（内置 'claude' | 'codex' | 'pi'，或自定义供应商记录 id）
     */
    async switchProvider(providerId: string): Promise<void> {
        const builtin = providerId === 'claude' || providerId === 'codex' || providerId === 'pi' || providerId === 'dsh';

        // 释放当前 Provider 资源
        try {
            await this.provider.dispose();
        } catch { /* ignore dispose errors */
        }

        if (!builtin) {
            // 自定义供应商记录：读取 models.json 中的 kind='custom' 记录，经 Claude 引擎调用 Anthropic 兼容端点
            const rec = this.readCustomRecord(providerId);
            if (!rec) {
                throw new Error(`Unknown custom provider: ${providerId}`);
            }
            this.modelRecordId = providerId;
            const claude = getProvider('claude') as ClaudeProvider | undefined;
            if (!claude) {
                throw new Error('Claude provider unavailable for custom model routing');
            }
            this.provider = claude;
            this.activeProviderId = providerId;
            // 注入 baseUrl/apiKey/defaultModel 到 Claude 引擎，bridge 重启时加载新 env
            this.applyModelRecord(rec);
            await this.provider.initialize();
            return;
        }

        const newProvider = getProvider(providerId);
        if (!newProvider) {
            throw new Error(`Unknown CLI provider: ${providerId}`);
        }
        // 切回内置：清除自定义记录，恢复默认环境
        this.modelRecordId = null;
        const claude = getProvider('claude') as ClaudeProvider | undefined;
        if (claude) claude.setModelRecord(null);

        this.provider = newProvider;
        this.activeProviderId = providerId;

        // 初始化新 Provider
        await this.provider.initialize();
    }

    /**
     * 检查 CLI 是否可用
     * @returns CLI 可用性信息
     */
    async checkAvailability(): Promise<CLIVersionInfo> {
        try {
            await this.provider.initialize();
            const status = await this.provider.detect();
            return {
                available: status.available,
                version: status.version,
                path: status.path,
                error: status.error,
            };
        } catch (err) {
            return {available: false, error: getErrorMessage(err)};
        }
    }

    /**
     * 通过当前 Provider 发送执行请求
     *
     * @param input - 执行输入参数
     * @param options - 可选的运行器配置
     * @returns 执行结果
     */
    async runBridge(
        input: {
            prompt: string;
            cwd?: string;
            sessionId?: string;
            maxTurns?: number;
            maxHistoryMessages?: number;
            skills?: string[] | 'all';
            mcpServers?: McpStdioMap
        },
        options?: CLIRunnerOptions
    ): Promise<CLIExecutionResult> {
        // 从配置文件读取当前 Provider 的模型配置并注入到 options
        let modelOptions: {
            model?: string;
            reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
            extendedThinking?: boolean;
            streaming?: boolean;
        } = {};
        try {
            const configService = new ConfigService();
            const config = configService.load();
            if (this.modelRecordId) {
                // 自定义供应商记录激活：用记录自身的默认模型，不传 reasoningEffort/extendedThinking
                //（第三方 Anthropic 兼容端点未必支持这些参数），streaming 沿用 claude 偏好
                const rec = this.readCustomRecord(this.modelRecordId);
                if (rec) {
                    modelOptions = {
                        model: rec.defaultModel || rec.models?.[0] || config.cliProvider?.claude?.model,
                        streaming: config.cliProvider?.claude?.streaming,
                    };
                }
            } else if (this.activeProviderId === 'claude' && config.cliProvider?.claude) {
                modelOptions = {
                    model: config.cliProvider.claude.model,
                    reasoningEffort: config.cliProvider.claude.reasoningEffort,
                    extendedThinking: config.cliProvider.claude.extendedThinking,
                    streaming: config.cliProvider.claude.streaming,
                };
            } else if (this.activeProviderId === 'codex' && config.cliProvider?.codex) {
                modelOptions = {
                    model: config.cliProvider.codex.model,
                    streaming: config.cliProvider.codex.streaming,
                };
            } else if (this.activeProviderId === 'pi' && config.cliProvider?.pi) {
                modelOptions = {
                    model: config.cliProvider.pi.model,
                    streaming: config.cliProvider.pi.streaming,
                    reasoningEffort: config.cliProvider.pi.reasoningEffort,
                    piProvider: config.cliProvider.pi.provider,
                } as any;
            } else if (this.activeProviderId === 'dsh' && config.cliProvider?.dsh) {
                modelOptions = {
                    model: config.cliProvider.dsh.model,
                    streaming: config.cliProvider.dsh.streaming,
                };
            }
        } catch {
            // 配置读取失败时使用 Provider 默认行为
        }

        const result = await this.provider.run(
            {
                prompt: input.prompt,
                cwd: input.cwd,
                sessionId: input.sessionId,
                maxTurns: input.maxTurns,
                skills: input.skills,
                mcpServers: input.mcpServers,
            },
            {
                workspacePath: options?.workspacePath,
                signal: options?.signal,
                onOutput: options?.onOutput,
                onError: options?.onError,
                onPermissionRequest: options?.onPermissionRequest,
                ...modelOptions,
                // 调用方显式覆盖（优先级高于配置文件），用于轻量调用降低推理强度等场景
                ...(options?.reasoningEffort !== undefined ? {reasoningEffort: options.reasoningEffort} : {}),
                ...(options?.extendedThinking !== undefined ? {extendedThinking: options.extendedThinking} : {}),
            }
        );

        return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr ?? '',
            aborted: result.aborted ?? false,
            sessionId: result.sessionId,
        };
    }

    /**
     * 反向写回工具权限决策（透传给当前 Provider，唤醒挂起的 canUseTool）
     */
    confirmPermission(permissionRequestId: string, decision: 'allow' | 'deny', message?: string, modifiedInput?: Record<string, unknown>): void {
        this.provider.confirmPermission(permissionRequestId, decision, message, modifiedInput);
    }

    /**
     * 释放资源
     */
    async dispose(): Promise<void> {
        await this.provider.dispose();
    }
}
