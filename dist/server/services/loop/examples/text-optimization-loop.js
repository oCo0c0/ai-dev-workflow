"use strict";
/**
 * @file Text Optimization Loop Example
 * @description 展示如何使用循环系统优化文本质量
 *
 * 这个示例展示如何使用不同的循环策略来优化文本：
 * 1. 自适应循环 - 动态调整策略
 * 2. 质量循环 - 持续改进质量
 * 3. 成本优化 - 在预算内最大化质量
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.adaptiveLoopExample = adaptiveLoopExample;
exports.qualityLoopExample = qualityLoopExample;
exports.costOptimizationExample = costOptimizationExample;
exports.autoStrategyExample = autoStrategyExample;
exports.runAllLoopExamples = runAllLoopExamples;
const loop_service_js_1 = require("../loop-service.js");
/**
 * 文本优化器
 */
class TextOptimizer {
    /**
     * 评估文本质量
     */
    async evaluateQuality(text) {
        if (!text || text.length === 0)
            return 0;
        let score = 0.5;
        // 长度评分
        if (text.length >= 50)
            score += 0.1;
        if (text.length >= 100)
            score += 0.1;
        // 结构评分
        if (text.includes('\n'))
            score += 0.1;
        if (text.match(/^.+:/m))
            score += 0.1;
        // 内容质量
        if (text.split(' ').length >= 20)
            score += 0.1;
        if (!text.includes('  '))
            score += 0.1;
        return Math.min(score, 1.0);
    }
    /**
     * 生成改进建议
     */
    generateImprovements(text, currentQuality) {
        const improvements = [];
        if (text.length < 50) {
            improvements.push({
                type: 'expand',
                priority: 'high',
                description: 'Expand text with more details',
                expectedImprovement: 0.2,
                implementationCost: 1000
            });
        }
        if (!text.includes('\n')) {
            improvements.push({
                type: 'structure',
                priority: 'medium',
                description: 'Add structure with paragraphs',
                expectedImprovement: 0.15,
                implementationCost: 500
            });
        }
        if (text.includes('  ')) {
            improvements.push({
                type: 'cleanup',
                priority: 'medium',
                description: 'Clean up extra spaces',
                expectedImprovement: 0.1,
                implementationCost: 300
            });
        }
        if (currentQuality < 0.8) {
            improvements.push({
                type: 'enhance',
                priority: 'high',
                description: 'Enhance content quality',
                expectedImprovement: 0.3,
                implementationCost: 2000
            });
        }
        return improvements;
    }
    /**
     * 应用改进
     */
    applyImprovements(text, improvements) {
        let result = text;
        for (const improvement of improvements) {
            switch (improvement.type) {
                case 'expand':
                    result += '\n\nAdditional details and context would be added here to enhance the content.';
                    break;
                case 'structure':
                    result = `Introduction:\n${result}\n\nConclusion:\nSummary of the content.`;
                    break;
                case 'cleanup':
                    result = result.replace(/  +/g, ' ').trim();
                    break;
                case 'enhance':
                    result = `Enhanced version:\n\n${result}\n\nKey improvements made to clarify and strengthen the content.`;
                    break;
            }
        }
        return result;
    }
    /**
     * 估算操作成本
     */
    estimateCost(operation) {
        const costs = {
            'quick-prototype': 1000,
            'quality-optimization': 3000,
            'fine-polishing': 8000,
            'cost-effective': 2000
        };
        return costs[operation] || 2000;
    }
}
/**
 * 示例 1：自适应循环
 */
