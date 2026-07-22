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

import {Router} from 'express';
import {MCPConfigService} from '../services/mcp-config-service.js';
import type {CLIRunnerService} from '../services/cli-runner-service.js';
import {validateBody} from '../middleware/validation.js';
import {getErrorMessage} from '../utils/error-utils.js';

/**
 * 创建 MCP 服务器配置路由实例
 *
 * @param mcpConfigService - MCP 配置服务实例，负责 MCP 服务器配置的持久化管理与连接测试
 * @param cliRunnerService - CLI 运行器服务实例，用于从 active provider 读取 MCP 配置
 * @returns 配置好所有 MCP 服务器相关路由的 Express Router 实例
 */
export function createMCPServersRoutes(mcpConfigService: MCPConfigService, cliRunnerService: CLIRunnerService): Router {
    const router = Router();

    // GET /api/mcp-servers - 获取所有已配置的 MCP 服务器列表
    // 从当前活跃的 CLI Provider 读取配置
    router.get('/', async (_req, res) => {
        try {
            const provider = cliRunnerService.getProvider();
            const servers = await provider.loadMcpServers();
            res.json(servers);
        } catch (err) {
            res.status(500).json({code: 'MCP_CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/mcp-servers - 添加新的 MCP 服务器配置
    // 请求体需包含 name（服务器名称）和 command（启动命令）两个必填字段
    router.post('/', validateBody([
        {field: 'name', required: true, type: 'string'},
        {field: 'command', required: true, type: 'string'},
    ]), (req, res) => {
        try {
            const rawArgs = req.body.args;
            const rawEnv = req.body.env;

            // 校验 args 必须是字符串数组（如果提供）
            let args: string[] = [];
            if (rawArgs !== undefined && rawArgs !== null) {
                if (!Array.isArray(rawArgs) || rawArgs.some(a => typeof a !== 'string')) {
                    res.status(400).json({code: 'VALIDATION_ERROR', message: 'args must be an array of strings'});
                    return;
                }
                args = rawArgs;
            }

            // 校验 env 必须是字符串键值对象（如果提供）
            let env: Record<string, string> = {};
            if (rawEnv !== undefined && rawEnv !== null) {
                if (typeof rawEnv !== 'object' || Array.isArray(rawEnv)) {
                    res.status(400).json({code: 'VALIDATION_ERROR', message: 'env must be an object'});
                    return;
                }
                for (const [k, v] of Object.entries(rawEnv)) {
                    if (typeof v !== 'string') {
                        res.status(400).json({code: 'VALIDATION_ERROR', message: 'env values must be strings'});
                        return;
                    }
                    env[k] = v;
                }
            }

            // 组装服务器配置对象，为可选字段提供合理的默认值
            const config = {
                name: req.body.name,
                // 服务器类型默认为 'custom'，表示用户自定义的 MCP 服务器
                type: req.body.type ?? 'custom',
                command: req.body.command,
                // 启动参数默认为空数组
                args,
                // 环境变量默认为空对象
                env,
                // 新添加的服务器默认启用
                enabled: req.body.enabled ?? true,
            };
            const server = mcpConfigService.add(config);
            // 创建成功返回 201 Created 状态码
            res.status(201).json(server);
        } catch (err) {
            // 配置添加失败通常是因为名称冲突或参数校验不通过，返回 400
            res.status(400).json({code: 'MCP_CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // PUT /api/mcp-servers/:name - 更新指定 MCP 服务器的配置
    // 请求体中仅需包含需要更新的字段，支持部分更新
    router.put('/:name', (req, res) => {
        try {
            const server = mcpConfigService.update(req.params.name, req.body);
            res.json(server);
        } catch (err) {
            res.status(400).json({code: 'MCP_CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // DELETE /api/mcp-servers/:name - 删除指定 MCP 服务器配置
    router.delete('/:name', (req, res) => {
        try {
            const deleted = mcpConfigService.delete(req.params.name);
            if (!deleted) {
                // 尝试删除不存在的服务器时返回 404
                res.status(404).json({code: 'NOT_FOUND', message: `MCP Server "${req.params.name}" not found`});
                return;
            }
            res.json({success: true});
        } catch (err) {
            res.status(500).json({code: 'MCP_CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/mcp-servers/:name/test - 测试指定 MCP 服务器的连接可用性
    // 该端点会实际尝试启动 MCP 服务器进程并验证其是否可以正常通信
    router.post('/:name/test', async (req, res) => {
        try {
            const result = await mcpConfigService.testConnection(req.params.name);
            res.json(result);
        } catch (err) {
            // 连接测试失败时返回 500，可能是服务器启动失败或通信超时
            res.status(500).json({code: 'MCP_CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
