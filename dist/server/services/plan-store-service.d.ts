/**
 * 持久化开发计划接口
 */
export interface PersistedPlan {
    /** 计划唯一标识符 */
    id: string;
    /** 关联需求 ID */
    requirementId: string;
    /** 关联需求标题（冗余存储，避免跨服务查询） */
    requirementTitle?: string;
    /** 关联需求编号（如 #125975） */
    requirementNumber?: string;
    /** 工作区路径 */
    workspacePath: string;
    /** 计划状态 */
    status: 'generating' | 'paused' | 'ready' | 'failed' | 'waiting_input' | 'waiting_skill_confirm';
    /** 计划摘要 */
    summary?: string;
    /** Claude Agent 原始输出 */
    rawOutput?: string;
    /** 创建时间 */
    createdAt: string;
    /** 最后更新时间 */
    updatedAt: string;
    /** 错误信息 */
    error?: string;
    /** 会话 ID */
    sessionId?: string;
    /** 流水线 ID */
    pipelineId?: string;
    /** 待执行技能队列（顺序敏感，先选先执行） */
    pendingSkills?: string[];
    /** 已执行完成的技能列表 */
    executedSkills?: string[];
    /** 当前执行中的技能名 */
    currentSkill?: string;
}
/**
 * 开发计划存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/plan.json
 * 每个需求只有一个 plan（regenerate 覆盖）。
 * 维护 plan-index.json 索引以支持按 planId 快速查找 requirementId。
 */
export declare class PlanStoreService {
    /** 读取 planId → requirementId 索引 */
    private loadIndex;
    /** 写入索引 */
    private saveIndex;
    /** 获取需求文件夹下的 plan.json 路径 */
    private planFilePath;
    /** 从文件读取单个 plan */
    private readPlanFile;
    /** 写入 plan 到需求文件夹 */
    private writePlanFile;
    /**
     * 列出所有计划（按 updatedAt 倒序）
     */
    list(): PersistedPlan[];
    /**
     * 根据 planId 获取计划
     */
    get(planId: string): PersistedPlan | undefined;
    /**
     * 根据需求 ID 获取计划（直接读取，无需索引）
     */
    getByRequirement(requirementId: string): PersistedPlan | undefined;
    /**
     * 创建或更新计划（自动填充 updatedAt）
     */
    upsert(plan: Omit<PersistedPlan, 'updatedAt'> & {
        updatedAt?: string;
    }): PersistedPlan;
    /**
     * 根据 planId 删除计划
     */
    delete(planId: string): boolean;
    /**
     * 从旧版 plans.json 迁移到按需求文件夹存储
     */
    migrateFromLegacy(): void;
}
//# sourceMappingURL=plan-store-service.d.ts.map