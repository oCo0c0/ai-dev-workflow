/**
 * @module analytics-service
 * @description 执行分析引擎
 *
 * 订阅 eventBus 的 execution:complete 和 test:complete 事件，
 * 记录分析数据、检测非平凡模式（连续失败、恢复模式、技能效果）。
 */
import {eventBus} from '../event-bus.js';
import {AnalyticsStoreService, type ExecutionAnalytics} from './analytics-store-service.js';
import type {MemoryService} from './memory/memory-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

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
 * execution:complete 事件数据结构（从路由广播中解析）
 */
interface ExecutionCompletePayload {
    executionId?: string;
    status?: string;
    workspacePath?: string;
}

/**
 * agent-execution:complete 事件数据结构（Agent 自主执行路径，素材最丰富）
 */
interface AgentExecutionCompletePayload {
    executionId?: string;
    status?: string;
    workspacePath?: string;
}

/**
 * test:complete 事件数据结构
 */
interface TestCompletePayload {
    taskId?: string;
    status?: string;
    workspacePath?: string;
    results?: {
        totalTests?: number;
        passed?: number;
        failed?: number;
        framework?: string;
    };
    rawOutput?: string;
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
export class AnalyticsService {
    private analyticsStore: AnalyticsStoreService;
    private memoryService: MemoryService | undefined;

    constructor(
        analyticsStore?: AnalyticsStoreService,
        memoryService?: MemoryService,
    ) {
        this.analyticsStore = analyticsStore ?? new AnalyticsStoreService();
        this.memoryService = memoryService;
        this.registerListeners();
    }

    private registerListeners(): void {
        eventBus.onEvent('execution:complete', (data: unknown) => this.handleExecutionComplete(data));
        eventBus.onEvent('test:complete', (data: unknown) => this.handleTestComplete(data));
        eventBus.onEvent('agent-execution:complete', (data: unknown) => this.handleAgentExecutionComplete(data));
    }

