"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolExecutorImpl = void 0;
exports.createToolExecutor = createToolExecutor;
/**
 * 工具注册表 - 管理所有可用工具
 */
class ToolRegistry {
    tools = new Map();
    /**
     * 注册工具
     */
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    /**
     * 获取工具配置
     */
    get(name) {
        return this.tools.get(name);
    }
    /**
     * 检查工具是否存在
     */
    has(name) {
        return this.tools.has(name);
    }
    /**
     * 获取所有工具名称
     */
    list() {
        return Array.from(this.tools.keys());
    }
}
/**
 * 工具执行器实现
 */
class ToolExecutorImpl {
    registry;
    defaultRetryConfig;
    constructor() {
        this.registry = new ToolRegistry();
        this.defaultRetryConfig = {
            maxAttempts: 3,
            backoff: 'exponential',
            initialDelay: 1000,
            maxDelay: 10000,
            retryIf: (error) => {
                // 默认重试条件：临时性错误
                const retryableErrors = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'];
                return retryableErrors.some(code => error.message.includes(code));
            }
        };
    }
    /**
     * 注册工具
     */
    registerTool(tool) {
        this.registry.register(tool);
    }
    /**
     * 执行工具（带重试、超时、降级）
     */
    async execute(toolName, parameters) {
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
            return await this.executeWithRetry(() => this.executeWithTimeout(tool.handler, parameters, timeout), retryConfig);
        }
        catch (error) {
            // 降级策略
            if (tool.fallback) {
                console.warn(`[ToolExecutor] Tool ${toolName} failed, trying fallback`);
                return await this.executeFallback(tool.fallback, error, { tool, parameters });
            }
            throw error;
        }
    }
    /**
     * 带重试的执行
     */
    async executeWithRetry(fn, config) {
        let lastError;
        for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
            try {
                return await fn();
            }
            catch (error) {
                lastError = error;
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
    async executeWithTimeout(fn, parameters, timeoutMs) {
        return Promise.race([
            fn(parameters),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs))
        ]);
    }
    /**
     * 执行降级策略
     */
    async executeFallback(fallback, error, context) {
        try {
            return await Promise.race([
                fallback.handler(error, context),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Fallback execution timeout')), fallback.timeout ?? 5000))
            ]);
        }
        catch (fallbackError) {
            console.error(`[ToolExecutor] Fallback also failed: ${fallbackError}`);
            throw fallbackError;
        }
    }
    /**
     * 计算重试延迟
     */
    calculateDelay(attempt, config) {
        let delay;
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
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * 检查工具是否存在
     */
    has(toolName) {
        return this.registry.has(toolName);
    }
    /**
     * 获取所有工具列表
     */
    list() {
        return this.registry.list();
    }
}
exports.ToolExecutorImpl = ToolExecutorImpl;
/**
 * 创建工具执行器实例
 */
function createToolExecutor() {
    return new ToolExecutorImpl();
}
//# sourceMappingURL=tool-executor.js.map