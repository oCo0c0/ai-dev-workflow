import { JsonStore } from '../json-store.js';
/** 反馈条目接口 */
export interface FeedbackEntry {
    id: string;
    executionId: string;
    workspacePath: string;
    phase: 'plan' | 'execution' | 'test';
    category: 'correction' | 'preference' | 'rejection';
    originalOutput: string;
    userCorrection: string;
    pattern?: string;
    timestamp: string;
}
/**
 * 用户反馈日志存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 50 条。
 * 额外提供按执行 ID 查询和自动生成 ID 的 add 方法。
 */
export declare class FeedbackLogStore extends JsonStore<FeedbackEntry> {
    constructor(storeFile?: string);
    /** 按执行 ID 查找反馈 */
    getByExecutionId(executionId: string): FeedbackEntry[];
    /** 添加反馈条目（自动生成 id 和 timestamp） */
    add(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry;
}
//# sourceMappingURL=feedback-log-store.d.ts.map