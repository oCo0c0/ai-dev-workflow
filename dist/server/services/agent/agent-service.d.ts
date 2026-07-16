/**
 * @file Agent Service
 * @description Agent 系统统一入口 - 提供完整的 Agent 运行时服务
 *
 * 功能：
 * 1. 统一 API - 提供简洁的 Agent 执行接口
 * 2. 全局单例 - 管理全局唯一的 Agent Harness 实例
 * 3. 工厂函数 - 便捷创建各种组件
 * 4. 集成服务 - 与现有服务（MCP、Workspace、CLI Runner）集成
 */
import { AgentImplementation } from './agent-harness.js';
import { Task, AgentResult, ToolConfig } from './types.js';
/**
 * Agent 服务类 - 提供高级 API
 */
export declare class AgentService {
    private harness;
    private serviceIntegration?;
    constructor(serviceIntegration?: any);
    /**
     * 注册集成的工具
     */
    private registerIntegratedTools;
    /**
     * 注册 Agent
     */
    registerAgent(agent: AgentImplementation): void;
    /**
     * 执行 Agent
     */
    executeAgent(agentId: string, task: Task): Promise<AgentResult>;
    /**
     * 批量执行 Agent
     */
    executeAgents(executions: {
        agentId: string;
        task: Task;
    }[]): Promise<AgentResult[]>;
    /**
     * 注册工具
     */
    registerTool(tool: ToolConfig & {
        handler: (params: any) => Promise<any>;
    }): void;
    /**
     * 获取系统统计
     */
    getStats(agentId?: string): {
        totalTraces: number;
        completedTraces: number;
        failedTraces: number;
        totalTokensUsed: number;
        averageQuality: number;
        averageDuration: number;
    };
    /**
     * 清理旧数据
     */
    cleanup(maxAge?: number): void;
    /**
     * 设置服务集成
     */
    setServiceIntegration(serviceIntegration: any): void;
}
/**
 * 创建 Agent 服务实例
 */
export declare function createAgentService(serviceIntegration?: any): AgentService;
/**
 * 便捷函数：直接执行 Agent
 */
export declare function executeAgent(agent: AgentImplementation, task: Task, serviceIntegration?: any): Promise<AgentResult>;
export * from './types.js';
export { AgentHarness, createAgentHarness } from './agent-harness.js';
export { ToolExecutorImpl, createToolExecutor } from './tool-executor.js';
export { AgentMonitorImpl, createAgentMonitor } from './agent-monitor.js';
export { ErrorRecoverySystem, createErrorRecoverySystem } from './error-recovery.js';
export type { AgentImplementation } from './agent-harness.js';
//# sourceMappingURL=agent-service.d.ts.map