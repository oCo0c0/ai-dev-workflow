/**
 * @file Cost Optimizer
 * @description 成本优化系统 - 在预算约束下最大化结果质量
 *
 * 核心功能：
 * 1. 成本估算 - 预估不同操作的成本
 * 2. 策略选择 - 选择最具成本效益的策略
 * 3. 预算管理 - 动态分配预算到不同阶段
 * 4. 价值最大化 - 在约束下最大化结果价值
 */
import { LoopConfig, LoopResult, OptimizationPlan } from './types.js';
/**
 * 成本优化器
 */
export declare class CostOptimizer {
    private optionGenerator;
    private planGenerator;
    constructor();
    /**
     * 执行成本优化
     */
    execute(config: LoopConfig, executor: (plan: OptimizationPlan) => Promise<any>): Promise<LoopResult>;
    /**
     * 选择最佳选项
     */
    private selectBestOption;
    /**
     * 估算最终质量
     */
    private estimateFinalQuality;
    /**
     * 获取成本分析
     */
    analyzeCosts(budget: number, actualCost: number, quality: number, targetQuality: number): {
        efficiency: number;
        remaining: number;
        costEffectiveness: number;
        recommendation: string;
    };
    /**
     * 优化预算分配
     */
    optimizeBudgetAllocation(totalBudget: number, stages: Array<{
        name: string;
        minQuality: number;
        importance: number;
    }>): Array<{
        stage: string;
        budget: number;
        percentage: number;
    }>;
}
/**
 * 创建成本优化器实例
 */
export declare function createCostOptimizer(): CostOptimizer;
//# sourceMappingURL=cost-optimizer.d.ts.map