    /**
     * 处理执行完成事件
     */
    private handleExecutionComplete(data: unknown): void {
        try {
            const payload = data as ExecutionCompletePayload;
            if (!payload?.executionId) return;

            const outcome = payload.status === 'completed' ? 'success'
                : payload.status === 'aborted' ? 'aborted' : 'failure';

            const now = new Date().toISOString();
            const record = this.analyticsStore.create({
                executionId: payload.executionId,
                workspacePath: payload.workspacePath ?? '',
                phase: 'execution',
                outcome,
                startedAt: now,
                completedAt: now,
                durationMs: 0, // 无法从事件中获取，由调用方补充
                skillsUsed: [],
                retryCount: 0,
            });

            // 模式检测
            this.detectPatterns(record);
        } catch (err) {
            console.error(`[analytics] handleExecutionComplete error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 处理 Agent 执行完成事件（Agent 路径素材最丰富，为技能沉淀提供高质量证据）
     */
    private handleAgentExecutionComplete(data: unknown): void {
        try {
            const payload = data as AgentExecutionCompletePayload;
            if (!payload?.executionId) return;

            const outcome = payload.status === 'completed' ? 'success'
                : payload.status === 'aborted' ? 'aborted' : 'failure';

            const now = new Date().toISOString();
            const record = this.analyticsStore.create({
                executionId: payload.executionId,
                workspacePath: payload.workspacePath ?? '',
                phase: 'execution',
                outcome,
                startedAt: now,
                completedAt: now,
                durationMs: 0,
                skillsUsed: [],
                retryCount: 0,
            });

            // 模式检测
            this.detectPatterns(record);
        } catch (err) {
            console.error(`[analytics] handleAgentExecutionComplete error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 处理测试完成事件
     */
    private handleTestComplete(data: unknown): void {
        try {
            const payload = data as TestCompletePayload;
            if (!payload?.taskId) return;

            const outcome = payload.status === 'completed' ? 'success' : 'failure';
            const now = new Date().toISOString();

            this.analyticsStore.create({
                executionId: payload.taskId,
                workspacePath: payload.workspacePath ?? '',
                phase: 'test',
                outcome,
                startedAt: now,
                completedAt: now,
                durationMs: 0,
                skillsUsed: [],
                testSummary: payload.results ? {
                    total: payload.results.totalTests ?? 0,
                    passed: payload.results.passed ?? 0,
                    failed: payload.results.failed ?? 0,
                    framework: payload.results.framework,
                } : undefined,
                retryCount: 0,
            });
        } catch (err) {
            console.error(`[analytics] handleTestComplete error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 模式检测
     *
     * 规则：
     * 1. 同 workspace 连续失败 > 2 次 → repeated-failure
     * 2. 单个 Skill 成功率 < 40%（近 10 次） → skill-ineffective
     */
    private detectPatterns(record: ExecutionAnalytics): void {
        if (!record.workspacePath) return;

        // 规则 1: 连续失败检测
        const recent = this.analyticsStore.getByWorkspace(record.workspacePath, 5);
        const recentFailures = recent.filter(r => r.outcome === 'failure');
        if (recentFailures.length >= 3 && record.outcome === 'failure') {
            eventBus.emit('analytics:pattern', {
                pattern: 'repeated-failure',
                analyticsIds: recentFailures.map(r => r.id),
                workspacePath: record.workspacePath,
                description: `${recentFailures.length} consecutive failures in ${record.workspacePath}`,
            } as PatternEventData);
        }

        // 规则 2: 恢复模式检测（失败后有成功）
        if (record.outcome === 'success' && recent.length >= 2) {
            const previousFailure = recent.find(r => r.outcome === 'failure');
            if (previousFailure) {
                eventBus.emit('analytics:pattern', {
                    pattern: 'recovery-insight',
                    analyticsIds: [previousFailure.id, record.id],
                    workspacePath: record.workspacePath,
                    description: 'Recovery after failure detected',
                } as PatternEventData);
            }
        }
    }

    // === 公开查询 API ===

    /**
     * 获取分析概览
     */
    getSummary(): AnalyticsSummary {
        const all = this.analyticsStore.list();
        const successes = all.filter(r => r.outcome === 'success');
        const failures = all.filter(r => r.outcome === 'failure');
        const withPattern = all.filter(r => r.pattern);

        // 汇总模式
        const patternMap = new Map<string, {count: number; lastSeen: string}>();
        for (const r of withPattern) {
            const p = r.pattern!;
            const existing = patternMap.get(p);
            if (existing) {
                existing.count++;
                existing.lastSeen = r.timestamp;
            } else {
                patternMap.set(p, {count: 1, lastSeen: r.timestamp});
            }
        }

        return {
            totalExecutions: all.length,
            successes: successes.length,
            failures: failures.length,
            successRate: all.length > 0 ? successes.length / all.length : 0,
            avgDurationMs: all.length > 0
                ? Math.round(all.reduce((sum, r) => sum + r.durationMs, 0) / all.length)
                : 0,
            recentPatterns: [...patternMap.entries()].map(([pattern, data]) => ({
                pattern,
                count: data.count,
                lastSeen: data.lastSeen,
            })),
        };
    }

    /**
     * 获取检测到的模式列表
     */
    getPatterns(): PatternSummary[] {
        return this.getSummary().recentPatterns;
    }

    /**
     * 获取技能效果统计
     */
    getSkillEffectiveness(skillName: string): SkillEffectiveness {
        const all = this.analyticsStore.list();
        const withSkill = all.filter(r => r.skillsUsed.includes(skillName));
        const successes = withSkill.filter(r => r.outcome === 'success');
        return {
            uses: withSkill.length,
            successes: successes.length,
            rate: withSkill.length > 0 ? successes.length / withSkill.length : 0,
        };
    }

    /**
     * 获取历史记录
     */
    getHistory(limit?: number): ExecutionAnalytics[] {
        return this.analyticsStore.list(limit);
    }

    /** 获取 store 实例 */
    get store() { return this.analyticsStore; }
}
