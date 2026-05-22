import type { AnalyticsService } from './analytics-service.js';
import type { AnalyticsStoreService } from './analytics-store-service.js';
import type { SkillsService } from './skills-service.js';
/**
 * Curator 清理结果
 */
export interface CuratorResult {
    /** 删除的技能数量 */
    deleted: number;
    /** 停用的技能数量 */
    deactivated: number;
    /** 操作详情 */
    details: string[];
}
/**
 * 技能自动沉淀服务
 */
export declare class SkillDerivationService {
    private analyticsService;
    private skillsService;
    private analyticsStore;
    constructor(analyticsService: AnalyticsService, skillsService: SkillsService, analyticsStore: AnalyticsStoreService);
    private registerListeners;
    /**
     * 处理模式事件
     */
    private handlePattern;
    /**
     * 从恢复模式中提炼技能
     *
     * 当检测到"失败后成功恢复"的模式时，生成一个技能文件，
     * 描述如何避免之前的失败以及恢复策略。
     */
    private deriveRecoverySkill;
    /**
     * 生成恢复技能的 Markdown 内容
     */
    private generateRecoveryContent;
    /**
     * Curator：清理冗余和过期的自动生成技能
     *
     * 规则：
     * 1. confidence < 0.3 → 删除
     * 2. 超过 60 天未使用 → 删除
     * 3. 同 workspace 的重复技能 → 保留最新的
     *
     * @returns 清理结果
     */
    curatorReview(): CuratorResult;
    /**
     * 列出所有自动生成的技能
     */
    listAutoDerived(): string[];
}
//# sourceMappingURL=skill-derivation-service.d.ts.map