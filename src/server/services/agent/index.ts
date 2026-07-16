/**
 * Agent System - 统一导出
 */

// 核心服务
export {createAgentService, AgentService, executeAgent} from './agent-service.js';

// 组件工厂
export {createAgentHarness, AgentHarness} from './agent-harness.js';
export {createToolExecutor, ToolExecutorImpl} from './tool-executor.js';
export {createAgentMonitor, AgentMonitorImpl} from './agent-monitor.js';
export {createErrorRecoverySystem, ErrorRecoverySystem} from './error-recovery.js';

// 服务集成
export {ServiceIntegration, createServiceIntegration} from './service-integration.js';

// 类型定义
export * from './types.js';

// Agent 实现接口
export type {AgentImplementation} from './agent-harness.js';

// 示例
export {SimpleTextAgent, runSimpleTextAgentExample} from './examples/simple-agent.js';
export {
    runAllIntegrationExamples,
    mcpIntegrationExample,
    workspaceIntegrationExample
} from './examples/integration-example.js';
