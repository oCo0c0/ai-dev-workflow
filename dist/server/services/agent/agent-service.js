"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createErrorRecoverySystem = exports.ErrorRecoverySystem = exports.createAgentMonitor = exports.AgentMonitorImpl = exports.createToolExecutor = exports.ToolExecutorImpl = exports.createAgentHarness = exports.AgentHarness = exports.AgentService = void 0;
exports.createAgentService = createAgentService;
exports.executeAgent = executeAgent;
const agent_harness_js_1 = require("./agent-harness.js");
const tool_executor_js_1 = require("./tool-executor.js");
const agent_monitor_js_1 = require("./agent-monitor.js");
const error_recovery_js_1 = require("./error-recovery.js");
/**
 * Agent 系统全局实例
 */
class AgentSystem {
    static harness = null;
    static toolExecutor = null;
    static monitor = null;
    static recovery = null;
    /**
     * 获取或创建 Agent Harness 实例
     */
    static getHarness() {
        if (!this.harness) {
            this.harness = (0, agent_harness_js_1.createAgentHarness)();
        }
        return this.harness;
    }
    /**
     * 获取或创建工具执行器实例
     */
    static getToolExecutor() {
        if (!this.toolExecutor) {
            this.toolExecutor = (0, tool_executor_js_1.createToolExecutor)();
        }
        return this.toolExecutor;
    }
    /**
     * 获取或创建监控系统实例
     */
    static getMonitor() {
        if (!this.monitor) {
            this.monitor = (0, agent_monitor_js_1.createAgentMonitor)();
        }
        return this.monitor;
    }
    /**
     * 获取或创建错误恢复系统实例
     */
    static getRecoverySystem() {
        if (!this.recovery) {
            this.recovery = (0, error_recovery_js_1.createErrorRecoverySystem)();
        }
        return this.recovery;
    }
    /**
     * 重置所有实例（主要用于测试）
     */
    static reset() {
        this.harness = null;
        this.toolExecutor = null;
        this.monitor = null;
        this.recovery = null;
    }
}
/**
 * Agent 服务类 - 提供高级 API
 */
class AgentService {
    harness;
    serviceIntegration; // ServiceIntegration
    constructor(serviceIntegration) {
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
    registerIntegratedTools(serviceIntegration) {
        const toolHandlers = serviceIntegration.getToolHandlers();
        for (const [toolName, handler] of toolHandlers.entries()) {
            this.registerTool({
                name: toolName,
                description: `Tool: ${toolName}`,
                parameters: {},
                retryable: true,
                timeout: 15000,
                handler: handler
            });
        }
    }
    /**
     * 注册 Agent
     */
    registerAgent(agent) {
        this.harness.registerAgent(agent);
    }
    /**
     * 执行 Agent
     */
    async executeAgent(agentId, task) {
        return await this.harness.execute(agentId, task);
    }
    /**
     * 批量执行 Agent
     */
    async executeAgents(executions) {
        const results = await Promise.all(executions.map(({ agentId, task }) => this.harness.execute(agentId, task)));
        return results;
    }
    /**
     * 注册工具
     */
    registerTool(tool) {
        const toolExecutor = AgentSystem.getToolExecutor();
        toolExecutor.registerTool(tool);
    }
    /**
     * 获取系统统计
     */
    getStats(agentId) {
        return this.harness.getStats(agentId);
    }
    /**
     * 清理旧数据
     */
    cleanup(maxAge) {
        this.harness.cleanup(maxAge);
    }
    /**
     * 设置服务集成
     */
    setServiceIntegration(serviceIntegration) {
        this.serviceIntegration = serviceIntegration;
        if (serviceIntegration) {
            this.registerIntegratedTools(serviceIntegration);
        }
    }
}
exports.AgentService = AgentService;
/**
 * 创建 Agent 服务实例
 */
function createAgentService(serviceIntegration) {
    return new AgentService(serviceIntegration);
}
/**
 * 便捷函数：直接执行 Agent
 */
async function executeAgent(agent, task, serviceIntegration) {
    const service = createAgentService(serviceIntegration);
    service.registerAgent(agent);
    return await service.executeAgent(agent.config.id, task);
}
// 导出所有类型和接口
__exportStar(require("./types.js"), exports);
// 导出所有核心组件
var agent_harness_js_2 = require("./agent-harness.js");
Object.defineProperty(exports, "AgentHarness", { enumerable: true, get: function () { return agent_harness_js_2.AgentHarness; } });
Object.defineProperty(exports, "createAgentHarness", { enumerable: true, get: function () { return agent_harness_js_2.createAgentHarness; } });
var tool_executor_js_2 = require("./tool-executor.js");
Object.defineProperty(exports, "ToolExecutorImpl", { enumerable: true, get: function () { return tool_executor_js_2.ToolExecutorImpl; } });
Object.defineProperty(exports, "createToolExecutor", { enumerable: true, get: function () { return tool_executor_js_2.createToolExecutor; } });
var agent_monitor_js_2 = require("./agent-monitor.js");
Object.defineProperty(exports, "AgentMonitorImpl", { enumerable: true, get: function () { return agent_monitor_js_2.AgentMonitorImpl; } });
Object.defineProperty(exports, "createAgentMonitor", { enumerable: true, get: function () { return agent_monitor_js_2.createAgentMonitor; } });
var error_recovery_js_2 = require("./error-recovery.js");
Object.defineProperty(exports, "ErrorRecoverySystem", { enumerable: true, get: function () { return error_recovery_js_2.ErrorRecoverySystem; } });
Object.defineProperty(exports, "createErrorRecoverySystem", { enumerable: true, get: function () { return error_recovery_js_2.createErrorRecoverySystem; } });
//# sourceMappingURL=agent-service.js.map