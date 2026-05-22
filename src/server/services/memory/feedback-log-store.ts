/**
 * @module feedback-log-store
 * @description 用户反馈日志持久化存储
 *
 * 记录用户对 AI 输出的修正、偏好和拒绝反馈。
 * 存储在 ~/.ai-dev-workbench/memory/feedback-log.json，上限 50 条。
 */
import path from 'path';
import crypto from 'crypto';
import {JsonStore} from '../json-store.js';
import {MEMORY_DIR} from '../../utils/constants.js';

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

const STORE_FILE = path.join(MEMORY_DIR, 'feedback-log.json');

/**
 * 用户反馈日志存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 50 条。
 * 额外提供按执行 ID 查询和自动生成 ID 的 add 方法。
 */
export class FeedbackLogStore extends JsonStore<FeedbackEntry> {
    constructor(storeFile?: string) {
        super({defaultPath: STORE_FILE, maxRecords: 50, sortField: 'timestamp'}, storeFile);
    }

    /** 按执行 ID 查找反馈 */
    getByExecutionId(executionId: string): FeedbackEntry[] {
        return this.load().filter(e => e.executionId === executionId);
    }

    /** 添加反馈条目（自动生成 id 和 timestamp） */
    add(entry: Omit<FeedbackEntry, 'id' | 'timestamp'>): FeedbackEntry {
        const record: FeedbackEntry = {
            ...entry,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
        };
        const entries = this.load();
        entries.push(record);
        this.save(entries);
        return record;
    }
}
