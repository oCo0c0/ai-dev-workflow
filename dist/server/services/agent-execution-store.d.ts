/**
 * @file Agent Execution Store
 * @description Agent执行存储服务 - 管理Agent执行记录的持久化
 *
 * 功能：
 * - 按需求隔离存储（每个需求独立目录）
 * - 支持执行记录的CRUD操作
 * - 存储Agent思考过程、子任务状态、执行日志
 */
import type { ExecutionStep, SubTask, AgentThought, AgentExecutionSummary, AgentExecution } from '../../types/agent-execution.js';
/**
 * Agent执行存储服务
 *
 * 注意：该类不应被外部直接实例化。请使用 {@link getAgentExecutionStore} 获取单例。
 */
export declare class AgentExecutionStore {
    #private;
    private basePath;
    /** 每个 executionId 的写操作队列，串行化读-改-写避免并发覆盖/读到截断文件 */
    private writeQueues;
    private constructor();
    /**
     * 把操作排入指定 executionId 的写队列，保证同一 execution 的写操作串行执行
     */
    private enqueue;
    /**
     * 获取执行记录的存储路径
     */
    private getExecutionPath;
    /**
     * 内部保存方法：直接写文件，调用方必须已经处于写队列中或确保串行。
     */
    private saveInternal;
    /**
     * 创建新执行记录
     */
    create(data: Omit<AgentExecution, 'id' | 'createdAt' | 'updatedAt' | 'subTasks' | 'thoughts' | 'logs' | 'steps'>): Promise<AgentExecution>;
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
     * 更新 sessionId，传 undefined 表示清空
     */
    updateSessionId(executionId: string, sessionId: string | undefined): Promise<void>;
    /**
     * 更新整个执行记录（供 coordinator 等内部模块使用）。
     * 写操作会进入队列以保证并发安全。
     */
    updateFull(execution: AgentExecution): Promise<void>;
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
    static getInstance(): AgentExecutionStore;
}
//# sourceMappingURL=agent-execution-store.d.ts.map