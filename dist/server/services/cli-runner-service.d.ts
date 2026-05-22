/**
 * @module cli-runner-service
 * @description CLI 运行器服务模块（Facade 模式）
 *
 * 作为 CLI Provider 的统一门面，对外保持原有接口不变（checkAvailability / runBridge），
 * 内部委托给当前激活的 CLIProvider 实现（Claude Code / OpenAI Codex）。
 *
 * 支持运行时切换 Provider，首次启动时通过引导流程选择。
 */
import type { CLIProvider } from './cli-providers/types.js';
/**
 * CLI 运行器的配置选项接口
 * @interface CLIRunnerOptions
 */
export interface CLIRunnerOptions {
    /** 工作区路径 */
    workspacePath: string;
    /** 标准输出回调函数 */
    onOutput?: (data: string) => void;
    /** 标准错误回调函数 */
    onError?: (data: string) => void;
    /** 中止信号 */
    signal?: AbortSignal;
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
/**
 * CLI 运行器服务类
 *
 * Facade 模式：对外保持原有 API 不变，内部委托给 CLIProvider 实现。
 * 支持通过构造函数指定初始 Provider，支持运行时切换。
 */
export declare class CLIRunnerService {
    /** 当前激活的 Provider */
    private provider;
    /** 当前 Provider ID */
    private activeProviderId;
    /**
     * 构造 CLI 运行器服务
     * @param activeProviderId - 初始 Provider ID，默认 'claude'
     */
    constructor(activeProviderId?: string);
    /**
     * 获取当前激活的 Provider ID
     */
    getActiveProviderId(): string;
    /**
     * 获取当前激活的 Provider
     */
    getProvider(): CLIProvider;
    /**
     * 切换到指定的 Provider
     * @param providerId - 目标 Provider ID
     */
    switchProvider(providerId: string): Promise<void>;
    /**
     * 检查 CLI 是否可用
     * @returns CLI 可用性信息
     */
    checkAvailability(): Promise<CLIVersionInfo>;
    /**
     * 通过当前 Provider 发送执行请求
     *
     * @param input - 执行输入参数
     * @param options - 可选的运行器配置
     * @returns 执行结果
     */
    runBridge(input: {
        prompt: string;
        cwd?: string;
        sessionId?: string;
        maxTurns?: number;
        skills?: string[] | 'all';
    }, options?: CLIRunnerOptions): Promise<CLIExecutionResult>;
    /**
     * 释放资源
     */
    dispose(): Promise<void>;
}
//# sourceMappingURL=cli-runner-service.d.ts.map