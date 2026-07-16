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
import { CoordinatorResult } from './coordinator-agent.js';
import { AgentCapability } from './agent-capability.js';
/**
 * 协调服务
 */
export declare class CoordinatorService {
    private static instance;
    private coordinatorAgent;
    private agentsService;
    private initialized;
    private constructor();
    static getInstance(): CoordinatorService;
    /**
     * 初始化（注册所有Agent能力）
     */
    initialize(): void;
    /**
     * 注册Agent能力
     */
    private registerAgentCapabilities;
    /**
     * 统一执行接口（Agent模式）
     * 这是Agent页面和流水线共用的入口
     * @param requirement 需求描述
     * @param workspace 工作区路径
     * @param context 额外上下文（可包含onProgress、onUserQuestion等配置）
     */
    executeAgentMode(requirement: string, workspace: string, context?: any): Promise<CoordinatorResult>;
    /**
     * 获取所有可用的Agent
     */
    listAvailableAgents(): AgentCapability[];
    /**
     * 为特定任务推荐Agent
     */
    recommendAgents(taskDescription: string, minConfidence?: number): Array<{
        agentId: string;
        agentName: string;
        confidence: number;
        reasoning: string;
    }>;
    /**
     * 向后兼容：保留原有的executeAgent接口
     * 如果需要单独执行某个Agent（非协调模式），仍可使用
     */
    executeSingleAgent(agentType: string, taskId: string, inputData: any, options?: any): Promise<any>;
    /**
     * 向后兼容：保留原有的executeWorkflow接口
     */
    executeWorkflow(config: any): Promise<any>;
}
/**
 * 获取协调服务实例
 */
export declare function getCoordinatorService(): CoordinatorService;
/**
 * 便捷函数：执行Agent模式
 */
export declare function executeAgentMode(requirement: string, workspace: string, context?: any): Promise<CoordinatorResult>;
//# sourceMappingURL=coordinator-service.d.ts.map