import { JsonStore } from './json-store.js';
/** 测试结果摘要 */
export interface TestSummary {
    total: number;
    passed: number;
    failed: number;
    framework?: string;
}
/** 执行分析记录接口 */
export interface ExecutionAnalytics {
    id: string;
    executionId: string;
    planId?: string;
    workspacePath: string;
    pipelineId?: string;
    phase: 'plan' | 'execution' | 'test';
    outcome: 'success' | 'failure' | 'aborted';
    startedAt: string;
    completedAt: string;
    durationMs: number;
    skillsUsed: string[];
    testSummary?: TestSummary;
    failureReason?: string;
    retryCount: number;
    pattern?: string;
    timestamp: string;
}
/**
 * 分析数据存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 200 条。
 * 额外提供按工作空间、阶段查询和自动生成 ID 的 create 方法。
 */
export declare class AnalyticsStoreService extends JsonStore<ExecutionAnalytics> {
    constructor(storeFile?: string);
    /** 按工作空间查询 */
    getByWorkspace(workspacePath: string, limit?: number): ExecutionAnalytics[];
    /** 按阶段查询 */
    getByPhase(phase: 'plan' | 'execution' | 'test', limit?: number): ExecutionAnalytics[];
    /** 创建分析记录（自动生成 id 和 timestamp） */
    create(record: Omit<ExecutionAnalytics, 'id' | 'timestamp'>): ExecutionAnalytics;
}
//# sourceMappingURL=analytics-store-service.d.ts.map