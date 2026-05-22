import { AnalyticsStoreService, type ExecutionAnalytics } from './analytics-store-service.js';
import type { MemoryService } from './memory/memory-service.js';
/**
 * 模式事件数据
 */
export interface PatternEventData {
    /** 模式类型 */
    pattern: 'repeated-failure' | 'recovery-insight' | 'skill-ineffective';
    /** 相关分析记录 ID */
    analyticsIds: string[];
    /** 工作空间路径 */
    workspacePath: string;
    /** 额外描述 */
    description?: string;
}
/**
 * 技能效果统计
 */
export interface SkillEffectiveness {
    /** 使用次数 */
    uses: number;
    /** 成功次数 */
    successes: number;
    /** 成功率 */
    rate: number;
}
/**
 * 模式摘要
 */
export interface PatternSummary {
    /** 模式标签 */
    pattern: string;
    /** 出现次数 */
    count: number;
    /** 最后出现时间 */
    lastSeen: string;
}
/**
 * 分析概览数据
 */
export interface AnalyticsSummary {
    /** 总执行次数 */
    totalExecutions: number;
    /** 成功次数 */
    successes: number;
    /** 失败次数 */
    failures: number;
    /** 成功率 */
    successRate: number;
    /** 平均耗时（毫秒） */
    avgDurationMs: number;
    /** 近期模式列表 */
    recentPatterns: PatternSummary[];
}
/**
 * 执行分析服务
 */
export declare class AnalyticsService {
    private analyticsStore;
    private memoryService;
    constructor(analyticsStore?: AnalyticsStoreService, memoryService?: MemoryService);
    private registerListeners;
    /**
     * 处理执行完成事件
     */
    private handleExecutionComplete;
    /**
     * 处理测试完成事件
     */
    private handleTestComplete;
    /**
     * 模式检测
     *
     * 规则：
     * 1. 同 workspace 连续失败 > 2 次 → repeated-failure
     * 2. 单个 Skill 成功率 < 40%（近 10 次） → skill-ineffective
     */
    private detectPatterns;
    /**
     * 获取分析概览
     */
    getSummary(): AnalyticsSummary;
    /**
     * 获取检测到的模式列表
     */
    getPatterns(): PatternSummary[];
    /**
     * 获取技能效果统计
     */
    getSkillEffectiveness(skillName: string): SkillEffectiveness;
    /**
     * 获取历史记录
     */
    getHistory(limit?: number): ExecutionAnalytics[];
    /** 获取 store 实例 */
    get store(): AnalyticsStoreService;
}
//# sourceMappingURL=analytics-service.d.ts.map