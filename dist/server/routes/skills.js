"use strict";
/**
 * @file skills.ts
 * @description 技能（Skills）路由模块
 *
 * 本模块定义了与 AI 技能相关的 RESTful API 路由，提供技能的增删改查（CRUD）功能。
 * 技能是系统中可复用的提示词模板或能力单元，供 Claude 在对话中调用。
 *
 * 路由前缀：/api/skills
 *
 * 端点列表：
 * - GET    /              获取所有技能列表
 * - GET    /:name         根据名称获取技能详情
 * - POST   /              创建新技能
 * - PUT    /:name         更新指定技能
 * - DELETE /:name         删除指定技能
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSkillsRoutes = createSkillsRoutes;
const express_1 = require("express");
const validation_js_1 = require("../middleware/validation.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 创建技能路由实例
 *
 * @param skillsService - 技能服务实例，负责技能数据的持久化操作与业务逻辑
 * @returns 配置好所有技能相关路由的 Express Router 实例
 *
 * @example
 * ```ts
 * const skillsRouter = createSkillsRoutes(skillsService);
 * app.use('/api/skills', skillsRouter);
 * ```
 */
function createSkillsRoutes(skillsService) {
    const router = (0, express_1.Router)();
    // GET /api/skills - 获取所有技能列表
    router.get('/', (_req, res) => {
        try {
            const skills = skillsService.list();
            res.json(skills);
        }
        catch (err) {
            // 服务端内部错误，返回统一的错误响应格式
            res.status(500).json({ code: 'SKILLS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/skills/:name - 根据名称获取技能详情
    router.get('/:name', (req, res) => {
        try {
            const skill = skillsService.get(req.params.name);
            if (!skill) {
                // 技能不存在时返回 404 状态码
                res.status(404).json({ code: 'NOT_FOUND', message: `Skill "${req.params.name}" not found` });
                return;
            }
            res.json(skill);
        }
        catch (err) {
            res.status(500).json({ code: 'SKILLS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/skills - 创建新技能
    // 请求体需包含 name（技能名称）和 content（技能内容）两个必填字段
    router.post('/', (0, validation_js_1.validateBody)([
        { field: 'name', required: true, type: 'string' },
        { field: 'content', required: true, type: 'string' },
    ]), (req, res) => {
        try {
            const { name, content } = req.body;
            const skill = skillsService.create(name, content);
            // 创建成功返回 201 Created 状态码
            res.status(201).json(skill);
        }
        catch (err) {
            // 创建失败通常是因为业务校验不通过（如名称冲突），返回 400
            res.status(400).json({ code: 'SKILLS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // PUT /api/skills/:name - 更新指定技能的内容
    // 仅更新 content 字段，技能名称（URL 路径参数）不可更改
    router.put('/:name', (0, validation_js_1.validateBody)([
        { field: 'content', required: true, type: 'string' },
    ]), (req, res) => {
        try {
            const skill = skillsService.update(req.params.name, req.body.content);
            res.json(skill);
        }
        catch (err) {
            res.status(400).json({ code: 'SKILLS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // DELETE /api/skills/:name - 删除指定技能
    router.delete('/:name', (req, res) => {
        try {
            const deleted = skillsService.delete(req.params.name);
            if (!deleted) {
                // 尝试删除不存在的技能时返回 404
                res.status(404).json({ code: 'NOT_FOUND', message: `Skill "${req.params.name}" not found` });
                return;
            }
            res.json({ success: true });
        }
        catch (err) {
            res.status(500).json({ code: 'SKILLS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    return router;
}
//# sourceMappingURL=skills.js.map