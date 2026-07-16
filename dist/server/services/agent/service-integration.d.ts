/**
 * @file Service Integration
 * @description Agent 系统与现有服务的集成层
 *
 * 集成的服务：
 * 1. MCP Bridge - 外部工具调用（需求获取、搜索）
 * 2. Workspace Service - 项目上下文管理
 * 3. CLI Runner - 代码执行环境
 */
import { MCPBridgeService } from '../mcp-bridge-service.js';
import { WorkspaceService } from '../workspace-service.js';
import { CLIRunnerService } from '../cli-runner-service.js';
import { ToolConfig } from './types';
/**
 * 服务集成器 - 为 Agent 系统提供工具和服务
 */
export declare class ServiceIntegration {
    private mcpBridgeService;
    private workspaceService;
    private cliRunnerService;
    constructor(mcpBridgeService: MCPBridgeService, workspaceService: WorkspaceService, cliRunnerService: CLIRunnerService);
    /**
     * 获取 MCP 工具配置列表
     * 将 MCP 服务暴露为 Agent 可用的工具
     */
    getMCPTools(): ToolConfig[];
    /**
     * 执行 MCP 工具调用
     */
    executeMCPTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown>;
    /**
     * 获取工作空间上下文
     * 为 Agent 提供项目结构和信息
     */
    getWorkspaceContext(_projectId?: string): Promise<{
        projects: any[];
        currentProject?: any;
        structure?: any;
        stats?: any;
    }>;
    /**
     * 获取 CLI 工具配置列表
     */
    getCLITools(): ToolConfig[];
    /**
     * 执行 CLI 工具调用
     */
    executeCLITool(toolName: string, _parameters: Record<string, unknown>): Promise<unknown>;
    /**
     * 为 Agent 准备完整工具集
     * 整合所有可用的工具
     */
    getAgentTools(): Promise<ToolConfig[]>;
    /**
     * 统一工具执行入口
     */
    executeTool(toolName: string, parameters: Record<string, unknown>): Promise<unknown>;
    /**
     * 获取集成的工具处理器映射
     * 用于 Agent Harness 的工具注册
     */
    getToolHandlers(): Map<string, (params: any) => Promise<any>>;
}
/**
 * 创建服务集成实例
 */
export declare function createServiceIntegration(mcpBridgeService: MCPBridgeService, workspaceService: WorkspaceService, cliRunnerService: CLIRunnerService): ServiceIntegration;
//# sourceMappingURL=service-integration.d.ts.map