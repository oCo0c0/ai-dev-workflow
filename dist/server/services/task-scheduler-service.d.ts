/**
 * @module task-scheduler-service
 * @description 任务调度器 — Coordinator 模式实现
 *
 * 管理多个并行任务，每个任务拥有独立的 Claude Bridge 子进程。
 * 借鉴 Claude Code 的 Coordinator 模式：
 * - 每个 Task 对应一个独立的 CLIProvider 实例（独立子进程）
 * - 最大并行数控制，超出排队
 * - 任务完成自动启动排队中的下一个
 * - 内部编排完整流水线：Plan → Execution → Test
 */
import { ClaudeProvider } from './cli-providers/claude-provider.js';
import type { CLIProviderResult } from './cli-providers/types.js';
import type { MemoryService } from './memory/memory-service.js';
import type { PipelineService } from './pipeline-service.js';
import type { MCPBridgeService } from './mcp-bridge-service.js';
import type { RequirementStoreService } from './requirement-store-service.js';
export type TaskStatus = 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
export type TaskPhase = 'idle' | 'plan' | 'waiting_plan_confirm' | 'execution' | 'waiting_execution_confirm' | 'test';
export interface TaskLog {
    timestamp: string;
    phase: TaskPhase;
    logType: 'info' | 'output' | 'error' | 'warning';
    content: string;
}
export interface TaskInfo {
    id: string;
    name: string;
    projectId: string;
    requirementId: string;
    pipelineId: string;
    branch: string;
    workspacePath: string;
    worktreePath?: string;
    dependsOn: string[];
    baseBranch: string;
    status: TaskStatus;
    phase: TaskPhase;
    sessionId?: string;
    logs: TaskLog[];
    createdAt: string;
    updatedAt: string;
}
/** 流水线编排所需的依赖注入 */
export interface PipelineDependencies {
    requirementStore: RequirementStoreService;
    mcpBridgeService: MCPBridgeService;
    pipelineService: PipelineService;
    memoryService?: MemoryService;
    workspaceService?: import('./workspace-service.js').WorkspaceService;
}
export declare class TaskScheduler {
    private running;
    private queue;
    private tasks;
    private maxConcurrent;
    private deps;
    /** 持久化回调：状态变更时同步写入磁盘 */
    onPersist?: (task: TaskInfo) => void;
    /** 确认等待：taskId → resolve 回调 */
    private confirmationResolvers;
    constructor(maxConcurrent?: number);
    /** 注入流水线依赖 */
    setDependencies(deps: PipelineDependencies): void;
    getMaxConcurrent(): number;
    setMaxConcurrent(n: number): void;
    getRunningCount(): number;
    getQueueLength(): number;
    registerTask(task: TaskInfo): void;
    getTask(taskId: string): TaskInfo | undefined;
    getAllTasks(): TaskInfo[];
    getTasksByProject(projectId: string): TaskInfo[];
    /**
     * 启动任务（如果达到并行上限则排队，否则直接执行完整流水线）
     */
    startTask(taskId: string): Promise<void>;
    pauseTask(taskId: string): Promise<void>;
    resumeTask(taskId: string): Promise<void>;
    abortTask(taskId: string): Promise<void>;
    removeTask(taskId: string): void;
    /**
     * 向运行中的任务发送对话（多轮回复）
     */
    sendReply(taskId: string, message: string): Promise<CLIProviderResult>;
    getTaskProvider(taskId: string): ClaudeProvider | undefined;
    getTaskSignal(taskId: string): AbortSignal | undefined;
    setTaskSessionId(taskId: string, sessionId: string): void;
    updateTaskState(taskId: string, updates: Partial<Pick<TaskInfo, 'status' | 'phase' | 'name'>>): void;
    /**
     * 用户确认当前阶段，推进流水线
     */
    confirmTask(taskId: string): Promise<void>;
    /**
     * 等待用户确认（可被 abort 中断）
     */
    private waitForConfirmation;
    /**
     * 启动独立 provider 进程，然后编排完整流水线
     */
    private executeTask;
    /**
     * 任务完成后 stash 代码，如果有依赖任务则合并到 base 后触发
     */
    private stashAndTriggerDependents;
    /**
     * 内部编排完整流水线：Plan → Execution → Test
     * 同一个 provider/session 贯穿全流程
     */
    private runPipeline;
    /**
     * 获取需求内容（本地 store 优先，fallback MCP）
     */
    private getRequirementContent;
    private processQueue;
    private addLog;
    private notifyUpdate;
    dispose(): Promise<void>;
}
//# sourceMappingURL=task-scheduler-service.d.ts.map