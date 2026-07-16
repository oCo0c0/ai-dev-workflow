"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdaptiveLoop = void 0;
exports.createAdaptiveLoop = createAdaptiveLoop;
/**
 * 策略选择器
 */
class StrategySelector {
    /**
     * 选择最优策略
     */
    selectStrategy(iteration, quality, budget, timeLimit) {
        // 时间紧张 - 使用快速原型策略
        if (timeLimit && iteration > 0 && this.shouldPrioritizeSpeed(iteration, timeLimit)) {
            return 'quick-prototype';
        }
        // 预算紧张 - 使用成本有效策略
        if (budget < 5000 && quality < 0.6) {
            return 'cost-effective';
        }
        // 根据迭代次数和质量选择策略
        if (iteration <= 2) {
            // 前 2 次迭代：快速原型
            return 'quick-prototype';
        }
        else if (iteration <= 5) {
            // 第 3-5 次迭代：质量优化
            if (quality < 0.7) {
                return 'quality-optimization';
            }
            else if (budget > 10000) {
                return 'fine-polishing';
            }
            else {
                return 'cost-effective';
            }
        }
        else {
            // 第 6+ 次迭代：精细打磨或成本控制
            if (budget > 5000 && quality < 0.9) {
                return 'fine-polishing';
            }
            else {
                return 'cost-effective';
            }
        }
    }
    /**
     * 判断是否应该优先速度
     */
    shouldPrioritizeSpeed(iteration, timeLimit) {
        // 如果时间已过半但质量还不够，优先速度
        const averageIterationTime = 5000; // 假设每次迭代 5 秒
        const estimatedRemaining = (iteration + 1) * averageIterationTime;
        return estimatedRemaining > timeLimit * 0.7;
    }
    /**
     * 计算策略价值
     */
    calculateStrategyValue(strategy, currentQuality, budget) {
        const strategyProfiles = {
            'quick-prototype': { quality: 0.6, cost: 2000, time: 1 },
            'quality-optimization': { quality: 0.8, cost: 5000, time: 2 },
            'fine-polishing': { quality: 0.95, cost: 15000, time: 3 },
            'cost-effective': { quality: 0.75, cost: 3000, time: 1.5 }
        };
        const profile = strategyProfiles[strategy];
        // 计算性价比 (质量提升 / 成本)
        const qualityGain = Math.max(0, profile.quality - currentQuality);
        const costRatio = budget / profile.cost;
        return qualityGain * costRatio / profile.time;
    }
}
/**
 * 循环执行器
 */
class LoopExecutor {
    /**
     * 执行一次迭代
     */
    async executeIteration(state, config, executor) {
        const startTime = Date.now();
        // 执行行动
        const result = await executor(state.strategy, state);
        // 估算成本
        const cost = config.costEstimator ? config.costEstimator(result) : 1000;
        // 评估质量
        const quality = config.qualityEvaluator ? await config.qualityEvaluator(result) : 0.5;
        const iteration = {
            iteration: state.iteration,
            strategy: state.strategy,
            action: state.strategy,
            result,
            quality,
            tokensUsed: cost,
            timeElapsed: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };
        return iteration;
    }
    /**
     * 更新循环状态
     */
    updateState(state, iteration) {
        state.iteration = iteration.iteration + 1;
        state.quality = iteration.quality;
        state.tokensUsed += iteration.tokensUsed;
        state.timeElapsed += iteration.timeElapsed;
        state.history.push(iteration);
    }
}
/**
 * 自适应循环系统
 */
class AdaptiveLoop {
    selector;
    executor;
    constructor() {
        this.selector = new StrategySelector();
        this.executor = new LoopExecutor();
    }
    /**
     * 执行自适应循环
     */
    async execute(config, executor) {
        // 初始化状态
        const state = {
            iteration: 0,
            quality: 0,
            tokensUsed: 0,
            timeElapsed: 0,
            strategy: 'quick-prototype',
            history: [],
            done: false
        };
        const startTime = Date.now();
        const strategies = [];
        let finalResult = null;
        // 执行循环
        while (!state.done && state.iteration < (config.maxIterations || 10)) {
            // 选择策略
            state.strategy = this.selector.selectStrategy(state.iteration, state.quality, (config.tokenBudget || 10000) - state.tokensUsed, config.timeLimit ? config.timeLimit - state.timeElapsed : undefined);
            strategies.push(state.strategy);
            try {
                // 执行迭代
                const iteration = await this.executor.executeIteration(state, config, executor);
                finalResult = iteration.result;
                // 更新状态
                this.executor.updateState(state, iteration);
                // 检查终止条件
                this.checkTerminationConditions(state, config);
            }
            catch (error) {
                console.error(`[AdaptiveLoop] Iteration ${state.iteration} failed:`, error);
                state.done = true;
                state.doneReason = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            }
        }
        // 构建结果
        return this.buildResult(finalResult, state, strategies, startTime);
    }
    /**
     * 检查终止条件
     */
    checkTerminationConditions(state, config) {
        // 质量达标
        if (state.quality >= (config.targetQuality || 0.8)) {
            state.done = true;
            state.doneReason = `Target quality reached: ${state.quality.toFixed(2)}`;
            return;
        }
        // Token 预算耗尽
        if (config.tokenBudget && state.tokensUsed >= config.tokenBudget) {
            state.done = true;
            state.doneReason = `Token budget exhausted: ${state.tokensUsed}/${config.tokenBudget}`;
            return;
        }
        // 时间限制到达
        if (config.timeLimit && state.timeElapsed >= config.timeLimit) {
            state.done = true;
            state.doneReason = `Time limit reached: ${state.timeElapsed}/${config.timeLimit}ms`;
            return;
        }
        // 最大迭代次数
        if (state.iteration >= (config.maxIterations || 10)) {
            state.done = true;
            state.doneReason = `Max iterations reached: ${state.iteration}`;
        }
    }
    /**
     * 构建结果
     */
    buildResult(result, state, strategies, startTime) {
        const success = state.quality >= (state.done ? 0.5 : 0) && !state.doneReason?.includes('Error');
        return {
            result,
            quality: state.quality,
            iterations: state.iteration,
            tokensUsed: state.tokensUsed,
            duration: Date.now() - startTime,
            strategies,
            success,
            state: { ...state }
        };
    }
    /**
     * 获取策略统计
     */
    getStrategyStats(strategies) {
        const stats = {};
        const total = strategies.length;
        for (const strategy of strategies) {
            if (!stats[strategy]) {
                stats[strategy] = { count: 0, percentage: 0 };
            }
            stats[strategy].count++;
        }
        // 计算百分比
        for (const key of Object.keys(stats)) {
            stats[key].percentage = (stats[key].count / total) * 100;
        }
        return stats;
    }
}
exports.AdaptiveLoop = AdaptiveLoop;
/**
 * 创建自适应循环实例
 */
function createAdaptiveLoop() {
    return new AdaptiveLoop();
}
//# sourceMappingURL=adaptive-loop.js.map