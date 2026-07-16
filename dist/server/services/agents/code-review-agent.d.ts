/**
 * @file Code Review Agent
 * @description 代码审查 Agent - 审查代码质量、安全和最佳实践
 *
 * 核心功能：
 * 1. 代码审查 - 检查代码质量、安全性和最佳实践
 * 2. 问题检测 - 识别 bug、安全漏洞、性能问题
 * 3. 最佳实践验证 - 验证代码是否遵循最佳实践
 * 4. 改进建议 - 提供具体的改进建议
 * 5. 审查报告 - 生成详细的审查报告
 */
import { AgentImplementation } from '../agent';
import { ExecutionContext, Thought, Action, Result, Observation, Reflection } from '../agent';
/**
 * 代码审查 Agent 实现
 */
export declare class CodeReviewAgent implements AgentImplementation {
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
    reflect(_context: ExecutionContext, observation: Observation): Promise<Reflection>;
    decide(context: ExecutionContext): Promise<Action>;
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    private analyzeQuality;
    private checkSecurity;
    private verifyBestPractices;
    private assessReviewQuality;
    private compileFinalResult;
}
export declare function createCodeReviewAgent(): CodeReviewAgent;
//# sourceMappingURL=code-review-agent.d.ts.map