/**
 * @file Agent Coordinator (通用设计，不依赖特定格式)
 * @description 执行Agent并透传所有输出，解析结构化事件（thinking/tool_use/tool_result），
 *              生成思考过程、执行步骤、子任务数据并广播给前端。
 */
import { CLIRunnerService } from './cli-runner-service.js';
export interface CoordinatorConfig {
    cliRunner: CLIRunnerService;
    workspacePath?: string;
}
export declare class AgentCoordinator {
    private store;
    private abortControllers;
    private config;
    constructor(config: CoordinatorConfig);
    /**
     * 执行 Agent — 解析结构化事件，生成 thoughts/steps 数据
     */
    execute(executionId: string): Promise<void>;
    abort(executionId: string): void;
    /**
     * 处理 thinking 事件 → 写 thoughts + 广播
     */
    private handleThinking;
    /**
     * 处理 tool_use 事件 → 写操作工具创建 step + 广播，读操作只广播日志
     */
    private handleToolUse;
    /**
     * 处理 tool_result 事件 → 标记 step completed/failed + 广播
     */
    private handleToolResult;
    /**
     * 执行结束后，将所有仍为 running 的步骤标记为终态，防止前端永久转圈
     */
    private finalizeSteps;
    private broadcastStatus;
    private broadcastLog;
}
export declare function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator;
//# sourceMappingURL=agent-coordinator.d.ts.map