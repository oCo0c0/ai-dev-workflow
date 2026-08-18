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
import {createProvider, getProvider, isBuiltinProviderId, DEFAULT_PROVIDER_ID} from './cli-providers';
import type {CLIProvider, McpStdioMap} from './cli-providers/types.js';
import {ConfigService} from './config-service.js';
import {ModelProviderStore} from './model-provider-store.js';
import type {ModelProviderRecord} from './model-provider-types.js';

// === 常量 ===

/**
 * 自定义模型供应商的执行引擎 id。
 * 语义：models.json 中 kind='custom' 的记录指向 Anthropic 兼容端点，
 * 统一经 claude 引擎（supportsCustomEndpoint）调用。
 */
export const CUSTOM_MODEL_ENGINE_ID = DEFAULT_PROVIDER_ID;

/**
 * 读取 models.json 中的自定义供应商记录（kind='custom'）。
 * 模块级工具函数：CLIRunnerService 实例逻辑与任务级工厂 createConfiguredProvider 共用。
 */
function readCustomRecord(id: string): ModelProviderRecord | undefined {
    try {
        const rec = new ModelProviderStore().get(id);
        return rec && rec.kind === 'custom' ? rec : undefined;
    } catch {
        return undefined;
    }
}

/**
 * 按当前配置创建一个独立的 Provider 实例（多任务并行 / 任务级隔离用）。
 *
 * 与 CLIRunnerService 管理的共享单例不同，每次调用返回全新实例（独立子进程/会话），
 * 调用方自行负责 initialize()/dispose() 生命周期。
 * 路由规则与 CLIRunnerService 一致：
 * - 内置 id → 对应 Provider 全新实例
 * - 自定义供应商记录 → CUSTOM_MODEL_ENGINE_ID 引擎实例，并注入端点配置
 */
