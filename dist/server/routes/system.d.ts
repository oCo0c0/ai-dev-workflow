/**
 * @file system.ts
 * @description 系统状态路由模块
 *
 * 本模块定义了与系统运行状态相关的 RESTful API 路由，提供：
 * - 系统健康检查（CLI 可用性、MCP 状态、沙箱状态）
 * - CLI Provider 状态查询（检测已安装的 CLI、当前配置）
 * - CLI Provider 选择（首次引导流程、持久化选择）
 *
 * 路由前缀：/api/system
 *
 * 端点列表：
 * - GET  /status              获取系统综合状态信息
 * - GET  /cli-provider/status 获取 CLI Provider 状态
 * - POST /cli-provider/select 选择 CLI Provider（首次引导）
 */
import { Router } from 'express';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { MCPConfigService } from '../services/mcp-config-service.js';
import type { SandboxService } from '../services/sandbox-service.js';
/**
 * 创建系统状态路由实例
 *
 * @param cliRunnerService - CLI 运行器服务实例
 * @param mcpConfigService - MCP 配置服务实例
 * @param sandboxService - 沙箱服务实例（可选）
 * @returns 配置好路由的 Express Router
 */
export declare function createSystemRoutes(cliRunnerService: CLIRunnerService, mcpConfigService: MCPConfigService, sandboxService?: SandboxService): Router;
//# sourceMappingURL=system.d.ts.map