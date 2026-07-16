/**
 * @file Agent执行存储服务
 * @description Agent执行持久化存储服务模块
 *
 * 管理Agent执行记录的持久化存储。
 * 每个执行存储在：agent-executions/{executionId}.json
 * 同时维护索引以支持快速查找。
 */
import type { RequirementAnalysisResult, CodeGenerationResult, TestResult, CodeReviewResult } from './agents/types.js';
import type { ExecutionPlan } from './agents/coordinator-agent.js';
/**
 * 协调Agent执行结果（简化版，用于存储）
 */
export interface StoredCoordinatorResult {
    plan: ExecutionPlan;
    finalResult?: any;
}
/**
 * Agent执行记录接口
 */
export interface AgentExecution {
    /** 执行唯一标识符 */
    id: string;
    /** Agent ID */
    agentId: string;
    /** 任务 ID */
    taskId: string;
    /** 执行状态 */
    status: 'running' | 'completed' | 'failed' | 'aborted' | 'paused';
    /** 输入数据 */
    inputData: Record<string, unknown>;
    /** 执行选项 */
    options?: {
        targetQuality?: number;
        tokenBudget?: number;
        maxIterations?: number;
    };
    /** 工作流类型 */
    workflowType?: string;
    /** 执行结果 */
    result?: RequirementAnalysisResult | CodeGenerationResult | TestResult | CodeReviewResult | StoredCoordinatorResult;
    /** 质量评估 */
    quality?: number;
    /** 执行时长（毫秒） */
    duration?: number;
    /** Token消耗 */
    tokensUsed?: number;
    /** 错误信息 */
    error?: string;
    /** 创建时间 */
    createdAt: string;
    /** 最后更新时间 */
    updatedAt: string;
}
/**
 * Agent执行存储服务类
 *
 * 按执行ID存储：agent-executions/{executionId}.json
 */
export declare class AgentStoreService {
    /** 获取执行文件路径 */
    private executionFilePath;
    /** 从文件读取执行记录 */
    private readExecutionFile;
    /** 写入执行记录到文件 */
    private writeExecutionFile;
    /**
     * 列出所有执行记录（按 updatedAt 倒序）
     */
    list(): Promise<AgentExecution[]>;
    /** 同步列表（仅fallback用） */
    private listSync;
    private readExecutionFileAsync;
    /**
     * 根据执行ID获取记录
     */
    get(executionId: string): AgentExecution | undefined;
    /**
     * 根据Agent ID获取执行记录列表
     */
    getByAgent(agentId: string): AgentExecution[];
    /**
     * 根据任务ID获取执行记录列表
     */
    getByTask(taskId: string): AgentExecution[];
    /**
     * 创建或更新执行记录（自动填充 updatedAt）
     */
    upsert(execution: Omit<AgentExecution, 'updatedAt'> & {
        updatedAt?: string;
    }): AgentExecution;
    /**
     * 根据执行ID删除记录
     */
    delete(executionId: string): boolean;
    /**
     * 清理旧执行记录（超过指定天数）
     */
    cleanupOldExecutions(daysToKeep?: number): Promise<number>;
    /**
     * 获取统计信息
     */
    getStats(): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byAgent: Record<string, number>;
    }>;
}
//# sourceMappingURL=agent-store-service.d.ts.map