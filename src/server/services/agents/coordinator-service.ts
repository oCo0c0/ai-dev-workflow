/**
 * @file 协调服务（CoordinatorService）
 * @description 统一的Agent执行服务，Agent页面和流水线共用
 *
 * 功能：
 * 1. 提供统一的Agent执行接口
 * 2. 注册所有Agent能力
 * 3. 管理协调Agent的生命周期
 * 4. 支持向后兼容（保留原有的executeAgent接口）
 */

import { CoordinatorAgent, createCoordinatorAgent, CoordinatorResult } from './coordinator-agent.js';
import { AgentsService } from './agents-service.js';
import { getAgentRegistry } from './agent-capability.js';
import { AgentCapability } from './agent-capability.js';

/**
 * 协调服务
 */
export class CoordinatorService {
    private static instance: CoordinatorService;
    private coordinatorAgent: CoordinatorAgent;
    private agentsService: AgentsService;
    private initialized: boolean = false;

    private constructor() {
        this.agentsService = new AgentsService();
        this.coordinatorAgent = createCoordinatorAgent(this.agentsService);
    }

    static getInstance(): CoordinatorService {
        if (!CoordinatorService.instance) {
            CoordinatorService.instance = new CoordinatorService();
        }
        return CoordinatorService.instance;
    }

    /**
     * 初始化（注册所有Agent能力）
     */
    initialize(): void {
        if (this.initialized) {
            return;
        }

        // 注册所有Agent能力
        this.registerAgentCapabilities();

        this.initialized = true;
    }

    /**
     * 注册Agent能力
     */
    private registerAgentCapabilities(): void {
        const registry = getAgentRegistry();

        // 需求分析Agent
        registry.register({
            agentId: 'requirement-analysis',
            name: '需求分析专家',
            description: '分析需求文档，提取关键信息、明确功能需求、识别技术难点',
            canHandle: (task: string) => {
                const keywords = ['需求', '分析', '理解', '明确', 'requirement', 'analysis'];
                const hasKeyword = keywords.some(kw => task.toLowerCase().includes(kw));
                return hasKeyword ? 0.9 : 0.1;
            },
            priority: 10
        });

        // 代码生成Agent
        registry.register({
            agentId: 'code-generation',
            name: '代码生成专家',
            description: '根据需求生成高质量代码，遵循最佳实践和设计模式',
            canHandle: (task: string) => {
                const keywords = ['实现', '开发', '代码', '生成', '编写', 'implement', 'code', 'generate'];
                const hasKeyword = keywords.some(kw => task.toLowerCase().includes(kw));
                return hasKeyword ? 0.95 : 0.2;
            },
            priority: 9
        });

        // 测试Agent
        registry.register({
            agentId: 'test',
            name: '测试专家',
            description: '生成和执行测试用例，验证功能正确性',
            canHandle: (task: string) => {
                const keywords = ['测试', '验证', 'test', 'verify'];
                const hasKeyword = keywords.some(kw => task.toLowerCase().includes(kw));
                return hasKeyword ? 0.85 : 0.1;
            },
            priority: 8
        });

        // 代码审查Agent
        registry.register({
            agentId: 'code-review',
            name: '代码审查专家',
            description: '审查代码质量、安全性和最佳实践，提供改进建议',
            canHandle: (task: string) => {
                const keywords = ['审查', 'review', '优化', '质量'];
                const hasKeyword = keywords.some(kw => task.toLowerCase().includes(kw));
                return hasKeyword ? 0.8 : 0.1;
            },
            priority: 7
        });

        // 文档生成Agent
        registry.register({
            agentId: 'documentation',
            name: '文档生成专家',
            description: '生成技术文档、API文档和使用说明',
            canHandle: (task: string) => {
                const keywords = ['文档', '说明', '注释', 'documentation', 'doc'];
                const hasKeyword = keywords.some(kw => task.toLowerCase().includes(kw));
                return hasKeyword ? 0.75 : 0.1;
            },
            priority: 6
        });
    }

    /**
     * 统一执行接口（Agent模式）
     * 这是Agent页面和流水线共用的入口
     * @param requirement 需求描述
     * @param workspace 工作区路径
     * @param context 额外上下文（可包含onProgress、onUserQuestion等配置）
     */
    async executeAgentMode(
        requirement: string,
        workspace: string,
        context: any = {}
    ): Promise<CoordinatorResult> {
        // 确保已初始化
        this.initialize();

        // 提取配置参数
        const {onProgress, onUserQuestion, planOnly, skipConfirmation, ...executionContext} = context || {};

        // 创建新的Coordinator实例并传入配置
        const config = {
            allowUserInteraction: true,
            timeout: 300000,
            maxRetries: 3,
            onProgress,
            onUserQuestion
        };

        const coordinator = createCoordinatorAgent(this.agentsService, config);

        // 使用协调Agent执行
        return await coordinator.execute(requirement, workspace, executionContext, {planOnly, skipConfirmation});
    }

    /**
     * 获取所有可用的Agent
     */
    listAvailableAgents(): AgentCapability[] {
        this.initialize();
        return getAgentRegistry().getAllAgents();
    }

    /**
     * 为特定任务推荐Agent
     */
    recommendAgents(taskDescription: string, minConfidence: number = 0.3): Array<{
        agentId: string;
        agentName: string;
        confidence: number;
        reasoning: string;
    }> {
        this.initialize();
        return getAgentRegistry().getCandidates(taskDescription, {}, minConfidence);
    }

    /**
     * 向后兼容：保留原有的executeAgent接口
     * 如果需要单独执行某个Agent（非协调模式），仍可使用
     */
    async executeSingleAgent(
        agentType: string,
        taskId: string,
        inputData: any,
        options?: any
    ): Promise<any> {
        return await this.agentsService.executeAgent({
            agentType: agentType as any,
            taskId,
            inputData,
            options
        });
    }

    /**
     * 向后兼容：保留原有的executeWorkflow接口
     */
    async executeWorkflow(config: any): Promise<any> {
        return await this.agentsService.executeWorkflow(config);
    }
}

/**
 * 获取协调服务实例
 */
export function getCoordinatorService(): CoordinatorService {
    return CoordinatorService.getInstance();
}

/**
 * 便捷函数：执行Agent模式
 */
export async function executeAgentMode(
    requirement: string,
    workspace: string,
    context?: any
): Promise<CoordinatorResult> {
    const service = getCoordinatorService();
    return await service.executeAgentMode(requirement, workspace, context);
}
