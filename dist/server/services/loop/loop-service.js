"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCostOptimizer = exports.CostOptimizer = exports.createQualityLoop = exports.QualityLoop = exports.createAdaptiveLoop = exports.AdaptiveLoop = exports.LoopService = void 0;
exports.createLoopService = createLoopService;
exports.executeAdaptiveLoop = executeAdaptiveLoop;
exports.executeQualityLoop = executeQualityLoop;
exports.executeCostOptimization = executeCostOptimization;
const adaptive_loop_js_1 = require("./adaptive-loop.js");
const quality_loop_js_1 = require("./quality-loop.js");
const cost_optimizer_js_1 = require("./cost-optimizer.js");
/**
 * 循环系统全局实例
 */
class LoopSystem {
    static adaptiveLoop = null;
    static qualityLoop = null;
    static costOptimizer = null;
    /**
     * 获取或创建自适应循环实例
     */
    static getAdaptiveLoop() {
        if (!this.adaptiveLoop) {
            this.adaptiveLoop = (0, adaptive_loop_js_1.createAdaptiveLoop)();
        }
        return this.adaptiveLoop;
    }
    /**
     * 获取或创建质量循环实例
     */
    static getQualityLoop() {
        if (!this.qualityLoop) {
            this.qualityLoop = (0, quality_loop_js_1.createQualityLoop)();
        }
        return this.qualityLoop;
    }
    /**
     * 获取或创建成本优化器实例
     */
    static getCostOptimizer() {
        if (!this.costOptimizer) {
            this.costOptimizer = (0, cost_optimizer_js_1.createCostOptimizer)();
        }
        return this.costOptimizer;
    }
    /**
     * 重置所有实例
     */
    static reset() {
        this.adaptiveLoop = null;
        this.qualityLoop = null;
        this.costOptimizer = null;
    }
}
/**
 * 循环服务类 - 提供高级 API
 */
class LoopService {
    adaptiveLoop;
    qualityLoop;
    costOptimizer;
    constructor() {
        this.adaptiveLoop = LoopSystem.getAdaptiveLoop();
        this.qualityLoop = LoopSystem.getQualityLoop();
        this.costOptimizer = LoopSystem.getCostOptimizer();
    }
    /**
     * 执行自适应循环
     */
    async executeAdaptiveLoop(config, executor) {
        return await this.adaptiveLoop.execute(config, executor);
    }
    /**
     * 执行质量优化循环
     */
    async executeQualityLoop(config, executor) {
        return await this.qualityLoop.execute(config, executor);
    }
    /**
     * 执行成本优化
     */
    async executeCostOptimization(config, executor) {
        return await this.costOptimizer.execute(config, executor);
    }
    /**
     * 自动选择最佳循环策略
     */
    async executeOptimalLoop(config, executor) {
        // 根据配置选择最佳循环类型
        if (config.targetQuality && config.targetQuality >= 0.9) {
            // 高质量要求 - 使用质量循环
            console.log('[LoopService] Using Quality Loop for high quality requirement');
            return await this.executeQualityLoop(config, executor);
        }
        else if (config.tokenBudget && config.tokenBudget < 5000) {
            // 低预算 - 使用成本优化
            console.log('[LoopService] Using Cost Optimizer for low budget');
            return await this.executeCostOptimization(config, executor);
        }
        else {
            // 默认 - 使用自适应循环
            console.log('[LoopService] Using Adaptive Loop (default)');
            return await this.executeAdaptiveLoop(config, executor);
        }
    }
    /**
     * 批量执行循环
     */
    async executeLoops(executions) {
        const results = await Promise.all(executions.map(({ config, executor, type = 'auto' }) => {
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
        }));
        return results;
    }
    /**
     * 获取循环统计
     */
    getStats(type) {
        // 这里可以扩展统计功能
        return {
            type: type || 'all',
            available: ['adaptive', 'quality', 'cost']
        };
    }
}
exports.LoopService = LoopService;
/**
 * 创建循环服务实例
 */
function createLoopService() {
    return new LoopService();
}
/**
 * 便捷函数：执行自适应循环
 */
async function executeAdaptiveLoop(config, executor) {
    const service = createLoopService();
    return await service.executeAdaptiveLoop(config, executor);
}
/**
 * 便捷函数：执行质量循环
 */
async function executeQualityLoop(config, executor) {
    const service = createLoopService();
    return await service.executeQualityLoop(config, executor);
}
/**
 * 便捷函数：执行成本优化
 */
async function executeCostOptimization(config, executor) {
    const service = createLoopService();
    return await service.executeCostOptimization(config, executor);
}
// 导出所有类型和组件
__exportStar(require("./types.js"), exports);
var adaptive_loop_js_2 = require("./adaptive-loop.js");
Object.defineProperty(exports, "AdaptiveLoop", { enumerable: true, get: function () { return adaptive_loop_js_2.AdaptiveLoop; } });
Object.defineProperty(exports, "createAdaptiveLoop", { enumerable: true, get: function () { return adaptive_loop_js_2.createAdaptiveLoop; } });
var quality_loop_js_2 = require("./quality-loop.js");
Object.defineProperty(exports, "QualityLoop", { enumerable: true, get: function () { return quality_loop_js_2.QualityLoop; } });
Object.defineProperty(exports, "createQualityLoop", { enumerable: true, get: function () { return quality_loop_js_2.createQualityLoop; } });
var cost_optimizer_js_2 = require("./cost-optimizer.js");
Object.defineProperty(exports, "CostOptimizer", { enumerable: true, get: function () { return cost_optimizer_js_2.CostOptimizer; } });
Object.defineProperty(exports, "createCostOptimizer", { enumerable: true, get: function () { return cost_optimizer_js_2.createCostOptimizer; } });
//# sourceMappingURL=loop-service.js.map