async function adaptiveLoopExample() {
    console.log('\n=== Example 1: Adaptive Loop ===\n');
    const optimizer = new TextOptimizer();
    const loopService = (0, loop_service_js_1.createLoopService)();
    const config = {
        targetQuality: 0.8,
        tokenBudget: 10000,
        maxIterations: 10,
        adaptive: true,
        qualityEvaluator: async (result) => await optimizer.evaluateQuality(result),
        costEstimator: (action) => optimizer.estimateCost(action)
    };
    let currentText = 'This is a simple text. It needs improvement.';
    const result = await loopService.executeAdaptiveLoop(config, async (strategy, state) => {
        console.log(`  Iteration ${state.iteration}: Strategy=${strategy}, Quality=${state.quality.toFixed(2)}`);
        // 根据策略执行优化
        if (strategy === 'quick-prototype') {
            currentText += ' Some quick additions.';
        }
        else if (strategy === 'quality-optimization') {
            currentText = await optimizer.applyImprovements(currentText, [
                {
                    type: 'structure',
                    priority: 'medium',
                    description: '',
                    expectedImprovement: 0.1,
                    implementationCost: 500
                }
            ]);
        }
        else if (strategy === 'fine-polishing') {
            currentText = currentText.trim();
        }
        return currentText;
    });
    console.log('\nResult:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Quality: ${result.quality.toFixed(2)}`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log(`  Tokens Used: ${result.tokensUsed}`);
    console.log(`  Duration: ${result.duration}ms`);
    console.log(`  Final Text: ${result.result}`);
}
/**
 * 示例 2：质量循环
 */
async function qualityLoopExample() {
    console.log('\n=== Example 2: Quality Loop ===\n');
    const optimizer = new TextOptimizer();
    const loopService = (0, loop_service_js_1.createLoopService)();
    const config = {
        targetQuality: 0.9,
        tokenBudget: 15000,
        maxIterations: 15,
        qualityEvaluator: async (result) => await optimizer.evaluateQuality(result)
    };
    let currentText = 'Short text.';
    const result = await loopService.executeQualityLoop(config, async (improvements) => {
        console.log(`  Applying ${improvements.length} improvements:`);
        for (const imp of improvements) {
            console.log(`    - [${imp.priority}] ${imp.description} (+${(imp.expectedImprovement * 100).toFixed(1)}%)`);
        }
        currentText = optimizer.applyImprovements(currentText, improvements);
        return currentText;
    });
    console.log('\nResult:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Quality: ${result.quality.toFixed(2)}`);
    console.log(`  Iterations: ${result.iterations}`);
    console.log(`  Tokens Used: ${result.tokensUsed}`);
    console.log(`  Final Text: ${result.result}`);
}
/**
 * 示例 3：成本优化
 */
async function costOptimizationExample() {
    console.log('\n=== Example 3: Cost Optimization ===\n');
    const optimizer = new TextOptimizer();
    const loopService = (0, loop_service_js_1.createLoopService)();
    const config = {
        targetQuality: 0.75,
        tokenBudget: 5000
    };
    const result = await loopService.executeCostOptimization(config, async (plan) => {
        console.log(`  Executing plan: ${plan.strategy}`);
        console.log(`  Steps: ${plan.steps.length}`);
        console.log(`  Expected quality: ${plan.expectedOutcome.quality.toFixed(2)}`);
        console.log(`  Estimated cost: ${plan.expectedOutcome.cost} tokens`);
        let text = 'Basic text content.';
        // 执行计划步骤
        for (const step of plan.steps) {
            console.log(`    - ${step.type}: ${step.description}`);
            if (step.type === 'improve') {
                text = await optimizer.applyImprovements(text, [
                    {
                        type: 'enhance',
                        priority: 'medium',
                        description: '',
                        expectedImprovement: 0.1,
                        implementationCost: 1000
                    }
                ]);
            }
        }
        return text;
    });
    console.log('\nResult:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Quality: ${result.quality.toFixed(2)}`);
    console.log(`  Tokens Used: ${result.tokensUsed}`);
    console.log(`  Final Text: ${result.result}`);
    // 成本分析
    const analysis = loopService.costOptimizer.analyzeCosts(config.tokenBudget, result.tokensUsed, result.quality, config.targetQuality);
    console.log('\nCost Analysis:');
    console.log(`  Efficiency: ${analysis.efficiency.toFixed(2)}`);
    console.log(`  Remaining: ${analysis.remaining} tokens`);
    console.log(`  Recommendation: ${analysis.recommendation}`);
}
/**
 * 示例 4：自动选择策略
 */
async function autoStrategyExample() {
    console.log('\n=== Example 4: Auto Strategy Selection ===\n');
    const loopService = (0, loop_service_js_1.createLoopService)();
    // 高质量要求 - 自动选择质量循环
    console.log('High quality requirement (0.9):');
    const highQualityResult = await loopService.executeOptimalLoop({ targetQuality: 0.9, tokenBudget: 10000 }, async (_input) => {
        return 'High quality text result.';
    });
    console.log(`  Selected approach achieved quality: ${highQualityResult.quality.toFixed(2)}\n`);
    // 低预算 - 自动选择成本优化
    console.log('Low budget (3000 tokens):');
    const lowBudgetResult = await loopService.executeOptimalLoop({ targetQuality: 0.7, tokenBudget: 3000 }, async (_input) => {
        return 'Cost-optimized text result.';
    });
    console.log(`  Selected approach achieved quality: ${lowBudgetResult.quality.toFixed(2)}\n`);
    // 平衡要求 - 自动选择自适应循环
    console.log('Balanced requirements (0.8 quality, 10000 tokens):');
    const balancedResult = await loopService.executeOptimalLoop({ targetQuality: 0.8, tokenBudget: 10000 }, async (_input) => {
        return 'Balanced text result.';
    });
    console.log(`  Selected approach achieved quality: ${balancedResult.quality.toFixed(2)}`);
}
/**
 * 运行所有示例
 */
async function runAllLoopExamples() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║        Loop Engineering Framework Examples                  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    try {
        await adaptiveLoopExample();
        await qualityLoopExample();
        await costOptimizationExample();
        await autoStrategyExample();
        console.log('\n✅ All examples completed successfully!');
    }
    catch (error) {
        console.error('\n❌ Example failed:', error);
    }
}
// 如果直接运行此文件，执行示例
if (require.main === module) {
    runAllLoopExamples().catch(console.error);
}
//# sourceMappingURL=text-optimization-loop.js.map