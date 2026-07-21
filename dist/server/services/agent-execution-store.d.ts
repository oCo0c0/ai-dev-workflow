/**
 * @file Agent Execution Store
 * @description Agent执行存储服务 - 管理Agent执行记录的持久化
 *
 * 功能：
 * - 按需求隔离存储（每个需求独立目录）
 * - 支持执行记录的CRUD操作
 * - 存储Agent思考过程、子任务状态、执行日志
 */
/**
 * 执行步骤
 */
export interface ExecutionStep {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    logs: string[];
}
/**
 * 子任务状态
 */
export interface SubTask {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    agent?: string;
    startedAt?: string;
    completedAt?: string;
    output?: string;
    error?: string;
    order: number;
}
/**
 * Agent思考过程
 */
export interface AgentThought {
    type: 'analysis' | 'planning' | 'decision' | 'tool_selection' | 'error';
    content: string;
    timestamp: string;
    confidence?: number;
}
/**
 * Agent执行摘要
 */
export interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementNumber?: string;
    requirementTitle?: string;
    workspacePath: string;
    status: 'analyzing' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    createdAt: string;
    updatedAt: string;
    subTasksCount?: number;
    completedSubTasks?: number;
    currentStep?: number;
    totalSteps?: number;
}
/**
 * 完整的Agent执行信息
 */
export interface AgentExecution extends AgentExecutionSummary {
    requirementText?: string;
    thoughts: AgentThought[];
    subTasks: SubTask[];
    steps: ExecutionStep[];
    logs: string[];
    error?: string;
    sessionId?: string;
}
/**
 * Agent执行存储服务
 */
export declare class AgentExecutionStore {
    private basePath;
    constructor();
    /**
     * 获取执行记录的存储路径
     */
    private getExecutionPath;
    /**
     * 创建新执行记录
     */
    create(data: Omit<AgentExecution, 'id' | 'createdAt' | 'updatedAt' | 'subTasks' | 'thoughts' | 'logs' | 'steps'>): Promise<AgentExecution>;
    /**
     * 保存执行记录
     */
    save(execution: AgentExecution): Promise<void>;
    /**
     * 获取执行记录
     */
    get(executionId: string): Promise<AgentExecution | null>;
    /**
     * 列出所有执行记录
     */
    list(): Promise<AgentExecutionSummary[]>;
    /**
     * 删除执行记录
     */
    delete(executionId: string): Promise<boolean>;
    /**
     * 更新执行状态
     */
    updateStatus(executionId: string, status: AgentExecution['status']): Promise<void>;
    /**
     * 添加思考过程
     */
    addThought(executionId: string, thought: AgentThought): Promise<void>;
    /**
     * 添加日志
     */
    addLog(executionId: string, log: string): Promise<void>;
    /**
     * 更新子任务状态
     */
    updateSubTask(executionId: string, subTaskId: string, updates: Partial<SubTask>): Promise<void>;
    /**
     * 设置子任务列表
     */
    setSubTasks(executionId: string, subTasks: SubTask[]): Promise<void>;
    /**
     * 添加单个子任务
     */
    addSubTask(executionId: string, subTask: SubTask): Promise<void>;
    /**
     * 更新执行步骤
     */
    updateSteps(executionId: string, steps: ExecutionStep[]): Promise<void>;
    /**
     * 更新单个步骤
     */
    updateStep(executionId: string, stepIndex: number, step: ExecutionStep): Promise<void>;
}
export declare function getAgentExecutionStore(): AgentExecutionStore;
//# sourceMappingURL=agent-execution-store.d.ts.map