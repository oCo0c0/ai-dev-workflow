"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CostOptimizer = void 0;
exports.createCostOptimizer = createCostOptimizer;
/**
 * 成本选项生成器
 */
class CostOptionGenerator {
    /**
     * 生成成本选项
     */
    generateOptions(task, budget) {
        return [
            {
                name: 'fast',
                quality: 0.6,
                cost: budget * 0.2,
                time: 1,
                value: this.calculateValue(0.6, budget * 0.2, 1)
            },
            {
                name: 'balanced',
                quality: 0.8,
                cost: budget * 0.5,
                time: 2,
                value: this.calculateValue(0.8, budget * 0.5, 2)
            },
            {
                name: 'thorough',
                quality: 0.95,
                cost: budget * 0.9,
                time: 4,
                value: this.calculateValue(0.95, budget * 0.9, 4)
            }
        ];
    }
    /**
     * 计算价值（性价比）
     */
    calculateValue(quality, cost, time) {
        return (quality * quality) / (cost * time); // 质量平方除以成本时间
    }
}
/**
 * 优化计划生成器
 */
class OptimizationPlanGenerator {
    /**
     * 生成优化计划
     */
    generatePlan(selectedOption, _currentQuality, // 预留参数，未来可根据当前质量定制优化计划
    remainingBudget) {
        const steps = [];
        // 第一步：评估
        steps.push({
            type: 'assess',
            description: 'Assess current state and quality',
            estimatedCost: 500,
            estimatedTime: 1000
        });
        // 根据选择生成步骤
        if (selectedOption.name === 'fast') {
            steps.push({
                type: 'improve',
                description: 'Quick improvements for basic quality',
                estimatedCost: remainingBudget * 0.6,
                estimatedTime: 2000
            });
        }
        else if (selectedOption.name === 'balanced') {
            steps.push({
                type: 'improve',
                description: 'Comprehensive quality improvements',
                estimatedCost: remainingBudget * 0.4,
                estimatedTime: 3000
            });
            steps.push({
                type: 'verify',
                description: 'Verify and refine improvements',
                estimatedCost: remainingBudget * 0.2,
                estimatedTime: 2000
            });
        }
        else if (selectedOption.name === 'thorough') {
            steps.push({
                type: 'improve',
                description: 'Deep quality improvements',
                estimatedCost: remainingBudget * 0.3,
                estimatedTime: 4000
            });
            steps.push({
                type: 'verify',
                description: 'Comprehensive verification',
                estimatedCost: remainingBudget * 0.2,
                estimatedTime: 3000
            });
            steps.push({
                type: 'finalize',
                description: 'Final polishing and optimization',
                estimatedCost: remainingBudget * 0.2,
                estimatedTime: 2000
            });
        }
        return {
            strategy: this.mapOptionToStrategy(selectedOption.name),
            expectedOutcome: {
                quality: selectedOption.quality,
                cost: selectedOption.cost,
                time: selectedOption.time * 1000
            },
            steps
        };
    }
    /**
     * 映射选项名称到策略
     */
    mapOptionToStrategy(optionName) {
        switch (optionName) {
            case 'fast':
                return 'quick-prototype';
            case 'balanced':
                return 'quality-optimization';
            case 'thorough':
                return 'fine-polishing';
            default:
                return 'cost-effective';
        }
    }
}
/**
 * 成本优化器
 */
