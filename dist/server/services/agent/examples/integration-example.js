"use strict";
/**
 * @file Agent System Integration Example
 * @description 展示 Agent 系统与现有服务（MCP、Workspace、CLI Runner）的集成
 *
 * 这个示例展示如何：
 * 1. 创建带服务集成的 Agent 系统
 * 2. 使用 MCP 工具获取需求
 * 3. 使用工作空间上下文
 * 4. 使用 CLI 工具执行代码
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpIntegrationExample = mcpIntegrationExample;
exports.workspaceIntegrationExample = workspaceIntegrationExample;
exports.runAllIntegrationExamples = runAllIntegrationExamples;
const index_js_1 = require("../index.js");
const mcp_bridge_service_js_1 = require("../../mcp-bridge-service.js");
const workspace_service_js_1 = require("../../workspace-service.js");
const cli_runner_service_js_1 = require("../../cli-runner-service.js");
/**
 * 集成示例 Agent - 使用所有集成服务
 */
class IntegratedAgent {
    config = {
        id: 'integrated-agent',
        name: 'Integrated Agent',
        description: 'Agent with full service integration (MCP, Workspace, CLI)',
        tools: [],
        maxExecutionTime: 120000,
        maxRetries: 3
    };
    async think(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                content: 'Starting integrated workflow. Fetching requirement via MCP...',
                nextAction: {
                    type: 'fetch-requirement',
                    tool: 'fetch-requirement',
                    parameters: { id: task.input.requirementId }
                },
                confidence: 0.9
            };
        }
        if (iteration === 1) {
            return {
                content: 'Requirement fetched. Getting workspace context...',
                nextAction: {
                    type: 'get-workspace-context',
                    tool: 'get-workspace-context',
                    parameters: { projectId: task.input.projectId }
                },
                confidence: 0.85
            };
        }
        if (iteration === 2) {
            return {
                content: 'Context retrieved. Running analysis with CLI...',
                nextAction: {
                    type: 'analyze-code',
                    tool: 'analyze-code',
                    parameters: {
                        target: task.input.targetPath,
                        tool: 'eslint'
                    }
                },
                confidence: 0.8
            };
        }
        return {
            content: 'Integration workflow complete.',
            nextAction: { type: 'complete', parameters: {} },
            confidence: 0.95
        };
    }
    async act(context, action) {
        // 使用集成的工具执行操作
        const toolExecutor = context.tools;
        if (toolExecutor && action.tool) {
            return await toolExecutor.execute(action.tool, action.parameters);
        }
        // 默认实现
        switch (action.type) {
            case 'fetch-requirement':
                return { success: true, data: { id: action.parameters.id, title: 'Sample Requirement' } };
            case 'get-workspace-context':
                return { success: true, data: { projects: [], currentProject: null } };
            case 'analyze-code':
                return { success: true, data: { issues: [], warnings: [] } };
            case 'complete':
                return { success: true, data: 'Integration complete' };
            default:
                throw new Error(`Unknown action: ${action.type}`);
        }
    }
    async observe(_context, result) {
        if (!result.success) {
            return { result, quality: 0, needsImprovement: true };
        }
        const quality = this.assessQuality(result.data);
        return { result, quality, needsImprovement: quality < 0.8 };
    }
    async reflect(_context, observation) {
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Quality: ${observation.quality.toFixed(2)}`,
            improvements: [],
            quality: observation.quality
        };
    }
    async decide(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                type: 'fetch-requirement',
                tool: 'fetch-requirement',
                parameters: { id: task.input.requirementId }
            };
        }
        if (iteration === 1) {
            return {
                type: 'get-workspace-context',
                tool: 'get-workspace-context',
                parameters: { projectId: task.input.projectId }
            };
        }
        if (iteration === 2) {
            return {
                type: 'analyze-code',
                tool: 'analyze-code',
                parameters: { target: task.input.targetPath, tool: 'eslint' }
            };
        }
        return { type: 'complete', parameters: {} };
    }
    getToolHandler(_toolName) {
        // 这个方法由 Agent Harness 自动处理集成工具
        return undefined;
    }
    assessQuality(data) {
        if (!data)
            return 0;
        let score = 0.5;
        if (data.success)
            score += 0.3;
        if (data.data)
            score += 0.2;
        return Math.min(score, 1.0);
    }
}
/**
 * 集成示例 1：使用 MCP 获取需求
 */
async function mcpIntegrationExample() {
    console.log('\n=== Example 1: MCP Integration ===\n');
    try {
        // 创建服务实例（实际使用时会从 DI 容器获取）
        const mcpConfigService = {
            getServerConfig: () => ({
                command: 'node',
                args: ['path/to/mcp/server.js'],
                env: { API_KEY: 'test' }
            })
        };
        const mcpBridgeService = new mcp_bridge_service_js_1.MCPBridgeService(mcpConfigService);
        const workspaceService = new workspace_service_js_1.WorkspaceService();
        const cliRunnerService = new cli_runner_service_js_1.CLIRunnerService();
        // 创建服务集成
        const serviceIntegration = (0, index_js_1.createServiceIntegration)(mcpBridgeService, workspaceService, cliRunnerService);
        // 创建带集成的 Agent 服务
        const agentService = (0, index_js_1.createAgentService)(serviceIntegration);
        // 注册 Agent
        const agent = new IntegratedAgent();
        agentService.registerAgent(agent);
        // 执行 Agent（使用 MCP 工具）
        console.log('Executing Agent with MCP integration...');
        const result = await agentService.executeAgent('integrated-agent', {
            id: 'task-mcp-001',
            type: 'requirement-analysis',
            input: {
                requirementId: 'REQ-001',
                projectId: 'project-123',
                targetPath: './src'
            },
            targetQuality: 0.8,
            tokenBudget: 10000
        });
        console.log(`Success: ${result.success}`);
        console.log(`Quality: ${result.quality.toFixed(2)}`);
        console.log(`Iterations: ${result.iterations}`);
        console.log(`Tokens: ${result.tokensUsed}`);
    }
    catch (error) {
        console.log('Note: This example requires actual MCP configuration');
        console.log(`Error: ${error instanceof Error ? error.message : error}`);
    }
}
/**
 * 集成示例 2：工作空间上下文
 */
async function workspaceIntegrationExample() {
    console.log('\n=== Example 2: Workspace Context Integration ===\n');
    const workspaceService = new workspace_service_js_1.WorkspaceService();
    // 获取工作空间上下文
    const context = workspaceService.listSavedWorkspaces();
    console.log('Available Projects:');
    for (const project of context) {
        console.log(`  - ${project.name} (${project.id})`);
    }
    // 模拟 Agent 使用工作空间工具
    console.log('\nWorkspace tools available to Agents:');
    console.log('  - get-workspace-context: Get project structure and stats');
    console.log('  - list-projects: List all available projects');
    console.log('  - get-project: Get specific project details');
}
/**
 * 运行所有集成示例
 */
async function runAllIntegrationExamples() {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║        Agent System Integration Examples                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    try {
        await mcpIntegrationExample();
        await workspaceIntegrationExample();
        console.log('\n✅ All integration examples completed!');
    }
    catch (error) {
        console.error('\n❌ Example failed:', error);
    }
}
// 如果直接运行此文件，执行示例
if (require.main === module) {
    runAllIntegrationExamples().catch(console.error);
}
//# sourceMappingURL=integration-example.js.map