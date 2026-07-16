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

import {AgentHarness, createAgentHarness, AgentImplementation} from './agent-harness.js';
import {ToolExecutorImpl, createToolExecutor} from './tool-executor.js';
import {AgentMonitorImpl, createAgentMonitor} from './agent-monitor.js';
import {ErrorRecoverySystem, createErrorRecoverySystem} from './error-recovery.js';
import {Task, AgentResult, ToolConfig} from './types.js';

/**
 * Agent 系统全局实例
 */
class AgentSystem {
    private static harness: AgentHarness | null = null;
    private static toolExecutor: ToolExecutorImpl | null = null;
    private static monitor: AgentMonitorImpl | null = null;
    private static recovery: ErrorRecoverySystem | null = null;

    /**
     * 获取或创建 Agent Harness 实例
     */
    static getHarness(): AgentHarness {
        if (!this.harness) {
            this.harness = createAgentHarness();
        }
        return this.harness;
    }

    /**
     * 获取或创建工具执行器实例
     */
    static getToolExecutor(): ToolExecutorImpl {
        if (!this.toolExecutor) {
            this.toolExecutor = createToolExecutor();
        }
        return this.toolExecutor;
    }

    /**
     * 获取或创建监控系统实例
     */
    static getMonitor(): AgentMonitorImpl {
        if (!this.monitor) {
            this.monitor = createAgentMonitor();
        }
        return this.monitor;
    }

    /**
     * 获取或创建错误恢复系统实例
     */
    static getRecoverySystem(): ErrorRecoverySystem {
        if (!this.recovery) {
            this.recovery = createErrorRecoverySystem();
        }
        return this.recovery;
    }

    /**
     * 重置所有实例（主要用于测试）
     */
    static reset(): void {
        this.harness = null;
        this.toolExecutor = null;
        this.monitor = null;
        this.recovery = null;
    }
}

/**
 * Agent 服务类 - 提供高级 API
 */
export class AgentService {
    private harness: AgentHarness;
    private serviceIntegration?: any; // ServiceIntegration

    constructor(serviceIntegration?: any) {
        this.harness = AgentSystem.getHarness();
        this.serviceIntegration = serviceIntegration;

        // 如果有服务集成，注册工具
        if (serviceIntegration) {
            this.registerIntegratedTools(serviceIntegration);
        }
    }

    /**
     * 注册集成的工具
     */
    private registerIntegratedTools(serviceIntegration: any): void {
        const toolHandlers = serviceIntegration.getToolHandlers();

        for (const [toolName, handler] of toolHandlers.entries()) {
            this.registerTool({
                name: toolName,
                description: `Tool: ${toolName}`,
                parameters: {},
                retryable: true,
                timeout: 15000,
                handler: handler as (params: any) => Promise<any>
            });
        }
    }

    /**
     * 注册 Agent
     */
    registerAgent(agent: AgentImplementation): void {
        this.harness.registerAgent(agent);
    }

    /**
     * 执行 Agent
     */
    async executeAgent(agentId: string, task: Task): Promise<AgentResult> {
        return await this.harness.execute(agentId, task);
    }

    /**
     * 批量执行 Agent
     */
    async executeAgents(executions: { agentId: string; task: Task }[]): Promise<AgentResult[]> {
        const results = await Promise.all(
            executions.map(({agentId, task}) =>
                this.harness.execute(agentId, task)
            )
        );
        return results;
    }

    /**
     * 注册工具
     */
    registerTool(tool: ToolConfig & { handler: (params: any) => Promise<any> }): void {
        const toolExecutor = AgentSystem.getToolExecutor();
        toolExecutor.registerTool(tool);
    }

    /**
     * 获取系统统计
     */
    getStats(agentId?: string) {
        return this.harness.getStats(agentId);
    }

    /**
     * 清理旧数据
     */
    cleanup(maxAge?: number): void {
        this.harness.cleanup(maxAge);
    }

    /**
     * 设置服务集成
     */
    setServiceIntegration(serviceIntegration: any): void {
        this.serviceIntegration = serviceIntegration;
        if (serviceIntegration) {
            this.registerIntegratedTools(serviceIntegration);
        }
    }
}

/**
 * 创建 Agent 服务实例
 */
export function createAgentService(serviceIntegration?: any): AgentService {
    return new AgentService(serviceIntegration);
}

/**
 * 便捷函数：直接执行 Agent
 */
export async function executeAgent(
    agent: AgentImplementation,
    task: Task,
    serviceIntegration?: any
): Promise<AgentResult> {
    const service = createAgentService(serviceIntegration);
    service.registerAgent(agent);
    return await service.executeAgent(agent.config.id, task);
}

// 导出所有类型和接口
export * from './types.js';

// 导出所有核心组件
export {AgentHarness, createAgentHarness} from './agent-harness.js';
export {ToolExecutorImpl, createToolExecutor} from './tool-executor.js';
export {AgentMonitorImpl, createAgentMonitor} from './agent-monitor.js';
export {ErrorRecoverySystem, createErrorRecoverySystem} from './error-recovery.js';

// 导出 Agent 实现接口
export type {AgentImplementation} from './agent-harness.js';
