"use strict";
/**
 * @file Professional Agents Workflow Example
 * @description 展示专业 Agent 系统的完整工作流
 *
 * 这个示例展示如何使用专业 Agent 完成完整的开发流程：
 * 1. 需求分析
 * 2. 代码生成
 * 3. 测试
 * 4. 代码审查
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.singleAgentExample = singleAgentExample;
exports.workflowExample = workflowExample;
exports.qualityComparisonExample = qualityComparisonExample;
exports.costOptimizationExample = costOptimizationExample;
exports.errorHandlingExample = errorHandlingExample;
exports.runAllAgentExamples = runAllAgentExamples;
const agents_service_js_1 = require("../agents-service.js");
/**
 * 示例 1：单个 Agent 执行
 */
async function singleAgentExample() {
    console.log('\n=== Example 1: Single Agent Execution ===\n');
    const service = (0, agents_service_js_1.createAgentsService)();
    // 需求分析
    console.log('1. Requirement Analysis:');
    const analysisResult = await service.executeAgent({
        agentType: 'requirement-analysis',
        taskId: 'req-001',
        inputData: {
            requirement: 'Implement user authentication with JWT tokens and refresh token support',
            title: 'User Authentication System'
        },
        options: {
            targetQuality: 0.85,
            tokenBudget: 8000
        }
    });
    console.log(`  Success: ${analysisResult.success}`);
    console.log(`  Quality: ${analysisResult.quality?.toFixed(2)}`);
    console.log(`  Duration: ${analysisResult.duration}ms`);
    console.log(`  Tokens: ${analysisResult.tokensUsed}`);
    if (analysisResult.result) {
        const result = analysisResult.result;
        console.log(`  Complexity: ${result.analysis?.complexity}`);
        console.log(`  Estimated Hours: ${result.analysis?.estimatedHours}`);
        console.log(`  Ambiguities Found: ${result.ambiguities?.length}`);
    }
    // 代码生成
    console.log('\n2. Code Generation:');
    const codeResult = await service.executeAgent({
        agentType: 'code-generation',
        taskId: 'code-001',
        inputData: {
            requirement: 'Create a user authentication handler with JWT',
            language: 'typescript',
            filePath: 'src/auth/AuthHandler.ts'
        },
        options: {
            targetQuality: 0.9,
            tokenBudget: 15000
        }
    });
    console.log(`  Success: ${codeResult.success}`);
    console.log(`  Quality: ${codeResult.quality?.toFixed(2)}`);
    console.log(`  Duration: ${codeResult.duration}ms`);
    if (codeResult.result) {
        const result = codeResult.result;
        console.log(`  Code Length: ${result.code?.length} characters`);
        console.log(`  Tests Generated: ${result.tests?.length}`);
        console.log(`  Dependencies: ${result.dependencies?.length}`);
    }
}
/**
 * 示例 2：完整工作流执行
 */
async function workflowExample() {
    console.log('\n=== Example 2: Complete Workflow Execution ===\n');
    const service = (0, agents_service_js_1.createAgentsService)();
    // 配置完整开发工作流
    const workflowConfig = {
        workflowId: 'feature-auth',
        name: 'Authentication Feature Development',
        agents: [
            {
                type: 'requirement-analysis',
                order: 1,
                required: true,
                outputMapping: {
                    analysis: 'requirementAnalysis',
                    acceptanceCriteria: 'acceptanceCriteria'
                }
            },
            {
                type: 'code-generation',
                order: 2,
                required: true,
                inputMapping: {
                    requirement: 'acceptanceCriteria'
                },
                outputMapping: {
                    code: 'generatedCode',
                    tests: 'generatedTests'
                }
            },
            {
                type: 'test',
                order: 3,
                required: true,
                inputMapping: {
                    code: 'generatedCode'
                },
                outputMapping: {
                    coverage: 'testCoverage'
                }
            },
            {
                type: 'code-review',
                order: 4,
                required: false,
                inputMapping: {
                    code: 'generatedCode'
                },
                outputMapping: {
                    reviewScore: 'qualityScore'
                }
            }
        ],
        globalConfig: {
            targetQuality: 0.85,
            tokenBudget: 30000,
            requirement: 'Implement secure user authentication with JWT',
            language: 'typescript'
        }
    };
    // 执行工作流
    const workflowResult = await service.executeWorkflow(workflowConfig);
    console.log(`Workflow: ${workflowResult.workflowId}`);
    console.log(`Success: ${workflowResult.success}`);
    console.log(`Total Duration: ${workflowResult.totalDuration}ms`);
    console.log(`Total Tokens: ${workflowResult.totalTokensUsed}`);
    console.log('\nAgent Results:');
    for (const agentResult of workflowResult.agentResults) {
        console.log(`\n  ${agentResult.agentType}:`);
        console.log(`    Success: ${agentResult.success}`);
        console.log(`    Quality: ${agentResult.quality?.toFixed(2) || 'N/A'}`);
        console.log(`    Tokens: ${agentResult.tokensUsed}`);
        console.log(`    Duration: ${agentResult.duration}ms`);
    }
    if (workflowResult.errors.length > 0) {
        console.log('\nErrors:');
        for (const error of workflowResult.errors) {
            console.log(`  - ${error}`);
        }
    }
}
/**
 * 示例 3：对比不同质量目标
 */
