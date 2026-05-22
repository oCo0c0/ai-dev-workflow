/**
 * @file pipelines.ts
 * @description 工作流管线（Pipeline）路由模块
 *
 * 本模块定义了与工作流管线相关的 RESTful API 路由，提供管线的增删改查以及
 * 默认管线设置功能。管线是由多个有序步骤组成的自动化工作流，用于定义
 * Claude 执行复杂任务时的处理流程。
 *
 * 路由前缀：/api/pipelines
 *
 * 端点列表：
 * - GET  /                        获取所有管线列表
 * - POST /                        创建新的管线
 * - PUT  /:id                     更新指定管线
 * - DELETE /:id                   删除指定管线
 * - POST /:id/set-default         将指定管线设置为默认管线
 */
import { Router } from 'express';
import { PipelineService } from '../services/pipeline-service.js';
/**
 * 创建工作流管线路由实例
 *
 * @param pipelineService - 管线服务实例，负责管线数据的持久化操作与业务逻辑
 * @returns 配置好所有管线相关路由的 Express Router 实例
 *
 * @example
 * ```ts
 * const pipelineRouter = createPipelineRoutes(pipelineService);
 * app.use('/api/pipelines', pipelineRouter);
 * ```
 */
export declare function createPipelineRoutes(pipelineService: PipelineService): Router;
//# sourceMappingURL=pipelines.d.ts.map