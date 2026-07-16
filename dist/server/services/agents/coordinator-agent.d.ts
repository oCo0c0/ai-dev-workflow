/**
 * @file 协调Agent（CoordinatorAgent）
 * @description 项目经理Agent，负责分析需求、规划步骤、协调执行
 *
 * 核心职责：
 * 1. 需求分析 → 理解用户要做什么
 * 2. 任务规划 → 决定需要哪些Agent、按什么顺序执行
 * 3. 协调执行 → 调用专业Agent、处理异常、用户交互
 * 4. 结果整合 → 汇总各Agent成果、返回最终结果
 */
import { AgentsService } from './agents-service.js';
/**
 * 执行步骤
 */
export interface ExecutionStep {
    /** 步骤序号 */
    order: number;
    /** Agent ID */
    agentId: string;
    /** Agent名称 */
    agentName: string;
    /** 为什么需要这个Agent */
    reasoning: string;
    /** 置信度 */
    confidence: number;
    /** 依赖的前置步骤序号 */
    dependencies: number[];
    /** 状态 */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    /** 执行结果 */
    result?: any;
    /** 错误信息 */
    error?: string;
}
/**
 * 执行计划
 */
export interface ExecutionPlan {
    /** 计划ID */
    planId: string;
    /** 需求描述 */
    requirement: string;
    /** 工作区路径 */
    workspace: string;
    /** 执行步骤 */
    steps: ExecutionStep[];
    /** 总体策略说明 */
    strategy: string;
    /** 预估token消耗 */
    estimatedTokens: number;
    /** 暂停请求标志 */
    pauseRequested?: boolean;
    /** 用户问题队列 */
    userQuestions?: Array<{
        question: string;
        answer?: string;
    }>;
}
/**
 * 执行结果
 */
export interface CoordinatorResult {
    /** 是否成功 */
    success: boolean;
    /** 执行计划 */
    plan: ExecutionPlan;
    /** 最终结果 */
    finalResult?: any;
    /** 总耗时 */
    totalDuration: number;
    /** 总token消耗 */
    totalTokens: number;
    /** 错误信息 */
    errors: string[];
}
/**
 * 协调Agent配置
 */
export interface CoordinatorConfig {
    /** 是否允许用户交互（遇到问题时询问） */
    allowUserInteraction?: boolean;
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 进度回调 */
    onProgress?: (step: ExecutionStep, plan: ExecutionPlan) => void;
    /** 用户问题回调 */
    onUserQuestion?: (question: string) => Promise<string>;
}
/**
 * 协调Agent
 */
export declare class CoordinatorAgent {
    private agentsService;
    private config;
    constructor(agentsService?: AgentsService, config?: CoordinatorConfig);
    /**
     * 执行任务（主入口）
     * @param requirement 需求描述
     * @param workspace 工作区路径
     * @param context 额外上下文
     * @param options 执行选项
     */
    execute(requirement: string, workspace: string, context?: any, options?: {
        planOnly?: boolean;
        skipConfirmation?: boolean;
    }): Promise<CoordinatorResult>;
    /**
     * 制定执行计划
     */
    private plan;
    /**
     * 分析需求，提取关键任务
     */
    private analyzeRequirement;
    /**
     * 生成策略说明
     */
    private generateStrategy;
    /**
     * 执行计划
     */
    private executePlan;
    /**
     * 向用户提问并等待回答
     */
    private askUser;
    /**
     * 检查依赖是否满足
     */
    private checkDependencies;
    /**
     * 准备输入数据
     */
    private prepareInputData;
    /**
     * 判断是否为关键步骤
     */
    private isCriticalStep;
    /**
     * 汇总结果
     */
    private aggregateResults;
    /**
     * 创建空计划（fallback）
     */
    private createEmptyPlan;
}
/**
 * 创建协调Agent实例
 */
export declare function createCoordinatorAgent(agentsService?: AgentsService, config?: CoordinatorConfig): CoordinatorAgent;
//# sourceMappingURL=coordinator-agent.d.ts.map