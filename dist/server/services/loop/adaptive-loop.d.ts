/**
 * @file Adaptive Loop
 * @description 自适应循环系统 - 根据执行情况动态调整策略
 *
 * 核心功能：
 * 1. 策略选择 - 根据迭代次数和质量选择最优策略
 * 2. 动态调整 - 实时调整策略以适应执行情况
 * 3. 成本控制 - 在预算内最大化质量
 * 4. 时间管理 - 在时间限制内完成任务
 */
import { LoopConfig, LoopState, LoopResult, LoopStrategy } from './types.js';
/**
 * 自适应循环系统
 */
export declare class AdaptiveLoop {
    private selector;
    private executor;
    constructor();
    /**
     * 执行自适应循环
     */
    execute(config: LoopConfig, executor: (strategy: LoopStrategy, state: LoopState) => Promise<any>): Promise<LoopResult>;
    /**
     * 检查终止条件
     */
    private checkTerminationConditions;
    /**
     * 构建结果
     */
    private buildResult;
    /**
     * 获取策略统计
     */
    getStrategyStats(strategies: LoopStrategy[]): {
        [strategy: string]: {
            count: number;
            percentage: number;
        };
    };
}
/**
 * 创建自适应循环实例
 */
export declare function createAdaptiveLoop(): AdaptiveLoop;
//# sourceMappingURL=adaptive-loop.d.ts.map