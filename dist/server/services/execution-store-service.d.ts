/**
 * 持久化执行记录接口
 */
export interface PersistedExecution {
    /** 执行记录唯一标识符 */
    id: string;
    /** 关联计划 ID */
    planId: string;
    /** 关联需求 ID */
    requirementId: string;
    /** 执行状态 */
    status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'waiting_skill_confirm';
    /** 当前步骤索引 */
    currentStep: number;
    /** 总步骤数 */
    totalSteps: number;
    /** 开始时间 */
    startedAt: string;
    /** 完成时间 */
    completedAt?: string;
    /** 日志 */
    logs: string[];
    /** Claude 会话 ID */
    sessionId?: string;
    /** 工作区路径 */
    workspacePath?: string;
    /** 待执行技能队列（顺序敏感，先选先执行） */
    pendingSkills?: string[];
    /** 已执行完成的技能列表 */
    executedSkills?: string[];
    /** 当前执行中的技能名 */
    currentSkill?: string;
}
/**
 * 执行记录存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/execution.json
 * 每个需求可有多条执行记录（数组）。
 * 维护 execution-index.json 索引以支持按 executionId 快速查找 requirementId。
 */
export declare class ExecutionStoreService {
    /** 读取 executionId → requirementId 索引 */
    private loadIndex;
    /** 写入索引 */
    private saveIndex;
    /** 获取需求文件夹下的 execution.json 路径 */
    private execFilePath;
    /** 从文件读取需求下的所有执行记录 */
    private readExecFile;
    /** 写入执行记录数组到需求文件夹 */
    private writeExecFile;
    /**
     * 列出所有执行记录（按 startedAt 倒序）
     */
    list(limit?: number): PersistedExecution[];
    /**
     * 根据 executionId 获取执行记录
     */
    get(executionId: string): PersistedExecution | undefined;
    /**
     * 根据需求 ID 获取该需求下的所有执行记录（按 startedAt 倒序）
     */
    getByRequirement(requirementId: string): PersistedExecution[];
    /**
     * 创建或更新执行记录
     */
    upsert(exec: PersistedExecution): PersistedExecution;
    /**
     * 根据 executionId 删除执行记录
     */
    delete(executionId: string): boolean;
    /**
     * 从旧版 executions.json 迁移到按需求文件夹存储
     */
    migrateFromLegacy(): void;
}
//# sourceMappingURL=execution-store-service.d.ts.map