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

import {LoopConfig, LoopResult, LoopStrategy} from './types.js';
import {AdaptiveLoop, createAdaptiveLoop} from './adaptive-loop.js';
import {QualityLoop, createQualityLoop} from './quality-loop.js';
import {CostOptimizer, createCostOptimizer} from './cost-optimizer.js';

/**
 * 循环系统全局实例
 */
class LoopSystem {
    private static adaptiveLoop: AdaptiveLoop | null = null;
    private static qualityLoop: QualityLoop | null = null;
    private static costOptimizer: CostOptimizer | null = null;

    /**
     * 获取或创建自适应循环实例
     */
    static getAdaptiveLoop(): AdaptiveLoop {
        if (!this.adaptiveLoop) {
            this.adaptiveLoop = createAdaptiveLoop();
        }
        return this.adaptiveLoop;
    }

    /**
     * 获取或创建质量循环实例
     */
    static getQualityLoop(): QualityLoop {
        if (!this.qualityLoop) {
            this.qualityLoop = createQualityLoop();
        }
        return this.qualityLoop;
    }

    /**
     * 获取或创建成本优化器实例
     */
    static getCostOptimizer(): CostOptimizer {
        if (!this.costOptimizer) {
            this.costOptimizer = createCostOptimizer();
        }
        return this.costOptimizer;
    }

    /**
     * 重置所有实例
     */
    static reset(): void {
        this.adaptiveLoop = null;
        this.qualityLoop = null;
        this.costOptimizer = null;
    }
}

/**
 * 循环服务类 - 提供高级 API
 */
export class LoopService {
    private adaptiveLoop: AdaptiveLoop;
    private qualityLoop: QualityLoop;
    private costOptimizer: CostOptimizer;

    constructor() {
        this.adaptiveLoop = LoopSystem.getAdaptiveLoop();
        this.qualityLoop = LoopSystem.getQualityLoop();
        this.costOptimizer = LoopSystem.getCostOptimizer();
    }

    /**
     * 执行自适应循环
     */
    async executeAdaptiveLoop(
        config: LoopConfig,
        executor: (strategy: LoopStrategy, state: any) => Promise<any>
    ): Promise<LoopResult> {
        return await this.adaptiveLoop.execute(config, executor);
    }

    /**
     * 执行质量优化循环
     */
    async executeQualityLoop(
        config: LoopConfig,
        executor: (improvements: any[]) => Promise<any>
    ): Promise<LoopResult> {
        return await this.qualityLoop.execute(config, executor);
    }

    /**
     * 执行成本优化
     */
    async executeCostOptimization(
        config: LoopConfig,
        executor: (plan: any) => Promise<any>
    ): Promise<LoopResult> {
        return await this.costOptimizer.execute(config, executor);
    }

    /**
     * 自动选择最佳循环策略
     */
    async executeOptimalLoop(
        config: LoopConfig,
        executor: any
    ): Promise<LoopResult> {
        // 根据配置选择最佳循环类型
        if (config.targetQuality && config.targetQuality >= 0.9) {
            // 高质量要求 - 使用质量循环
            console.log('[LoopService] Using Quality Loop for high quality requirement');
            return await this.executeQualityLoop(config, executor);
        } else if (config.tokenBudget && config.tokenBudget < 5000) {
            // 低预算 - 使用成本优化
            console.log('[LoopService] Using Cost Optimizer for low budget');
            return await this.executeCostOptimization(config, executor);
        } else {
            // 默认 - 使用自适应循环
            console.log('[LoopService] Using Adaptive Loop (default)');
            return await this.executeAdaptiveLoop(config, executor);
        }
    }

    /**
     * 批量执行循环
     */
    async executeLoops(
        executions: Array<{
            config: LoopConfig;
            executor: any;
            type?: 'adaptive' | 'quality' | 'cost' | 'auto';
        }>
    ): Promise<LoopResult[]> {
        const results = await Promise.all(
            executions.map(({config, executor, type = 'auto'}) => {
                switch (type) {
                    case 'adaptive':
                        return this.executeAdaptiveLoop(config, executor);
                    case 'quality':
                        return this.executeQualityLoop(config, executor);
                    case 'cost':
                        return this.executeCostOptimization(config, executor);
                    case 'auto':
                    default:
                        return this.executeOptimalLoop(config, executor);
                }
            })
        );

        return results;
    }

    /**
     * 获取循环统计
     */
    getStats(type?: 'adaptive' | 'quality' | 'cost'): any {
        // 这里可以扩展统计功能
        return {
            type: type || 'all',
            available: ['adaptive', 'quality', 'cost']
        };
    }
}

/**
 * 创建循环服务实例
 */
export function createLoopService(): LoopService {
    return new LoopService();
}

/**
 * 便捷函数：执行自适应循环
 */
export async function executeAdaptiveLoop(
    config: LoopConfig,
    executor: (strategy: LoopStrategy, state: any) => Promise<any>
): Promise<LoopResult> {
    const service = createLoopService();
    return await service.executeAdaptiveLoop(config, executor);
}

/**
 * 便捷函数：执行质量循环
 */
export async function executeQualityLoop(
    config: LoopConfig,
    executor: (improvements: any[]) => Promise<any>
): Promise<LoopResult> {
    const service = createLoopService();
    return await service.executeQualityLoop(config, executor);
}

/**
 * 便捷函数：执行成本优化
 */
export async function executeCostOptimization(
    config: LoopConfig,
    executor: (plan: any) => Promise<any>
): Promise<LoopResult> {
    const service = createLoopService();
    return await service.executeCostOptimization(config, executor);
}

// 导出所有类型和组件
export * from './types.js';
export {AdaptiveLoop, createAdaptiveLoop} from './adaptive-loop.js';
export {QualityLoop, createQualityLoop} from './quality-loop.js';
export {CostOptimizer, createCostOptimizer} from './cost-optimizer.js';
