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

import {Task} from '../agent';
import {AgentImplementation} from '../agent';
import {createAgentHarness, AgentHarness} from '../agent';
import {
    AgentInput,
    AgentOutput,
    AgentWorkflowConfig,
    AgentWorkflowResult,
    ProfessionalAgentType,
    RequirementAnalysisResult,
    CodeGenerationResult,
    TestResult,
    CodeReviewResult
} from './types.js';
import {createRequirementAnalysisAgent} from './requirement-analysis-agent.js';
import {createCodeGenerationAgent} from './code-generation-agent.js';
import {createTestAgent} from './test-agent.js';
import {createCodeReviewAgent} from './code-review-agent.js';
import {createDocumentationAgent} from './documentation-agent.js';

/**
 * Agent 系统全局实例
 */
class AgentSystem {
    private static harness: AgentHarness | null = null;
    private static agents: Map<ProfessionalAgentType, AgentImplementation> = new Map();

    /**
     * 获取或创建 Agent Harness
     */
    static getHarness(): AgentHarness {
        if (!this.harness) {
            this.harness = createAgentHarness();
        }
        return this.harness;
    }

    /**
     * 获取或创建 Agent 实例
     */
    static getAgent(type: ProfessionalAgentType): AgentImplementation {
        if (!this.agents.has(type)) {
            let agent: AgentImplementation;

            switch (type) {
                case 'requirement-analysis':
                    agent = createRequirementAnalysisAgent();
                    break;
                case 'code-generation':
                    agent = createCodeGenerationAgent();
                    break;
                case 'test':
                    agent = createTestAgent();
                    break;
                case 'code-review':
                    agent = createCodeReviewAgent();
                    break;
                case 'documentation':
                    agent = createDocumentationAgent();
                    break;
                default:
                    throw new Error(`Unknown agent type: ${type}`);
            }

            this.agents.set(type, agent);
            this.getHarness().registerAgent(agent);
        }

        return this.agents.get(type)!;
    }

    /**
     * 重置系统
     */
    static reset(): void {
        this.harness = null;
        this.agents.clear();
    }
}

/**
 * Agent 管理服务
 */
export class AgentsService {
    private harness: AgentHarness;

    constructor() {
        this.harness = AgentSystem.getHarness();
    }

    /**
     * 执行 Agent 任务
     */
    async executeAgent(input: AgentInput): Promise<AgentOutput> {
        const startTime = Date.now();

        try {
            // 获取 Agent
            const agent = AgentSystem.getAgent(input.agentType);

            // 创建任务
            const task: Task = {
                id: input.taskId,
                type: input.agentType,
                input: input.inputData,
                targetQuality: input.options?.targetQuality as number || 0.8,
                tokenBudget: input.options?.tokenBudget as number || 10000,
                priority: input.options?.priority as any || 'medium'
            };

            // 执行 Agent
            const result = await this.harness.execute(agent.config.id, task);

            return {
                agentType: input.agentType,
                taskId: input.taskId,
                success: result.success,
                result: result.data as RequirementAnalysisResult | CodeGenerationResult | TestResult | CodeReviewResult | undefined,
                quality: result.quality,
                duration: result.duration,
                tokensUsed: result.tokensUsed
            };
        } catch (error) {
            return {
                agentType: input.agentType,
                taskId: input.taskId,
                success: false,
                duration: Date.now() - startTime,
                tokensUsed: 0,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * 执行 Agent 工作流
     */
    async executeWorkflow(config: AgentWorkflowConfig): Promise<AgentWorkflowResult> {
        const startTime = Date.now();
        const agentResults: AgentOutput[] = [];
        const errors: string[] = [];
        let currentData: any = {};

        // 按 order 排序 Agent
        const sortedAgents = [...config.agents].sort((a, b) => a.order - b.order);

        for (const agentConfig of sortedAgents) {
            try {
                // 准备输入
                const inputData = this.prepareInputData(agentConfig, currentData, config.globalConfig);

                // 执行 Agent
                const result = await this.executeAgent({
                    agentType: agentConfig.type,
                    taskId: `${config.workflowId}-${agentConfig.type}`,
                    inputData,
                    options: config.globalConfig
                });

                agentResults.push(result);

                // 如果 Agent 必须但失败，终止工作流
                if (agentConfig.required && !result.success) {
                    errors.push(`Required agent ${agentConfig.type} failed: ${result.error}`);
                    break;
                }

                // 更新数据用于下一个 Agent
                if (result.success && result.result) {
                    currentData = this.updateOutputData(agentConfig, result.result, currentData);
                }

            } catch (error) {
                const errorMsg = `Agent ${agentConfig.type} execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                errors.push(errorMsg);

                if (agentConfig.required) {
                    break;
                }
            }
        }

        const success = errors.length === 0;

        return {
            workflowId: config.workflowId,
            success,
            agentResults,
            totalDuration: Date.now() - startTime,
            totalTokensUsed: agentResults.reduce((sum, r) => sum + r.tokensUsed, 0),
            errors
        };
    }

    /**
     * 准备输入数据
     */
    private prepareInputData(
        agentConfig: any,
        currentData: any,
        _globalConfig?: any // 预留参数，未来用于全局配置传递
    ): any {
        let inputData = {...currentData};

        // 应用输入映射
        if (agentConfig.inputMapping) {
            inputData = {};
            for (const [key, sourceKey] of Object.entries(agentConfig.inputMapping)) {
                inputData[key] = currentData[sourceKey as string];
            }
        }

        return inputData;
    }

    /**
     * 更新输出数据
     */
    private updateOutputData(agentConfig: any, result: any, currentData: any): any {
        let updatedData = {...currentData};

        // 应用输出映射
        if (agentConfig.outputMapping) {
            for (const [key, value] of Object.entries(result)) {
                const mappedKey = agentConfig.outputMapping[value as string] || value;
                updatedData[mappedKey as string] = result[key as string];
            }
        } else {
            updatedData = {...updatedData, ...result};
        }

        return updatedData;
    }

    /**
     * 列出可用的Agent
     */
    listAgents(): Array<{ id: string; name: string; description: string }> {
        return [
            {id: 'requirement-analysis', name: '需求分析Agent', description: '分析需求文档，提取关键信息和变更点'},
            {id: 'code-generation', name: '代码生成Agent', description: '根据需求生成高质量代码'},
            {id: 'test', name: '测试Agent', description: '生成和执行测试用例'},
            {id: 'code-review', name: '代码审查Agent', description: '审查代码质量、安全性和最佳实践'},
            {id: 'documentation', name: '文档生成Agent', description: '生成技术文档和API文档'}
        ];
    }

    /**
     * 获取系统统计
     */
    getStats(): {
        availableAgents: string[];
        harnessStats: any;
    } {
        return {
            availableAgents: ['requirement-analysis', 'code-generation', 'test', 'code-review'],
            harnessStats: this.harness.getStats()
        };
    }
}

/**
 * 创建 Agent 服务实例
 */
export function createAgentsService(): AgentsService {
    return new AgentsService();
}

// 导出所有 Agent
export {RequirementAnalysisAgent, createRequirementAnalysisAgent} from './requirement-analysis-agent.js';
export {CodeGenerationAgent, createCodeGenerationAgent} from './code-generation-agent.js';
export {TestAgent, createTestAgent} from './test-agent.js';
export {CodeReviewAgent, createCodeReviewAgent} from './code-review-agent.js';

// 导出类型
export * from './types.js';
