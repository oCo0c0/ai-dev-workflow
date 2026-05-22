/**
 * @module analytics-store-service
 * @description 执行分析数据持久化存储
 *
 * 记录每次执行的分析结果（成功/失败、耗时、使用的技能、模式检测等）。
 * 存储在 ~/.ai-dev-workbench/analytics.json，上限 200 条。
 */
import path from 'path';
import crypto from 'crypto';
import {JsonStore} from './json-store.js';
import {APP_DATA_DIR} from '../utils/constants.js';

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

const STORE_FILE = path.join(APP_DATA_DIR, 'analytics.json');

/**
 * 分析数据存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 200 条。
 * 额外提供按工作空间、阶段查询和自动生成 ID 的 create 方法。
 */
export class AnalyticsStoreService extends JsonStore<ExecutionAnalytics> {
    constructor(storeFile?: string) {
        super({defaultPath: STORE_FILE, maxRecords: 200, sortField: 'timestamp'}, storeFile);
    }

    /** 按工作空间查询 */
    getByWorkspace(workspacePath: string, limit?: number): ExecutionAnalytics[] {
        const filtered = this.load()
            .filter(r => r.workspacePath === workspacePath)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return limit ? filtered.slice(0, limit) : filtered;
    }

    /** 按阶段查询 */
    getByPhase(phase: 'plan' | 'execution' | 'test', limit?: number): ExecutionAnalytics[] {
        const filtered = this.load()
            .filter(r => r.phase === phase)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return limit ? filtered.slice(0, limit) : filtered;
    }

    /** 创建分析记录（自动生成 id 和 timestamp） */
    create(record: Omit<ExecutionAnalytics, 'id' | 'timestamp'>): ExecutionAnalytics {
        const entry: ExecutionAnalytics = {
            ...record,
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
        };
        // 使用继承的 load/save 实现 insert
        const records = this.load();
        records.push(entry);
        this.save(records);
        return entry;
    }
}
