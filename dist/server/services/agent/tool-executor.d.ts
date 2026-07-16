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
import { ToolConfig, ToolExecutor } from './types.js';
/**
 * 工具执行器实现
 */
export declare class ToolExecutorImpl implements ToolExecutor {
    private registry;
    private defaultRetryConfig;
    constructor();
    /**
     * 注册工具
     */
    registerTool(tool: ToolConfig & {
        handler: (params: any) => Promise<any>;
    }): void;
    /**
     * 执行工具（带重试、超时、降级）
     */
    execute(toolName: string, parameters: Record<string, unknown>): Promise<unknown>;
    /**
     * 带重试的执行
     */
    private executeWithRetry;
    /**
     * 带超时的执行
     */
    private executeWithTimeout;
    /**
     * 执行降级策略
     */
    private executeFallback;
    /**
     * 计算重试延迟
     */
    private calculateDelay;
    /**
     * 睡眠函数
     */
    private sleep;
    /**
     * 检查工具是否存在
     */
    has(toolName: string): boolean;
    /**
     * 获取所有工具列表
     */
    list(): string[];
}
/**
 * 创建工具执行器实例
 */
export declare function createToolExecutor(): ToolExecutorImpl;
//# sourceMappingURL=tool-executor.d.ts.map