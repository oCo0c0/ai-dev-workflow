"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPipelineRoutes = createPipelineRoutes;
const express_1 = require("express");
const validation_js_1 = require("../middleware/validation.js");
const error_utils_js_1 = require("../utils/error-utils.js");
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
function createPipelineRoutes(pipelineService) {
    const router = (0, express_1.Router)();
    // GET /api/pipelines - 获取所有管线列表
    router.get('/', (_req, res) => {
        try {
            const pipelines = pipelineService.list();
            res.json(pipelines);
        }
        catch (err) {
            res.status(500).json({ code: 'PIPELINE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/pipelines - 创建新的管线
    // 请求体需包含 name（管线名称）和 steps（管线步骤定义）两个必填字段
    router.post('/', (0, validation_js_1.validateBody)([
        { field: 'name', required: true, type: 'string' },
        { field: 'steps', required: true, type: 'object' },
    ]), (req, res) => {
        try {
            const pipeline = pipelineService.create(req.body);
            // 创建成功返回 201 Created 状态码
            res.status(201).json(pipeline);
        }
        catch (err) {
            // 创建失败通常是因为业务校验不通过（如名称冲突或步骤定义非法），返回 400
            res.status(400).json({ code: 'PIPELINE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // PUT /api/pipelines/:id - 更新指定管线的配置
    // 请求体中仅需包含需要更新的字段，支持部分更新
    router.put('/:id', (req, res) => {
        try {
            const pipeline = pipelineService.update(req.params.id, req.body);
            res.json(pipeline);
        }
        catch (err) {
            res.status(400).json({ code: 'PIPELINE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // DELETE /api/pipelines/:id - 删除指定管线
    router.delete('/:id', (req, res) => {
        try {
            const deleted = pipelineService.delete(req.params.id);
            if (!deleted) {
                // 尝试删除不存在的管线时返回 404
                res.status(404).json({ code: 'NOT_FOUND', message: 'Pipeline not found' });
                return;
            }
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ code: 'PIPELINE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/pipelines/:id/set-default - 将指定管线设置为默认管线
    // 默认管线是系统在无特定指定时自动使用的管线
    router.post('/:id/set-default', (req, res) => {
        try {
            pipelineService.setDefault(req.params.id);
            res.json({ success: true });
        }
        catch (err) {
            // 设置失败通常是因为指定的管线 ID 不存在
            res.status(400).json({ code: 'PIPELINE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    return router;
}
//# sourceMappingURL=pipelines.js.map