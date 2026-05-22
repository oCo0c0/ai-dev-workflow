/**
 * @file 分析数据 API 路由
 * @module routes/analytics
 * @description 提供执行分析和记忆系统的 RESTful API。
 */
import {Router} from 'express';
import type {AnalyticsService} from '../services/analytics-service.js';
import type {MemoryService} from '../services/memory/memory-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

/**
 * 创建分析数据路由
 * @param analyticsService - 分析服务实例
 * @param memoryService - 记忆服务实例（可选）
 */
export function createAnalyticsRoutes(
    analyticsService: AnalyticsService,
    memoryService?: MemoryService,
): Router {
    const router = Router();

    /**
     * GET /api/analytics/summary
     * @description 获取分析概览（成功率、平均耗时、近期模式）
     */
    router.get('/summary', (_req, res) => {
        try {
            const summary = analyticsService.getSummary();
            res.json(summary);
        } catch (err) {
            res.status(500).json({code: 'ANALYTICS_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * GET /api/analytics/patterns
     * @description 获取检测到的模式列表
     */
    router.get('/patterns', (_req, res) => {
        try {
            const patterns = analyticsService.getPatterns();
            res.json(patterns);
        } catch (err) {
            res.status(500).json({code: 'ANALYTICS_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * GET /api/analytics/skills/:name
     * @description 获取指定技能的效果统计
     */
    router.get('/skills/:name', (req, res) => {
        try {
            const effectiveness = analyticsService.getSkillEffectiveness(req.params.name);
            res.json(effectiveness);
        } catch (err) {
            res.status(500).json({code: 'ANALYTICS_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * GET /api/analytics/history
     * @description 获取分析历史记录
     * @query limit - 返回条数上限（默认 50）
     */
    router.get('/history', (req, res) => {
        try {
            const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
            const history = analyticsService.getHistory(limit);
            res.json(history);
        } catch (err) {
            res.status(500).json({code: 'ANALYTICS_ERROR', message: getErrorMessage(err)});
        }
    });

    // === Memory API ===

    /**
     * GET /api/analytics/memory/profile
     * @description 获取用户画像
     */
    router.get('/memory/profile', (_req, res) => {
        if (!memoryService) {
            res.status(404).json({code: 'NOT_AVAILABLE', message: 'Memory service not enabled'});
            return;
        }
        try {
            res.json(memoryService.getUserProfile());
        } catch (err) {
            res.status(500).json({code: 'MEMORY_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * PUT /api/analytics/memory/profile
     * @description 更新用户画像
     */
    router.put('/memory/profile', (req, res) => {
        if (!memoryService) {
            res.status(404).json({code: 'NOT_AVAILABLE', message: 'Memory service not enabled'});
            return;
        }
        try {
            const updated = memoryService.updateUserProfile(req.body);
            res.json(updated);
        } catch (err) {
            res.status(500).json({code: 'MEMORY_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * GET /api/analytics/memory/project?workspacePath=
     * @description 获取项目特征（不存在时自动收集）
     */
    router.get('/memory/project', (req, res) => {
        if (!memoryService) {
            res.status(404).json({code: 'NOT_AVAILABLE', message: 'Memory service not enabled'});
            return;
        }
        try {
            const workspacePath = req.query.workspacePath as string;
            if (!workspacePath) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'workspacePath is required'});
                return;
            }
            let facts = memoryService.getProjectFacts(workspacePath);
            if (!facts) {
                facts = memoryService.collectProjectFacts(workspacePath) ?? undefined;
            }
            res.json(facts ?? null);
        } catch (err) {
            res.status(500).json({code: 'MEMORY_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * GET /api/analytics/memory/feedback
     * @description 获取反馈日志
     * @query limit - 返回条数上限
     */
    router.get('/memory/feedback', (req, res) => {
        if (!memoryService) {
            res.status(404).json({code: 'NOT_AVAILABLE', message: 'Memory service not enabled'});
            return;
        }
        try {
            const limit = parseInt(req.query.limit as string) || 20;
            res.json(memoryService.getFeedbackLog(limit));
        } catch (err) {
            res.status(500).json({code: 'MEMORY_ERROR', message: getErrorMessage(err)});
        }
    });

    /**
     * POST /api/analytics/memory/feedback
     * @description 添加反馈
     */
    router.post('/memory/feedback', (req, res) => {
        if (!memoryService) {
            res.status(404).json({code: 'NOT_AVAILABLE', message: 'Memory service not enabled'});
            return;
        }
        try {
            const entry = memoryService.addFeedback(req.body);
            res.json(entry);
        } catch (err) {
            res.status(500).json({code: 'MEMORY_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
