/**
 * @file 需求管理路由模块
 * @module routes/requirements
 * @description 提供需求相关的 RESTful API 路由，包括本地需求存储管理、
 *              通过 MCP（Model Context Protocol）桥接服务获取需求详情与搜索功能。
 *              支持从 MCP 服务器拉取需求并自动保存到本地存储，也支持纯查询模式。
 */
import { Router } from 'express';
import { MCPBridgeService } from '../services/mcp-bridge-service.js';
import { RequirementStoreService } from '../services/requirement-store-service.js';
/**
 * 创建需求管理路由
 * @param mcpBridgeService - MCP 桥接服务实例，用于与外部需求管理系统通信
 * @param requirementStore - 需求本地存储服务实例，用于持久化已保存的需求
 * @returns 配置好的 Express Router 实例
 *
 * @example
 * ```ts
 * const router = createRequirementsRoutes(mcpBridge, requirementStore);
 * app.use('/api/requirements', router);
 * ```
 */
export declare function createRequirementsRoutes(mcpBridgeService: MCPBridgeService, requirementStore: RequirementStoreService): Router;
//# sourceMappingURL=requirements.d.ts.map