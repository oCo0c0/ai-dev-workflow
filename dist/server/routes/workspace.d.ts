/**
 * @file 工作区管理路由模块
 * @module routes/workspace
 * @description 提供工作区（Workspace）相关的 RESTful API 路由，涵盖：
 *              - 已保存工作区的增删改查
 *              - 活动工作区的选择与历史记录
 *              - 目录浏览与文件内容预览
 *              - 跨平台系统原生文件夹选择器
 *              - Git 状态查看与差异对比
 */
import { Router } from 'express';
import { WorkspaceService } from '../services/workspace-service.js';
/**
 * 创建工作区管理路由
 * @param workspaceService - 工作区服务实例，提供工作区的增删改查、浏览、Git 操作等功能
 * @returns 配置好的 Express Router 实例
 *
 * @example
 * ```ts
 * const router = createWorkspaceRoutes(workspaceService);
 * app.use('/api/workspace', router);
 * ```
 */
export declare function createWorkspaceRoutes(workspaceService: WorkspaceService): Router;
//# sourceMappingURL=workspace.d.ts.map