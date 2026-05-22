"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSystemRoutes = createSystemRoutes;
const express_1 = require("express");
const config_service_js_1 = require("../services/config-service.js");
const index_js_1 = require("../services/cli-providers/index.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 创建系统状态路由实例
 *
 * @param cliRunnerService - CLI 运行器服务实例
 * @param mcpConfigService - MCP 配置服务实例
 * @param sandboxService - 沙箱服务实例（可选）
 * @returns 配置好路由的 Express Router
 */
function createSystemRoutes(cliRunnerService, mcpConfigService, sandboxService) {
    const router = (0, express_1.Router)();
    // GET /api/system/status - 获取系统综合状态信息
    router.get('/status', async (_req, res) => {
        try {
            const cliInfo = await cliRunnerService.checkAvailability();
            const mcpServers = mcpConfigService.list().map(s => ({
                name: s.name,
                status: s.status ?? 'disconnected',
            }));
            res.json({
                claudeCodeAvailable: cliInfo.available,
                claudeCodeVersion: cliInfo.version,
                activeProvider: cliRunnerService.getActiveProviderId(),
                mcpServers,
                configPath: mcpConfigService.getSettingsFile(),
                uptime: process.uptime(),
                sandbox: sandboxService?.getStatus() ?? { enabled: false, apiUrl: '', activeCount: 0 },
            });
        }
        catch (err) {
            res.status(500).json({ code: 'SYSTEM_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/system/sandbox - 获取沙箱详细信息
    router.get('/sandbox', async (_req, res) => {
        if (!sandboxService) {
            res.json({ enabled: false });
            return;
        }
        try {
            const status = sandboxService.getStatus();
            const sandboxes = await sandboxService.listActive();
            res.json({ ...status, sandboxes });
        }
        catch (err) {
            res.status(500).json({ code: 'SANDBOX_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/system/cli-provider/status - 获取 CLI Provider 状态
    // 检测所有已安装的 CLI，返回配置状态和可用列表
    router.get('/cli-provider/status', async (_req, res) => {
        try {
            const configService = new config_service_js_1.ConfigService();
            let config;
            try {
                config = configService.load();
            }
            catch {
                config = configService.getDefaultConfig();
            }
            const detected = await (0, index_js_1.detectInstalledProviders)();
            res.json({
                configured: config.cliProvider?.setupCompleted ?? false,
                active: config.cliProvider?.active ?? 'claude',
                detected,
            });
        }
        catch (err) {
            res.status(500).json({ code: 'PROVIDER_STATUS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/system/cli-provider/select - 选择 CLI Provider
    // 首次引导或切换 Provider 时调用
    router.post('/cli-provider/select', async (req, res) => {
        try {
            const { providerId } = req.body;
            if (!providerId || (providerId !== 'claude' && providerId !== 'codex')) {
                res.status(400).json({ code: 'INVALID_PROVIDER', message: 'providerId must be "claude" or "codex"' });
                return;
            }
            // 检测选择的 Provider 是否可用
            const provider = (0, index_js_1.getProvider)(providerId);
            if (!provider) {
                res.status(404).json({ code: 'PROVIDER_NOT_FOUND', message: `Provider "${providerId}" not found` });
                return;
            }
            const status = await provider.detect();
            if (!status.available) {
                res.status(400).json({
                    code: 'PROVIDER_UNAVAILABLE',
                    message: status.error ?? `${provider.label} is not available`,
                });
                return;
            }
            // 持久化选择到 config
            const configService = new config_service_js_1.ConfigService();
            let config;
            try {
                config = configService.load();
            }
            catch {
                config = configService.getDefaultConfig();
            }
            config.cliProvider = {
                active: providerId,
                setupCompleted: true,
            };
            configService.save(config);
            // 切换运行时 Provider
            await cliRunnerService.switchProvider(providerId);
            // 读取对应 Provider 的 skills 和 MCP 配置
            const skills = await provider.loadSkills();
            const mcpServers = await provider.loadMcpServers();
            res.json({
                success: true,
                provider: { id: provider.id, label: provider.label },
                skills,
                mcpServers,
            });
        }
        catch (err) {
            res.status(500).json({ code: 'PROVIDER_SELECT_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    return router;
}
//# sourceMappingURL=system.js.map