export function createConfiguredProvider(): CLIProvider {
    let activeId = DEFAULT_PROVIDER_ID;
    try {
        activeId = new ConfigService().load().cliProvider?.active || DEFAULT_PROVIDER_ID;
    } catch { /* 配置读取失败使用默认 Provider */ }

    if (isBuiltinProviderId(activeId)) {
        return createProvider(activeId) ?? createProvider(DEFAULT_PROVIDER_ID)!;
    }

    // 自定义供应商记录：经引擎 Provider 执行并注入端点配置
    const engine = createProvider(CUSTOM_MODEL_ENGINE_ID) ?? getProvider(CUSTOM_MODEL_ENGINE_ID)!;
    const rec = readCustomRecord(activeId);
    if (rec) {
        engine.setModelRecord?.({
            baseUrl: rec.baseUrl,
            apiKey: rec.apiKey,
            defaultModel: rec.defaultModel,
        });
    }
    return engine;
}

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
     * @param activeProviderId - 初始 Provider ID，默认 DEFAULT_PROVIDER_ID（内置或自定义供应商记录 id）
     */
    constructor(activeProviderId: string = DEFAULT_PROVIDER_ID) {
        const builtin = isBuiltinProviderId(activeProviderId);
        if (!builtin) {
            // 自定义供应商记录：经 Claude 引擎调用 Anthropic 兼容端点（如智谱）
            const rec = readCustomRecord(activeProviderId);
            if (rec) {
                this.modelRecordId = activeProviderId;
                this.provider = getProvider(CUSTOM_MODEL_ENGINE_ID)!;
                this.activeProviderId = activeProviderId;
                this.applyModelRecord(rec);
                this.provider.initialize().catch(() => {
                });
                return;
            }
            // 记录不存在 → fallback 到默认 Provider
            this.provider = getProvider(DEFAULT_PROVIDER_ID)!;
            this.activeProviderId = DEFAULT_PROVIDER_ID;
            this.provider.initialize().catch(() => {
            });
            return;
        }

        const provider = getProvider(activeProviderId);
        if (!provider) {
            // fallback 到默认 Provider
            this.provider = getProvider(DEFAULT_PROVIDER_ID)!;
            this.activeProviderId = DEFAULT_PROVIDER_ID;
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
        return readCustomRecord(id);
    }

    /**
     * 将自定义供应商记录注入到当前引擎 Provider（baseUrl/apiKey/defaultModel）。
     * 通过接口可选方法 setModelRecord 注入，不下行转型到具体实现；
     * 不支持该能力的 Provider 静默跳过（调用前已确保走 supportsCustomEndpoint 引擎）。
     * bridge 会在下一次 initialize 重启时加载新 env。
     */
    private applyModelRecord(rec: ModelProviderRecord): void {
        this.provider.setModelRecord?.({
            baseUrl: rec.baseUrl,
            apiKey: rec.apiKey,
            defaultModel: rec.defaultModel,
        });
    }

    /**
     * 切换到指定的 Provider
     * @param providerId - 目标 Provider ID（内置 id，或自定义供应商记录 id）
     */
    async switchProvider(providerId: string): Promise<void> {
        const builtin = isBuiltinProviderId(providerId);

        // 释放当前 Provider 资源
        try {
            await this.provider.dispose();
        } catch { /* ignore dispose errors */
        }

        if (!builtin) {
            // 自定义供应商记录：读取 models.json 中的 kind='custom' 记录，经 Claude 引擎调用 Anthropic 兼容端点
            const rec = readCustomRecord(providerId);
            if (!rec) {
                throw new Error(`Unknown custom provider: ${providerId}`);
            }
            this.modelRecordId = providerId;
            const engine = getProvider(CUSTOM_MODEL_ENGINE_ID);
            if (!engine || typeof engine.setModelRecord !== 'function') {
                throw new Error(`Provider "${CUSTOM_MODEL_ENGINE_ID}" does not support custom model routing`);
            }
            this.provider = engine;
            this.activeProviderId = providerId;
            // 注入 baseUrl/apiKey/defaultModel 到引擎，bridge 重启时加载新 env
            this.applyModelRecord(rec);
            await this.provider.initialize();
            return;
        }

        const newProvider = getProvider(providerId);
        if (!newProvider) {
            throw new Error(`Unknown CLI provider: ${providerId}`);
        }
        // 切回内置：清除自定义端点记录，恢复引擎默认环境
        this.modelRecordId = null;
        const engine = getProvider(CUSTOM_MODEL_ENGINE_ID);
        engine?.setModelRecord?.(null);

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
        // 从配置文件读取当前 Provider 的模型配置并注入到 options（数据驱动，无 per-provider 分支）
        let modelOptions: {
            model?: string;
            modelProvider?: string;
            reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
            extendedThinking?: boolean;
            streaming?: boolean;
        } = {};
        try {
            const config = new ConfigService().load();
            // 配置读取的引擎 id：custom 记录经引擎 Provider 执行，streaming 等偏好沿用引擎配置
            const engineId = this.modelRecordId ?? this.activeProviderId;
            const settings = config.cliProvider?.models?.[engineId] ?? {};
            const caps = this.provider.capabilities;

            if (this.modelRecordId) {
                // 自定义供应商记录激活：用记录自身的默认模型，不传 reasoningEffort/extendedThinking
                //（第三方 Anthropic 兼容端点未必支持这些参数），streaming 沿用引擎偏好
                const rec = readCustomRecord(this.modelRecordId);
                if (rec) {
                    modelOptions = {
                        model: rec.defaultModel || rec.models?.[0] || settings.model,
                        streaming: settings.streaming,
                    };
                }
            } else {
                // 内置 Provider：按能力声明门控字段，不支持的参数不下发
                modelOptions = {
                    model: settings.model,
                    streaming: settings.streaming,
                    ...(caps.supportsReasoningEffort && settings.reasoningEffort !== undefined
                        ? {reasoningEffort: settings.reasoningEffort}
                        : {}),
                    ...(caps.supportsExtendedThinking && settings.extendedThinking !== undefined
                        ? {extendedThinking: settings.extendedThinking}
                        : {}),
                    ...(settings.modelProvider !== undefined ? {modelProvider: settings.modelProvider} : {}),
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
