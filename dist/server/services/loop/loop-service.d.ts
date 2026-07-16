/**
 * @file Loop Service
 * @description 循环系统统一入口 - 提供完整的循环优化服务
 *
 * 功能：
 * 1. 统一 API - 提供简洁的循环执行接口
 * 2. 全局单例 - 管理全局唯一的循环实例
 * 3. 工厂函数 - 便捷创建各种循环组件
 * 4. 集成服务 - 与 Agent Harness 集成
 */
import { LoopConfig, LoopResult, LoopStrategy } from './types.js';
/**
 * 循环服务类 - 提供高级 API
 */
export declare class LoopService {
    private adaptiveLoop;
    private qualityLoop;
    private costOptimizer;
    constructor();
    /**
     * 执行自适应循环
     */
    executeAdaptiveLoop(config: LoopConfig, executor: (strategy: LoopStrategy, state: any) => Promise<any>): Promise<LoopResult>;
    /**
     * 执行质量优化循环
     */
    executeQualityLoop(config: LoopConfig, executor: (improvements: any[]) => Promise<any>): Promise<LoopResult>;
    /**
     * 执行成本优化
     */
    executeCostOptimization(config: LoopConfig, executor: (plan: any) => Promise<any>): Promise<LoopResult>;
    /**
     * 自动选择最佳循环策略
     */
    executeOptimalLoop(config: LoopConfig, executor: any): Promise<LoopResult>;
    /**
     * 批量执行循环
     */
    executeLoops(executions: Array<{
        config: LoopConfig;
        executor: any;
        type?: 'adaptive' | 'quality' | 'cost' | 'auto';
    }>): Promise<LoopResult[]>;
    /**
     * 获取循环统计
     */
    getStats(type?: 'adaptive' | 'quality' | 'cost'): any;
}
/**
 * 创建循环服务实例
 */
export declare function createLoopService(): LoopService;
/**
 * 便捷函数：执行自适应循环
 */
export declare function executeAdaptiveLoop(config: LoopConfig, executor: (strategy: LoopStrategy, state: any) => Promise<any>): Promise<LoopResult>;
/**
 * 便捷函数：执行质量循环
 */
export declare function executeQualityLoop(config: LoopConfig, executor: (improvements: any[]) => Promise<any>): Promise<LoopResult>;
/**
 * 便捷函数：执行成本优化
 */
export declare function executeCostOptimization(config: LoopConfig, executor: (plan: any) => Promise<any>): Promise<LoopResult>;
export * from './types.js';
export { AdaptiveLoop, createAdaptiveLoop } from './adaptive-loop.js';
export { QualityLoop, createQualityLoop } from './quality-loop.js';
export { CostOptimizer, createCostOptimizer } from './cost-optimizer.js';
//# sourceMappingURL=loop-service.d.ts.map