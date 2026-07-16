/**
 * @file Tool Executor
 * @description 工具执行器 - 负责安全、可靠地执行 Agent 工具调用
 *
 * 核心功能：
 * 1. 重试机制 - 支持指数退避的重试策略
 * 2. 超时控制 - 防止工具调用无限期阻塞
 * 3. 降级策略 - 工具失败时的备用方案
 * 4. 监控和日志 - 记录所有工具调用
 */

import {ToolConfig, ToolExecutor, RetryConfig} from './types.js';

/**
 * 工具注册表 - 管理所有可用工具
 */
class ToolRegistry {
    private tools: Map<string, ToolConfig & { handler: (params: any) => Promise<any> }> = new Map();

    /**
     * 注册工具
     */
    register(tool: ToolConfig & { handler: (params: any) => Promise<any> }): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * 获取工具配置
     */
    get(name: string): (ToolConfig & { handler: (params: any) => Promise<any> }) | undefined {
        return this.tools.get(name);
    }

    /**
     * 检查工具是否存在
     */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * 获取所有工具名称
     */
    list(): string[] {
        return Array.from(this.tools.keys());
    }
}

/**
 * 工具执行器实现
 */
export class ToolExecutorImpl implements ToolExecutor {
    private registry: ToolRegistry;
    private defaultRetryConfig: RetryConfig;

    constructor() {
        this.registry = new ToolRegistry();
        this.defaultRetryConfig = {
            maxAttempts: 3,
            backoff: 'exponential',
            initialDelay: 1000,
            maxDelay: 10000,
            retryIf: (error: Error) => {
                // 默认重试条件：临时性错误
                const retryableErrors = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'];
                return retryableErrors.some(code => error.message.includes(code));
            }
        };
    }

    /**
     * 注册工具
     */
    registerTool(tool: ToolConfig & { handler: (params: any) => Promise<any> }): void {
        this.registry.register(tool);
    }

    /**
     * 执行工具（带重试、超时、降级）
     */
    async execute(toolName: string, parameters: Record<string, unknown>): Promise<unknown> {
        const tool = this.registry.get(toolName);
        if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
        }

        const retryConfig = tool.retryable !== false ? this.defaultRetryConfig : {
            ...this.defaultRetryConfig,
            maxAttempts: 1
        };
        const timeout = tool.timeout ?? 30000; // 默认 30 秒

        try {
            // 带重试和超时的执行
            return await this.executeWithRetry(
                () => this.executeWithTimeout(tool.handler, parameters, timeout),
                retryConfig
            );
        } catch (error) {
            // 降级策略
            if (tool.fallback) {
                console.warn(`[ToolExecutor] Tool ${toolName} failed, trying fallback`);
                return await this.executeFallback(tool.fallback, error as Error, {tool, parameters});
            }
            throw error;
        }
    }

    /**
     * 带重试的执行
     */
    private async executeWithRetry<T>(
        fn: () => Promise<T>,
        config: RetryConfig
    ): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error as Error;

                // 检查是否应该重试
                if (config.retryIf && !config.retryIf(lastError)) {
                    throw lastError;
                }

                // 最后一次尝试失败，不再重试
                if (attempt === config.maxAttempts) {
                    throw lastError;
                }

                // 计算延迟时间
                const delay = this.calculateDelay(attempt, config);
                console.warn(`[ToolExecutor] Attempt ${attempt}/${config.maxAttempts} failed, retrying in ${delay}ms: ${lastError.message}`);

                // 等待后重试
                await this.sleep(delay);
            }
        }

        throw lastError;
    }

    /**
     * 带超时的执行
     */
    private async executeWithTimeout<T>(
        fn: (params: any) => Promise<T>,
        parameters: Record<string, unknown>,
        timeoutMs: number
    ): Promise<T> {
        return Promise.race([
            fn(parameters),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs)
            )
        ]);
    }

    /**
     * 执行降级策略
     */
    private async executeFallback(
        fallback: Required<ToolConfig>['fallback'],
        error: Error,
        context: { tool: ToolConfig; parameters: Record<string, unknown> }
    ): Promise<unknown> {
        try {
            return await Promise.race([
                fallback.handler(error, context),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Fallback execution timeout')), fallback.timeout ?? 5000)
                )
            ]);
        } catch (fallbackError) {
            console.error(`[ToolExecutor] Fallback also failed: ${fallbackError}`);
            throw fallbackError;
        }
    }

    /**
     * 计算重试延迟
     */
    private calculateDelay(attempt: number, config: RetryConfig): number {
        let delay: number;

        switch (config.backoff) {
            case 'fixed':
                delay = config.initialDelay;
                break;
            case 'linear':
                delay = config.initialDelay * attempt;
                break;
            case 'exponential':
                delay = config.initialDelay * Math.pow(2, attempt - 1);
                break;
            default:
                delay = config.initialDelay;
        }

        // 应用最大延迟限制
        if (config.maxDelay && delay > config.maxDelay) {
            delay = config.maxDelay;
        }

        return delay;
    }

    /**
     * 睡眠函数
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 检查工具是否存在
     */
    has(toolName: string): boolean {
        return this.registry.has(toolName);
    }

    /**
     * 获取所有工具列表
     */
    list(): string[] {
        return this.registry.list();
    }
}

/**
 * 创建工具执行器实例
 */
export function createToolExecutor(): ToolExecutorImpl {
    return new ToolExecutorImpl();
}
