/**
 * @file Requirement Analysis Agent
 * @description 需求分析 Agent - 深度分析需求，识别歧义，生成验收标准
 *
 * 核心功能：
 * 1. 需求分析 - 识别需求类型、复杂度、优先级
 * 2. 歧义检测 - 发现需求中的不明确、矛盾、缺失之处
 * 3. 验收标准生成 - 基于需求生成可测试的验收标准
 * 4. 技术建议 - 提供实现方案和技术选型建议
 * 5. 工作量评估 - 估算开发时间和复杂度
 */
import { AgentImplementation } from '../agent';
import { ExecutionContext, Thought, Action, Result, Observation, Reflection } from '../agent';
/**
 * 需求分析 Agent 实现
 */
export declare class RequirementAnalysisAgent implements AgentImplementation {
    config: {
        id: string;
        name: string;
        description: string;
        tools: ({
            name: string;
            description: string;
            parameters: {
                requirement: {
                    type: string;
                    description: string;
                };
                text?: undefined;
                type?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                text: {
                    type: string;
                    description: string;
                };
                requirement?: undefined;
                type?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                requirement: {
                    type: string;
                    description: string;
                };
                type: {
                    type: string;
                    description: string;
                };
                text?: undefined;
            };
            retryable: boolean;
            timeout: number;
        })[];
        maxExecutionTime: number;
        maxRetries: number;
    };
    /**
     * Think：分析当前状态并决定下一步
     */
    think(context: ExecutionContext): Promise<Thought>;
    /**
     * Act：执行行动
     */
    act(context: ExecutionContext, action: Action): Promise<unknown>;
    /**
     * Observe：观察行动结果
     */
    observe(_context: ExecutionContext, result: Result): Promise<Observation>;
    /**
     * Reflect：反思并生成改进建议
     */
    reflect(context: ExecutionContext, observation: Observation): Promise<Reflection>;
    /**
     * Decide：决策下一步行动
     */
    decide(context: ExecutionContext): Promise<Action>;
    /**
     * 获取工具处理函数
     */
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    /**
     * 分析需求
     */
    private analyzeRequirement;
    /**
     * 检测歧义
     */
    private detectAmbiguities;
    /**
     * 生成验收标准
     */
    private generateAcceptanceCriteria;
    /**
     * 编译最终结果
     */
    private compileFinalResult;
    /**
     * 识别技术栈
     */
    private identifyTechnologies;
    /**
     * 识别风险
     */
    private identifyRisks;
    /**
     * 生成技术建议
     */
    private generateTechnicalSuggestions;
    /**
     * 识别依赖项
     */
    private identifyDependencies;
    /**
     * 评估结果质量
     */
    private assessResultQuality;
}
/**
 * 创建需求分析 Agent 实例
 */
export declare function createRequirementAnalysisAgent(): RequirementAnalysisAgent;
//# sourceMappingURL=requirement-analysis-agent.d.ts.map