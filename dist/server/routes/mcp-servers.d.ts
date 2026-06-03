/**
 * @file mcp-servers.ts
 * @description MCP 服务器配置路由模块
 *
 * 本模块定义了与 MCP（Model Context Protocol）服务器配置相关的 RESTful API 路由，
 * 提供 MCP 服务器的注册、更新、删除、查询及连接测试功能。
 * MCP 服务器为 Claude 提供外部工具与数据源的接入能力。
 *
 * 路由前缀：/api/mcp-servers
 *
 * 端点列表：
 * - GET    /              获取所有已配置的 MCP 服务器列表
 * - POST   /              添加新的 MCP 服务器配置
 * - PUT    /:name         更新指定 MCP 服务器的配置
 * - DELETE /:name         删除指定 MCP 服务器配置
 * - POST   /:name/test    测试指定 MCP 服务器的连接可用性
 */
import { Router } from 'express';
import { MCPConfigService } from '../services/mcp-config-service.js';
import type { CLIRunnerService } from '../services/cli-runner-service.js';
/**
 * 创建 MCP 服务器配置路由实例
 *
 * @param mcpConfigService - MCP 配置服务实例，负责 MCP 服务器配置的持久化管理与连接测试
 * @param cliRunnerService - CLI 运行器服务实例，用于从 active provider 读取 MCP 配置
 * @returns 配置好所有 MCP 服务器相关路由的 Express Router 实例
 */
export declare function createMCPServersRoutes(mcpConfigService: MCPConfigService, cliRunnerService: CLIRunnerService): Router;
//# sourceMappingURL=mcp-servers.d.ts.map