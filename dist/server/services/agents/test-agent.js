"use strict";
/**
 * @file Test Agent
 * @description 测试 Agent - 生成、执行和优化测试用例
 *
 * 核心功能：
 * 1. 测试生成 - 根据代码生成测试用例
 * 2. 测试执行 - 运行测试并收集结果
 * 3. 覆盖率分析 - 分析代码覆盖率
 * 4. 质量优化 - 优化测试质量和覆盖率
 * 5. 测试报告 - 生成详细的测试报告
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestAgent = void 0;
exports.createTestAgent = createTestAgent;
/**
 * 测试 Agent 实现
 */
class TestAgent {
    config = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'Generate, execute and optimize test cases',
        tools: [
            {
                name: 'generate-tests',
                description: 'Generate test cases from code',
                parameters: {
                    code: { type: 'string', description: 'Code to test' },
                    language: { type: 'string', description: 'Programming language' }
                },
                retryable: true,
                timeout: 20000
            },
            {
                name: 'execute-tests',
                description: 'Execute test cases',
                parameters: {
                    tests: { type: 'array', description: 'Test cases to execute' }
                },
                retryable: true,
                timeout: 30000
            },
            {
                name: 'analyze-coverage',
                description: 'Analyze test coverage',
                parameters: {
                    code: { type: 'string', description: 'Source code' },
                    tests: { type: 'array', description: 'Test cases' }
                },
                retryable: true,
                timeout: 15000
            }
        ],
        maxExecutionTime: 120000,
        maxRetries: 3
    };
    async think(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                content: 'Starting test generation. Analyzing code structure.',
                nextAction: {
                    type: 'generate-tests',
                    tool: 'generate-tests',
                    parameters: {
                        code: task.input.code,
                        language: task.input.language || 'typescript'
                    }
                },
                confidence: 0.9
            };
        }
        if (iteration === 1) {
            return {
                content: 'Tests generated. Executing tests...',
                nextAction: {
                    type: 'execute-tests',
                    tool: 'execute-tests',
                    parameters: {
                        tests: state.history[0]?.result.data
                    }
                },
                confidence: 0.85
            };
        }
        if (iteration === 2) {
            return {
                content: 'Tests executed. Analyzing coverage...',
                nextAction: {
                    type: 'analyze-coverage',
                    tool: 'analyze-coverage',
                    parameters: {
                        code: task.input.code,
                        tests: state.history[0]?.result.data
                    }
                },
                confidence: 0.8
            };
        }
        return {
            content: 'Testing complete. Compiling final report.',
            nextAction: { type: 'complete', parameters: {} },
            confidence: 0.95
        };
    }
    async act(context, action) {
        switch (action.type) {
            case 'generate-tests':
                return await this.generateTests(action.parameters);
            case 'execute-tests':
                return await this.executeTests(action.parameters);
            case 'analyze-coverage':
                return await this.analyzeCoverage(action.parameters);
            case 'complete':
                return await this.compileFinalResult(context);
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }
    async observe(context, result) {
        if (!result.success) {
            return { result, quality: 0, needsImprovement: true };
        }
        const quality = this.assessTestQuality(result.data);
        const needsImprovement = quality < (context.task.targetQuality || 0.8);
        return { result, quality, needsImprovement };
    }
    async reflect(context, observation) {
        const improvements = [];
        if (observation.needsImprovement) {
            improvements.push({
                type: 'quality-improvement',
                priority: 'high',
                description: 'Test quality needs improvement',
                action: { type: 'improve', parameters: {} }
            });
        }
        const coverage = context.state.history[2]?.result.data;
        if (coverage && typeof coverage.statements === 'number' && coverage.statements < 80) {
            improvements.push({
                type: 'increase-coverage',
                priority: 'medium',
                description: 'Increase test coverage',
                action: { type: 'add-tests', parameters: {} }
            });
        }
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Test quality: ${observation.quality.toFixed(2)}. ${improvements.length} improvements identified.`,
            improvements,
            quality: observation.quality
        };
    }
    async decide(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                type: 'generate-tests',
                tool: 'generate-tests',
                parameters: { code: task.input.code, language: task.input.language }
            };
        }
        if (iteration === 1) {
            return {
                type: 'execute-tests',
                tool: 'execute-tests',
                parameters: { tests: state.history[0]?.result.data }
            };
        }
        if (iteration === 2) {
            return {
                type: 'analyze-coverage',
                tool: 'analyze-coverage',
                parameters: { code: task.input.code, tests: state.history[0]?.result.data }
            };
        }
        return { type: 'complete', parameters: {} };
    }
    getToolHandler(toolName) {
        switch (toolName) {
            case 'generate-tests':
                return (params) => this.generateTests(params);
            case 'execute-tests':
                return (params) => this.executeTests(params);
            case 'analyze-coverage':
                return (params) => this.analyzeCoverage(params);
            default:
                return undefined;
        }
    }
    async generateTests(params) {
        const { code, language = 'typescript' } = params;
        const tests = [];
        // 分析代码结构
        const className = code.match(/class\s+(\w+)/)?.[1] || 'Handler';
        const methods = code.match(/(?:public|private|protected)?\s+async?\s+(\w+)\s*\(/g) || [];
        // 为每个方法生成测试
        for (const method of methods) {
            const methodName = method.match(/(\w+)\s*\(/)?.[1] || 'unknown';
            tests.push({
                name: `should handle ${methodName} correctly`,
                description: `Test ${methodName} method functionality`,
                type: 'unit',
                framework: language === 'typescript' ? 'jest' : 'pytest',
                code: this.generateTestCode(className, methodName, language)
            });
        }
        // 添加集成测试
        tests.push({
            name: 'should handle integration scenarios',
            description: 'Integration test for full workflow',
            type: 'integration',
            framework: language === 'typescript' ? 'jest' : 'pytest',
            code: this.generateIntegrationTest(className, language)
        });
        return tests;
    }
    generateTestCode(className, methodName, language) {
        if (language === 'typescript') {
            return `it('should handle ${methodName} correctly', async () => {
    const instance = new ${className}();
    const input = { testData: 'value' };
    const result = await instance.${methodName}(input);
    expect(result).toBeDefined();
});`;
        }
        return `async def test_${methodName}_correctly():
    instance = ${className}()
    input = {'test_data': 'value'}
    result = await instance.${methodName}(input)
    assert result is not None`;
    }
    generateIntegrationTest(className, language) {
        if (language === 'typescript') {
            return `describe('integration tests', () => {
    it('should handle full workflow', async () => {
        const handler = new ${className}();
        const result = await handler.process({input: 'data'});
        expect(result.success).toBe(true);
    });
});`;
        }
        return `def test_full_workflow():
    handler = ${className}()
    result = await handler.process({'input': 'data'})
    assert result['success'] is True`;
    }
    async executeTests(params) {
        const results = [];
        for (const test of params.tests) {
            // 模拟测试执行
            const passed = Math.random() > 0.2; // 80% 通过率
            const duration = Math.floor(Math.random() * 1000) + 100;
            results.push({
                name: test.name,
                passed,
                duration,
                error: passed ? undefined : 'Assertion failed: Expected true but got false'
            });
        }
        return results;
    }
    async analyzeCoverage(params) {
        const { code, tests } = params;
        // 简化的覆盖率计算
        const lines = code.split('\n').length;
        const testLines = tests.reduce((sum, test) => sum + (test.code?.split('\n').length || 0), 0);
        const coverageRatio = Math.min(testLines / (lines * 2), 0.95);
        return {
            statements: Math.round(coverageRatio * 100),
            branches: Math.round(coverageRatio * 0.85 * 100),
            functions: Math.round(coverageRatio * 0.9 * 100),
            lines: Math.round(coverageRatio * 100)
        };
    }
    assessTestQuality(data) {
        if (!data || !Array.isArray(data))
            return 0;
        let score = 0.5;
        const passedCount = data.filter((t) => t.passed).length;
        const totalCount = data.length;
        if (totalCount > 0) {
            score += (passedCount / totalCount) * 0.3;
        }
        if (totalCount >= 5)
            score += 0.1;
        if (totalCount >= 10)
            score += 0.1;
        return Math.min(score, 1.0);
    }
    async compileFinalResult(context) {
        const { task, state } = context;
        const tests = state.history[1]?.result.data || [];
        const coverage = state.history[2]?.result.data || {};
        const passed = tests.filter((t) => t.passed).length;
        const failed = tests.filter((t) => !t.passed).length;
        const failures = tests
            .filter((t) => !t.passed)
            .map((t) => ({
            test: t.name,
            error: t.error || 'Test failed',
            stack: 'Error: Test failed\n    at test (test.ts:10:15)'
        }));
        return {
            suiteName: task.input.suiteName || 'Generated Test Suite',
            testCases: tests,
            coverage: {
                statements: coverage.statements || 0,
                branches: coverage.branches || 0,
                functions: coverage.functions || 0,
                lines: coverage.lines || 0
            },
            stats: {
                total: tests.length,
                passed,
                failed,
                skipped: 0
            },
            failures
        };
    }
}
exports.TestAgent = TestAgent;
function createTestAgent() {
    return new TestAgent();
}
//# sourceMappingURL=test-agent.js.map