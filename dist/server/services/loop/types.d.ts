/**
 * @file Loop System Types
 * @description 循环优化系统的类型定义
 */
/**
 * 循环策略
 */
export type LoopStrategy = 'quick-prototype' | 'quality-optimization' | 'fine-polishing' | 'cost-effective';
/**
 * 循环配置
 */
export interface LoopConfig {
    /** 最大迭代次数 */
    maxIterations?: number;
    /** 目标质量阈值 */
    targetQuality?: number;
    /** Token 预算 */
    tokenBudget?: number;
    /** 时间限制（毫秒） */
    timeLimit?: number;
    /** 循环策略 */
    strategy?: LoopStrategy;
    /** 是否自适应调整策略 */
    adaptive?: boolean;
    /** 质量评估函数 */
    qualityEvaluator?: (result: any) => Promise<number>;
    /** 成本估算函数 */
    costEstimator?: (action: any) => number;
}
/**
 * 循环状态
 */
export interface LoopState {
    /** 当前迭代次数 */
    iteration: number;
    /** 当前质量 */
    quality: number;
    /** 已消耗 Token */
    tokensUsed: number;
    /** 已消耗时间（毫秒） */
    timeElapsed: number;
    /** 当前策略 */
    strategy: LoopStrategy;
    /** 循环历史 */
    history: LoopIteration[];
    /** 是否完成 */
    done: boolean;
    /** 完成原因 */
    doneReason?: string;
}
/**
 * 循环迭代记录
 */
export interface LoopIteration {
    /** 迭代序号 */
    iteration: number;
    /** 策略 */
    strategy: LoopStrategy;
    /** 执行的行动 */
    action: any;
    /** 结果 */
    result: any;
    /** 质量评分 */
    quality: number;
    /** Token 消耗 */
    tokensUsed: number;
    /** 时间消耗（毫秒） */
    timeElapsed: number;
    /** 时间戳 */
    timestamp: string;
}
/**
 * 循环结果
 */
export interface LoopResult {
    /** 最终结果 */
    result: any;
    /** 最终质量 */
    quality: number;
    /** 总迭代次数 */
    iterations: number;
    /** 总 Token 消耗 */
    tokensUsed: number;
    /** 总时间消耗（毫秒） */
    duration: number;
    /** 使用的策略序列 */
    strategies: LoopStrategy[];
    /** 是否成功 */
    success: boolean;
    /** 循环状态 */
    state: LoopState;
}
/**
 * 质量评估结果
 */
export interface QualityAssessment {
    /** 质量分数（0-1） */
    score: number;
    /** 问题列表 */
    issues: QualityIssue[];
    /** 改进建议 */
    improvements: Improvement[];
}
/**
 * 质量问题
 */
export interface QualityIssue {
    /** 问题类型 */
    type: string;
    /** 严重程度 */
    severity: 'low' | 'medium' | 'high' | 'critical';
    /** 问题描述 */
    description: string;
    /** 位置信息 */
    location?: string;
}
/**
 * 改进建议
 */
export interface Improvement {
    /** 改进类型 */
    type: string;
    /** 优先级 */
    priority: 'low' | 'medium' | 'high';
    /** 改进描述 */
    description: string;
    /** 预期提升 */
    expectedImprovement: number;
    /** 实施成本 */
    implementationCost: number;
}
/**
 * 成本优化选项
 */
export interface CostOption {
    /** 选项名称 */
    name: string;
    /** 预期质量 */
    quality: number;
    /** 预期成本 */
    cost: number;
    /** 预期时间 */
    time: number;
    /** 性价比 */
    value: number;
}
/**
 * 优化计划
 */
export interface OptimizationPlan {
    /** 选定的策略 */
    strategy: LoopStrategy;
    /** 预期结果 */
    expectedOutcome: {
        quality: number;
        cost: number;
        time: number;
    };
    /** 执行步骤 */
    steps: OptimizationStep[];
}
/**
 * 优化步骤
 */
export interface OptimizationStep {
    /** 步骤类型 */
    type: 'assess' | 'improve' | 'verify' | 'finalize';
    /** 描述 */
    description: string;
    /** 预期成本 */
    estimatedCost: number;
    /** 预期时间 */
    estimatedTime: number;
}
//# sourceMappingURL=types.d.ts.map