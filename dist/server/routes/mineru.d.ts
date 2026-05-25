/**
 * @file mineru.ts
 * @description MinerU 文档解析路由模块
 *
 * 提供 MinerU 文档解析的 RESTful API，支持：
 * - 同步文件解析（上传文件，等待结果）
 * - 异步任务提交和查询
 * - 健康检查
 *
 * 路由前缀：/api/mineru
 *
 * 端点列表：
 * - GET  /status       — MinerU 服务状态和健康检查
 * - POST /parse        — 同步解析（上传文件，等待结果）
 * - POST /tasks        — 异步解析（提交任务，返回 task_id）
 * - GET  /tasks/:id    — 查询任务状态
 * - GET  /tasks/:id/result — 获取任务结果
 */
import { Router } from 'express';
import type { MinerUService } from '../services/mineru-service.js';
/**
 * 创建 MinerU 路由实例
 *
 * @param mineruService - MinerU 服务实例
 * @returns 配置好路由的 Express Router
 */
export declare function createMinerURoutes(mineruService: MinerUService): Router;
//# sourceMappingURL=mineru.d.ts.map