async function qualityComparisonExample() {
    console.log('\n=== Example 3: Quality Target Comparison ===\n');
    const service = (0, agents_service_js_1.createAgentsService)();
    const qualityTargets = [0.7, 0.8, 0.9, 0.95];
    for (const target of qualityTargets) {
        console.log(`\nTarget Quality: ${target}`);
        const result = await service.executeAgent({
            agentType: 'code-generation',
            taskId: `code-target-${target}`,
            inputData: {
                requirement: 'Generate a user handler class',
                language: 'typescript'
            },
            options: {
                targetQuality: target,
                tokenBudget: Math.floor(target * 20000)
            }
        });
        console.log(`  Achieved: ${result.quality?.toFixed(2) || 'N/A'}`);
        console.log(`  Tokens: ${result.tokensUsed}`);
        console.log(`  Duration: ${result.duration}ms`);
        console.log(`  Efficiency: ${(result.tokensUsed / (result.duration / 1000)).toFixed(2)} tokens/ms`);
    }
}
/**
 * 示例 4：成本优化演示
 */
async function costOptimizationExample() {
    console.log('\n=== Example 4: Cost Optimization Demo ===\n');
    const service = (0, agents_service_js_1.createAgentsService)();
    const budgets = [3000, 5000, 10000, 20000];
    for (const budget of budgets) {
        console.log(`\nBudget: ${budget} tokens`);
        const result = await service.executeAgent({
            agentType: 'test',
            taskId: `test-budget-${budget}`,
            inputData: {
                code: 'class UserHandler { process() { return true; } }',
                language: 'typescript'
            },
            options: {
                targetQuality: 0.8,
                tokenBudget: budget
            }
        });
        console.log(`  Quality: ${result.quality?.toFixed(2) || 'N/A'}`);
        console.log(`  Tokens Used: ${result.tokensUsed}`);
        console.log(`  Budget Utilization: ${(result.tokensUsed / budget * 100).toFixed(1)}%`);
        console.log(`  Cost Efficiency: ${((result.quality || 0) / result.tokensUsed * 1000).toFixed(3)} quality/1k tokens`);
    }
}
/**
 * 示例 5：错误处理和恢复
 */
async function errorHandlingExample() {
    console.log('\n=== Example 5: Error Handling and Recovery ===\n');
    const service = (0, agents_service_js_1.createAgentsService)();
    // 模拟有问题的输入
    console.log('1. Invalid Input:');
    const invalidResult = await service.executeAgent({
        agentType: 'code-generation',
        taskId: 'invalid-001',
        inputData: {
            requirement: '', // 空需求
            language: 'typescript'
        },
        options: {
            targetQuality: 0.8,
            tokenBudget: 5000
        }
    });
    console.log(`  Success: ${invalidResult.success}`);
    console.log(`  Error: ${invalidResult.error || 'None'}`);
    // 工作流中的错误处理
    console.log('\n2. Workflow with Required Agent Failure:');
    const workflowWithFailure = {
        workflowId: 'test-failure',
        name: 'Test Failure Handling',
        agents: [
            {
                type: 'requirement-analysis',
                order: 1,
                required: true,
                outputMapping: { analysis: 'reqAnalysis' }
            },
            {
                type: 'code-generation',
                order: 2,
                required: true, // 必须，如果失败则终止
                inputMapping: { requirement: 'reqAnalysis' }
            },
            {
                type: 'test',
                order: 3,
                required: false // 可选，失败不影响工作流
            }
        ],
        globalConfig: {
            targetQuality: 0.8,
            tokenBudget: 15000,
            requirement: 'Valid requirement',
            language: 'typescript'
        }
    };
    const workflowResult = await service.executeWorkflow(workflowWithFailure);
    console.log(`  Workflow Success: ${workflowResult.success}`);
    console.log(`  Completed Agents: ${workflowResult.agentResults.length}`);
    console.log(`  Errors: ${workflowResult.errors.length}`);
}
/**
 * 运行所有示例
 */
async function runAllAgentExamples() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║        Professional Agents System Examples                      ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    try {
        await singleAgentExample();
        await workflowExample();
        await qualityComparisonExample();
        await costOptimizationExample();
        await errorHandlingExample();
        console.log('\n✅ All examples completed successfully!');
    }
    catch (error) {
        console.error('\n❌ Example failed:', error);
    }
}
// 如果直接运行此文件，执行示例
if (require.main === module) {
    runAllAgentExamples().catch(console.error);
}
//# sourceMappingURL=workflow-example.js.map