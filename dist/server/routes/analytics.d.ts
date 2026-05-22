/**
 * @file 分析数据 API 路由
 * @module routes/analytics
 * @description 提供执行分析和记忆系统的 RESTful API。
 */
import { Router } from 'express';
import type { AnalyticsService } from '../services/analytics-service.js';
import type { MemoryService } from '../services/memory/memory-service.js';
/**
 * 创建分析数据路由
 * @param analyticsService - 分析服务实例
 * @param memoryService - 记忆服务实例（可选）
 */
export declare function createAnalyticsRoutes(analyticsService: AnalyticsService, memoryService?: MemoryService): Router;
//# sourceMappingURL=analytics.d.ts.map