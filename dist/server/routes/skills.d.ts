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
import { Router } from 'express';
import { SkillsService } from '../services/skills-service.js';
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
export declare function createSkillsRoutes(skillsService: SkillsService): Router;
//# sourceMappingURL=skills.d.ts.map