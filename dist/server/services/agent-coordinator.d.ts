/**
 * @file Agent Coordinator (重新实现)
 * @description Agent真正自主决策，不硬编码映射到Skill
 *
 * Agent = 自主决策的AI
 * - 能思考、规划
 * - 能调用工具（Claude/Skill/MCP）
 * - 能读写文件、运行命令
 * - 不是Skill的包装器
 */
import { CLIRunnerService } from './cli-runner-service.js';
import { SkillsService } from './skills-service.js';
import { MCPBridgeService } from './mcp-bridge-service.js';
/**
 * Agent协调器配置
 */
export interface CoordinatorConfig {
    cliRunner: CLIRunnerService;
    skillsService?: SkillsService;
    mcpBridgeService?: MCPBridgeService;
    workspacePath?: string;
}
/**
 * Agent协调器
 */
export declare class AgentCoordinator {
    private store;
    private abortControllers;
    private config;
    constructor(config: CoordinatorConfig);
    /**
     * 分析需求 - Coordinator Agent思考
     */
    analyzeRequirement(executionId: string): Promise<void>;
    /**
     * 执行任务 - 依次执行子任务
     */
    execute(executionId: string): Promise<void>;
    /**
     * 执行单个子任务 - 让Agent自己决定怎么做
     */
    private executeSubTask;
    /**
     * 解析子任务
     */
    private parseSubTasks;
    /**
     * 中止执行
     */
    abort(executionId: string): void;
    /**
     * 暂停执行
     */
    pause(executionId: string): Promise<void>;
    /**
     * 继续执行
     */
    resume(executionId: string): Promise<void>;
    /**
     * WebSocket广播
     */
    private broadcastStatus;
    private broadcastSubTask;
    private broadcastPlan;
    private broadcastComplete;
    private broadcastLog;
}
export declare function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator;
//# sourceMappingURL=agent-coordinator.d.ts.map