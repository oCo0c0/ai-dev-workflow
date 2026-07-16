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
import { AgentImplementation } from '../agent';
import { ExecutionContext, Thought, Action, Result, Observation, Reflection } from '../agent';
/**
 * 测试 Agent 实现
 */
export declare class TestAgent implements AgentImplementation {
    config: {
        id: string;
        name: string;
        description: string;
        tools: ({
            name: string;
            description: string;
            parameters: {
                code: {
                    type: string;
                    description: string;
                };
                language: {
                    type: string;
                    description: string;
                };
                tests?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                tests: {
                    type: string;
                    description: string;
                };
                code?: undefined;
                language?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                code: {
                    type: string;
                    description: string;
                };
                tests: {
                    type: string;
                    description: string;
                };
                language?: undefined;
            };
            retryable: boolean;
            timeout: number;
        })[];
        maxExecutionTime: number;
        maxRetries: number;
    };
    think(context: ExecutionContext): Promise<Thought>;
    act(context: ExecutionContext, action: Action): Promise<unknown>;
    observe(context: ExecutionContext, result: Result): Promise<Observation>;
    reflect(context: ExecutionContext, observation: Observation): Promise<Reflection>;
    decide(context: ExecutionContext): Promise<Action>;
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    private generateTests;
    private generateTestCode;
    private generateIntegrationTest;
    private executeTests;
    private analyzeCoverage;
    private assessTestQuality;
    private compileFinalResult;
}
export declare function createTestAgent(): TestAgent;
//# sourceMappingURL=test-agent.d.ts.map