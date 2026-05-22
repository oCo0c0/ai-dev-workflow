"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
/**
 * @module analytics-service
 * @description 执行分析引擎
 *
 * 订阅 eventBus 的 execution:complete 和 test:complete 事件，
 * 记录分析数据、检测非平凡模式（连续失败、恢复模式、技能效果），
 * 并通过 eventBus 发出 analytics:pattern 事件供 SkillDerivationService 消费。
 */
const event_bus_js_1 = require("../event-bus.js");
const analytics_store_service_js_1 = require("./analytics-store-service.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 执行分析服务
 */
class AnalyticsService {
    analyticsStore;
    memoryService;
    constructor(analyticsStore, memoryService) {
        this.analyticsStore = analyticsStore ?? new analytics_store_service_js_1.AnalyticsStoreService();
        this.memoryService = memoryService;
        this.registerListeners();
    }
    registerListeners() {
        event_bus_js_1.eventBus.onEvent('execution:complete', (data) => this.handleExecutionComplete(data));
        event_bus_js_1.eventBus.onEvent('test:complete', (data) => this.handleTestComplete(data));
    }
    /**
     * 处理执行完成事件
     */
    handleExecutionComplete(data) {
        try {
            const payload = data;
            if (!payload?.executionId)
                return;
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
        }
        catch (err) {
            console.error(`[analytics] handleExecutionComplete error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    /**
     * 处理测试完成事件
     */
    handleTestComplete(data) {
        try {
            const payload = data;
            if (!payload?.taskId)
                return;
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
        }
        catch (err) {
            console.error(`[analytics] handleTestComplete error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    /**
     * 模式检测
     *
     * 规则：
     * 1. 同 workspace 连续失败 > 2 次 → repeated-failure
     * 2. 单个 Skill 成功率 < 40%（近 10 次） → skill-ineffective
     */
    detectPatterns(record) {
        if (!record.workspacePath)
            return;
        // 规则 1: 连续失败检测
        const recent = this.analyticsStore.getByWorkspace(record.workspacePath, 5);
        const recentFailures = recent.filter(r => r.outcome === 'failure');
        if (recentFailures.length >= 3 && record.outcome === 'failure') {
            event_bus_js_1.eventBus.emit('analytics:pattern', {
                pattern: 'repeated-failure',
                analyticsIds: recentFailures.map(r => r.id),
                workspacePath: record.workspacePath,
                description: `${recentFailures.length} consecutive failures in ${record.workspacePath}`,
            });
        }
        // 规则 2: 恢复模式检测（失败后有成功）
        if (record.outcome === 'success' && recent.length >= 2) {
            const previousFailure = recent.find(r => r.outcome === 'failure');
            if (previousFailure) {
                event_bus_js_1.eventBus.emit('analytics:pattern', {
                    pattern: 'recovery-insight',
                    analyticsIds: [previousFailure.id, record.id],
                    workspacePath: record.workspacePath,
                    description: 'Recovery after failure detected',
                });
            }
        }
    }
    // === 公开查询 API ===
    /**
     * 获取分析概览
     */
    getSummary() {
        const all = this.analyticsStore.list();
        const successes = all.filter(r => r.outcome === 'success');
        const failures = all.filter(r => r.outcome === 'failure');
        const withPattern = all.filter(r => r.pattern);
        // 汇总模式
        const patternMap = new Map();
        for (const r of withPattern) {
            const p = r.pattern;
            const existing = patternMap.get(p);
            if (existing) {
                existing.count++;
                existing.lastSeen = r.timestamp;
            }
            else {
                patternMap.set(p, { count: 1, lastSeen: r.timestamp });
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
    getPatterns() {
        return this.getSummary().recentPatterns;
    }
    /**
     * 获取技能效果统计
     */
    getSkillEffectiveness(skillName) {
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
    getHistory(limit) {
        return this.analyticsStore.list(limit);
    }
    /** 获取 store 实例 */
    get store() { return this.analyticsStore; }
}
exports.AnalyticsService = AnalyticsService;
//# sourceMappingURL=analytics-service.js.map