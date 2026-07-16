/**
 * @file Agents Service
 * @description 专业 Agent 系统统一入口 - 管理和执行专业 Agent
 *
 * 功能：
 * 1. Agent 管理 - 注册和管理专业 Agent
 * 2. 任务执行 - 执行单个 Agent 任务
 * 3. 工作流执行 - 执行多 Agent 协作工作流
 * 4. 集成服务 - 与 Agent Harness 和 Loop System 集成
 */
import { AgentInput, AgentOutput, AgentWorkflowConfig, AgentWorkflowResult } from './types.js';
/**
 * Agent 管理服务
 */
export declare class AgentsService {
    private harness;
    constructor();
    /**
     * 执行 Agent 任务
     */
    executeAgent(input: AgentInput): Promise<AgentOutput>;
    /**
     * 执行 Agent 工作流
     */
    executeWorkflow(config: AgentWorkflowConfig): Promise<AgentWorkflowResult>;
    /**
     * 准备输入数据
     */
    private prepareInputData;
    /**
     * 更新输出数据
     */
    private updateOutputData;
    /**
     * 列出可用的Agent
     */
    listAgents(): Array<{
        id: string;
        name: string;
        description: string;
    }>;
    /**
     * 获取系统统计
     */
    getStats(): {
        availableAgents: string[];
        harnessStats: any;
    };
}
/**
 * 创建 Agent 服务实例
 */
export declare function createAgentsService(): AgentsService;
export { RequirementAnalysisAgent, createRequirementAnalysisAgent } from './requirement-analysis-agent.js';
export { CodeGenerationAgent, createCodeGenerationAgent } from './code-generation-agent.js';
export { TestAgent, createTestAgent } from './test-agent.js';
export { CodeReviewAgent, createCodeReviewAgent } from './code-review-agent.js';
export * from './types.js';
//# sourceMappingURL=agents-service.d.ts.map