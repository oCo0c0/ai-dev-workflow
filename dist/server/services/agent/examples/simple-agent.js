"use strict";
/**
 * @file Simple Agent Example
 * @description 示例 Agent 实现 - 展示如何使用 Agent Harness 框架
 *
 * 这个 Agent 模拟一个简单的文本处理任务：
 * 1. 接收文本输入
 * 2. 分析文本
 * 3. 执行转换操作
 * 4. 评估结果质量
 * 5. 迭代改进
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimpleTextAgent = void 0;
exports.runSimpleTextAgentExample = runSimpleTextAgentExample;
/**
 * 简单文本处理 Agent
 */
class SimpleTextAgent {
    config = {
        id: 'simple-text-agent',
        name: 'Simple Text Agent',
        description: 'A simple agent for text processing tasks',
        tools: [
            {
                name: 'analyze',
                description: 'Analyze text quality and characteristics',
                parameters: {
                    text: { type: 'string', description: 'Text to analyze' }
                },
                retryable: true,
                timeout: 5000
            },
            {
                name: 'transform',
                description: 'Transform text to improve quality',
                parameters: {
                    text: { type: 'string', description: 'Text to transform' },
                    operation: { type: 'string', description: 'Transformation operation' }
                },
                retryable: true,
                timeout: 10000
            }
        ],
        maxExecutionTime: 60000,
        maxRetries: 3
    };
    /**
     * Think：分析当前状态并决定下一步
     */
    async think(context) {
        const { state, task } = context;
        const currentText = state.history[state.history.length - 1]?.result.data || task.input.text;
        // 分析当前文本质量
        const quality = this.assessQuality(currentText);
        // 决定下一步行动
        let nextAction;
        if (quality < 0.7 && state.iteration < 5) {
            // 质量不够，需要改进
            nextAction = {
                type: 'transform',
                tool: 'transform',
                parameters: {
                    text: currentText,
                    operation: this.selectImprovementOperation(currentText)
                }
            };
        }
        else {
            // 质量达标或达到最大迭代次数，完成
            nextAction = {
                type: 'complete',
                parameters: {}
            };
        }
        return {
            content: `Current text quality: ${quality.toFixed(2)}. ${nextAction.type === 'transform' ? 'Needs improvement.' : 'Task complete.'}`,
            nextAction,
            confidence: 0.8
        };
    }
    /**
     * Act：执行行动
     */
    async act(context, action) {
        if (action.type === 'complete') {
            return { success: true, data: context.state.history[context.state.history.length - 1]?.result.data };
        }
        if (action.tool === 'transform') {
            const { text, operation } = action.parameters;
            return await this.transformText(text, operation);
        }
        throw new Error(`Unknown action type: ${action.type}`);
    }
    /**
     * Observe：观察行动结果
     */
    async observe(context, result) {
        if (!result.success) {
            return {
                result,
                quality: 0,
                needsImprovement: true
            };
        }
        const text = result.data;
        const quality = this.assessQuality(text);
        const needsImprovement = quality < (context.task.targetQuality || 0.8);
        return {
            result,
            quality,
            needsImprovement
        };
    }
    /**
     * Reflect：反思并生成改进建议
     */
    async reflect(_context, observation) {
        const improvements = [];
        if (observation.needsImprovement) {
            improvements.push({
                type: 'quality_improvement',
                priority: 'high',
                description: 'Text quality needs improvement',
                action: {
                    type: 'transform',
                    tool: 'transform',
                    parameters: {
                        operation: 'enhance'
                    }
                }
            });
        }
        if (observation.quality > 0.9) {
            improvements.push({
                type: 'optimization',
                priority: 'low',
                description: 'Text quality is excellent, minor optimizations possible',
                action: {
                    type: 'optimize',
                    parameters: {}
                }
            });
        }
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Reflection: Quality ${observation.quality.toFixed(2)}. ${improvements.length} improvements identified.`,
            improvements,
            quality: observation.quality
        };
    }
    /**
     * Decide：决策下一步行动
     */
    async decide(context) {
        const { state, task } = context;
        const currentText = state.history[state.history.length - 1]?.result.data || task.input.text;
        const quality = this.assessQuality(currentText);
        if (quality >= (task.targetQuality || 0.8) || state.iteration >= 5) {
            return {
                type: 'complete',
                parameters: {}
            };
        }
        return {
            type: 'transform',
            tool: 'transform',
            parameters: {
                text: currentText,
                operation: this.selectImprovementOperation(currentText)
            }
        };
    }
    /**
     * 获取工具处理函数
     */
    getToolHandler(toolName) {
        switch (toolName) {
            case 'analyze':
                return async (params) => {
                    return this.analyzeText(params.text);
                };
            case 'transform':
                return async (params) => {
                    return this.transformText(params.text, params.operation);
                };
            default:
                return undefined;
        }
    }
    /**
     * 评估文本质量
     */
    assessQuality(text) {
        if (!text || text.length === 0)
            return 0;
        let score = 0.5; // 基础分
        // 长度评分
        if (text.length >= 50)
            score += 0.1;
        if (text.length >= 100)
            score += 0.1;
        // 结构评分
        if (text.includes('\n'))
            score += 0.1;
        if (text.match(/^.+:/m))
            score += 0.1; // 有标题格式
        // 内容质量
        if (text.split(' ').length >= 20)
            score += 0.1;
        if (!text.includes('  '))
            score += 0.1; // 没有多余空格
        return Math.min(score, 1.0);
    }
    /**
     * 选择改进操作
     */
    selectImprovementOperation(text) {
        const quality = this.assessQuality(text);
        if (text.length < 50)
            return 'expand';
        if (!text.includes('\n'))
            return 'structure';
        if (text.includes('  '))
            return 'cleanup';
        if (quality < 0.7)
            return 'enhance';
        return 'polish';
    }
    /**
     * 分析文本
     */
    async analyzeText(text) {
        const quality = this.assessQuality(text);
        const issues = [];
        const suggestions = [];
        if (text.length < 50) {
            issues.push('Text is too short');
            suggestions.push('Add more detail and explanation');
        }
        if (!text.includes('\n')) {
            issues.push('Text lacks structure');
            suggestions.push('Add paragraphs and sections');
        }
        if (text.includes('  ')) {
            issues.push('Text contains extra spaces');
            suggestions.push('Clean up formatting');
        }
        return { quality, issues, suggestions };
    }
    /**
     * 转换文本
     */
    async transformText(text, operation) {
        const operations = {
            expand: (t) => t + '\n\nAdditional details and context would be added here.',
            structure: (t) => `Introduction:\n${t}\n\nConclusion:\nSummary of the content.`,
            cleanup: (t) => t.replace(/  +/g, ' ').trim(),
            enhance: (t) => `Enhanced version:\n\n${t}\n\nKey improvements made to clarify and strengthen the content.`,
            polish: (t) => t.trim()
        };
        const operationFunc = operations[operation];
        if (!operationFunc) {
            throw new Error(`Unknown operation: ${operation}`);
        }
        return operationFunc(text);
    }
}
exports.SimpleTextAgent = SimpleTextAgent;
/**
 * 使用示例
 */
async function runSimpleTextAgentExample() {
    const { createAgentService } = await Promise.resolve().then(() => __importStar(require('../agent-service.js')));
    // 创建服务
    const service = createAgentService();
    // 注册 Agent
    const agent = new SimpleTextAgent();
    service.registerAgent(agent);
    // 执行任务
    const result = await service.executeAgent('simple-text-agent', {
        id: 'example-task-1',
        type: 'text_processing',
        input: {
            text: 'This is a simple text. It needs improvement.'
        },
        targetQuality: 0.8,
        tokenBudget: 10000
    });
    console.log('=== Simple Text Agent Result ===');
    console.log(`Success: ${result.success}`);
    console.log(`Quality: ${result.quality.toFixed(2)}`);
    console.log(`Iterations: ${result.iterations}`);
    console.log(`Tokens Used: ${result.tokensUsed}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Final Text: ${result.data}`);
    // 获取统计
    const stats = service.getStats('simple-text-agent');
    console.log('\n=== Statistics ===');
    console.log(`Total Traces: ${stats.totalTraces}`);
    console.log(`Completed: ${stats.completedTraces}`);
    console.log(`Average Quality: ${stats.averageQuality.toFixed(2)}`);
}
// 如果直接运行此文件，执行示例
if (require.main === module) {
    runSimpleTextAgentExample().catch(console.error);
}
//# sourceMappingURL=simple-agent.js.map