class CostOptimizer {
    optionGenerator;
    planGenerator;
    constructor() {
        this.optionGenerator = new CostOptionGenerator();
        this.planGenerator = new OptimizationPlanGenerator();
    }
    /**
     * 执行成本优化
     */
    async execute(config, executor) {
        const startTime = Date.now();
        const budget = config.tokenBudget || 10000;
        const targetQuality = config.targetQuality || 0.8;
        // 生成选项
        const options = this.optionGenerator.generateOptions(config, budget);
        // 选择最佳选项
        const selectedOption = this.selectBestOption(options, targetQuality, budget);
        // 生成优化计划
        const plan = this.planGenerator.generatePlan(selectedOption, 0, budget - selectedOption.cost);
        // 执行计划
        const result = await executor(plan);
        // 估算最终质量
        const finalQuality = this.estimateFinalQuality(result, selectedOption.quality);
        return {
            result,
            quality: finalQuality,
            iterations: plan.steps.length,
            tokensUsed: selectedOption.cost,
            duration: Date.now() - startTime,
            strategies: [plan.strategy],
            success: finalQuality >= targetQuality * 0.9, // 允许 10% 误差
            state: {
                iteration: plan.steps.length,
                quality: finalQuality,
                tokensUsed: selectedOption.cost,
                timeElapsed: Date.now() - startTime,
                strategy: plan.strategy,
                history: [],
                done: true,
                doneReason: 'Cost optimization completed'
            }
        };
    }
    /**
     * 选择最佳选项
     */
    selectBestOption(options, targetQuality, budget) {
        // 过滤出预算内的选项
        const affordableOptions = options.filter(opt => opt.cost <= budget);
        if (affordableOptions.length === 0) {
            // 如果没有预算内的选项，选择最便宜的
            return options.reduce((min, opt) => opt.cost < min.cost ? opt : min);
        }
        // 如果有选项刚好满足质量要求，选择其中价值最高的
        const meetingQuality = affordableOptions.filter(opt => opt.quality >= targetQuality);
        if (meetingQuality.length > 0) {
            return meetingQuality.reduce((best, opt) => opt.value > best.value ? opt : best);
        }
        // 如果没有满足质量的选项，选择质量最高的可负担选项
        const maxQualityAffordable = affordableOptions.reduce((max, opt) => opt.quality > max.quality ? opt : max);
        // 如果最高质量仍远低于目标，考虑是否值得执行
        if (maxQualityAffordable.quality < targetQuality * 0.7) {
            console.warn(`[CostOptimizer] Budget insufficient for target quality ` +
                `(target: ${targetQuality}, max: ${maxQualityAffordable.quality})`);
        }
        return maxQualityAffordable;
    }
    /**
     * 估算最终质量
     */
    estimateFinalQuality(result, expectedQuality) {
        // 简单实现：基于结果是否成功调整预期质量
        if (result && result.success === false) {
            return expectedQuality * 0.5; // 失败则质量减半
        }
        if (result && result.error) {
            return expectedQuality * 0.7; // 有错误则质量降低
        }
        // 基础质量 + 随机波动（模拟真实评估）
        const variance = (Math.random() - 0.5) * 0.1;
        return Math.max(0, Math.min(1, expectedQuality + variance));
    }
    /**
     * 获取成本分析
     */
    analyzeCosts(budget, actualCost, quality, targetQuality) {
        const remaining = budget - actualCost;
        const efficiency = quality / (actualCost / budget); // 质量相对于预算使用的效率
        const costEffectiveness = quality / actualCost; // 质量/成本比
        let recommendation = '';
        if (quality >= targetQuality) {
            if (remaining > budget * 0.3) {
                recommendation = 'Target achieved with budget to spare - consider increasing quality targets';
            }
            else {
                recommendation = 'Target achieved within budget - good cost management';
            }
        }
        else {
            if (remaining > budget * 0.5) {
                recommendation = 'Target not met but budget available - could invest more in quality';
            }
            else {
                recommendation = 'Target not met and budget exhausted - consider increasing budget or adjusting targets';
            }
        }
        return {
            efficiency,
            remaining,
            costEffectiveness,
            recommendation
        };
    }
    /**
     * 优化预算分配
     */
    optimizeBudgetAllocation(totalBudget, stages) {
        // 计算总重要性
        const totalImportance = stages.reduce((sum, stage) => sum + stage.importance, 0);
        // 根据重要性分配预算
        return stages.map(stage => ({
            stage: stage.name,
            budget: (stage.importance / totalImportance) * totalBudget,
            percentage: (stage.importance / totalImportance) * 100
        }));
    }
}
exports.CostOptimizer = CostOptimizer;
/**
 * 创建成本优化器实例
 */
function createCostOptimizer() {
    return new CostOptimizer();
}
//# sourceMappingURL=cost-optimizer.js.map