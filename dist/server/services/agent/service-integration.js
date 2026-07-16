"use strict";
/**
 * @file Service Integration
 * @description Agent 系统与现有服务的集成层
 *
 * 集成的服务：
 * 1. MCP Bridge - 外部工具调用（需求获取、搜索）
 * 2. Workspace Service - 项目上下文管理
 * 3. CLI Runner - 代码执行环境
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceIntegration = void 0;
exports.createServiceIntegration = createServiceIntegration;
/**
 * 服务集成器 - 为 Agent 系统提供工具和服务
 */
class ServiceIntegration {
    mcpBridgeService;
    // 预留服务引用（未来功能扩展）
    workspaceService;
    cliRunnerService;
    constructor(mcpBridgeService, workspaceService, cliRunnerService) {
        this.mcpBridgeService = mcpBridgeService;
        this.workspaceService = workspaceService;
        this.cliRunnerService = cliRunnerService;
    }
    /**
     * 获取 MCP 工具配置列表
     * 将 MCP 服务暴露为 Agent 可用的工具
     */
    getMCPTools() {
        return [
            {
                name: 'fetch-requirement',
                description: 'Fetch requirement details from external system',
                parameters: {
                    id: {
                        type: 'string',
                        description: 'Requirement ID to fetch'
                    }
                },
                retryable: true,
                timeout: 15000
            },
            {
                name: 'search-requirements',
                description: 'Search requirements by keyword',
                parameters: {
                    query: {
                        type: 'string',
                        description: 'Search query'
                    }
                },
                retryable: true,
                timeout: 10000
            }
        ];
    }
    /**
     * 执行 MCP 工具调用
     */
    async executeMCPTool(toolName, parameters) {
        switch (toolName) {
            case 'fetch-requirement':
                return await this.mcpBridgeService.fetchRequirementDetail(parameters.id);
            case 'search-requirements':
                return await this.mcpBridgeService.searchRequirements(parameters.query);
            default:
                throw new Error(`Unknown MCP tool: ${toolName}`);
        }
    }
    /**
     * 获取工作空间上下文
     * 为 Agent 提供项目结构和信息
     */
    async getWorkspaceContext(_projectId) {
        // 暂时返回空数据，等待WorkspaceService扩展
        const projects = [];
        return {
            projects,
            currentProject: undefined,
            stats: undefined
        };
    }
    /**
     * 获取 CLI 工具配置列表
     */
    getCLITools() {
        return [
            {
                name: 'run-command',
                description: 'Execute CLI command in specified environment',
                parameters: {
                    command: {
                        type: 'string',
                        description: 'Command to execute'
                    },
                    provider: {
                        type: 'string',
                        description: 'CLI provider (node, python, etc.)',
                        enum: ['node', 'python', 'java', 'go', 'generic']
                    }
                },
                retryable: false, // 命令执行通常不重试
                timeout: 30000
            },
            {
                name: 'analyze-code',
                description: 'Analyze code with CLI tools',
                parameters: {
                    target: {
                        type: 'string',
                        description: 'Target file or directory'
                    },
                    tool: {
                        type: 'string',
                        description: 'Analysis tool (eslint, pylint, etc.)'
                    }
                },
                retryable: true,
                timeout: 20000
            }
        ];
    }
    /**
     * 执行 CLI 工具调用
     */
    async executeCLITool(toolName, _parameters) {
        switch (toolName) {
            case 'run-command':
                // CLI命令执行功能待实现
                return { message: 'CLI command execution not yet implemented' };
            case 'analyze-code':
                // 代码分析功能待实现
                return { message: 'Code analysis not yet implemented' };
            default:
                throw new Error(`Unknown CLI tool: ${toolName}`);
        }
    }
    /**
     * 为 Agent 准备完整工具集
     * 整合所有可用的工具
     */
    async getAgentTools() {
        const mcpTools = this.getMCPTools();
        const cliTools = this.getCLITools();
        return [
            ...mcpTools,
            ...cliTools,
            {
                name: 'get-workspace-context',
                description: 'Get current workspace and project context',
                parameters: {
                    projectId: {
                        type: 'string',
                        description: 'Optional project ID to focus on'
                    }
                },
                retryable: true,
                timeout: 5000
            }
        ];
    }
    /**
     * 统一工具执行入口
     */
    async executeTool(toolName, parameters) {
        // MCP 工具
        if (['fetch-requirement', 'search-requirements'].includes(toolName)) {
            return await this.executeMCPTool(toolName, parameters);
        }
        // CLI 工具
        if (['run-command', 'analyze-code'].includes(toolName)) {
            return await this.executeCLITool(toolName, parameters);
        }
        // 工作空间工具
        if (toolName === 'get-workspace-context') {
            return await this.getWorkspaceContext(parameters.projectId);
        }
        throw new Error(`Unknown tool: ${toolName}`);
    }
    /**
     * 获取集成的工具处理器映射
     * 用于 Agent Harness 的工具注册
     */
    getToolHandlers() {
        return new Map([
            // MCP 工具
            ['fetch-requirement', async (params) => this.executeMCPTool('fetch-requirement', params)],
            ['search-requirements', async (params) => this.executeMCPTool('search-requirements', params)],
            // CLI 工具
            ['run-command', async (params) => this.executeCLITool('run-command', params)],
            ['analyze-code', async (params) => this.executeCLITool('analyze-code', params)],
            // 工作空间工具
            ['get-workspace-context', async (params) => this.getWorkspaceContext(params.projectId)]
        ]);
    }
}
exports.ServiceIntegration = ServiceIntegration;
/**
 * 创建服务集成实例
 */
function createServiceIntegration(mcpBridgeService, workspaceService, cliRunnerService) {
    return new ServiceIntegration(mcpBridgeService, workspaceService, cliRunnerService);
}
//# sourceMappingURL=service-integration.js.map