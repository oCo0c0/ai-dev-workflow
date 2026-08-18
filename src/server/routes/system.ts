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

import {Router} from 'express';
import {CLIRunnerService, CUSTOM_MODEL_ENGINE_ID} from '../services/cli-runner-service.js';
import {MCPRegistryService} from '../services/mcp-registry-service.js';
import type {SandboxService} from '../services/sandbox-service.js';
import {ConfigService, validateConfig, type AppConfig} from '../services/config-service.js';
import {detectInstalledProviders, getProvider, isBuiltinProviderId, getBuiltinProviderIds, getAllProviders, DEFAULT_PROVIDER_ID} from '../services/cli-providers';
import type {ProviderModelSettings} from '../services/cli-providers';
import {ModelProviderStore} from '../services/model-provider-store.js';
import {getErrorMessage} from '../utils/error-utils.js';

/**
 * 创建系统状态路由实例
 *
 * @param cliRunnerService - CLI 运行器服务实例
 * @param mcpRegistryService - MCP 注册中心服务（adw 自有数据源）
 * @param sandboxService - 沙箱服务实例（可选）
 * @returns 配置好路由的 Express Router
 */
export function createSystemRoutes(
    cliRunnerService: CLIRunnerService,
    mcpRegistryService: MCPRegistryService,
    sandboxService?: SandboxService
): Router {
    const router = Router();

    // GET /api/system/status - 获取系统综合状态信息
    router.get('/status', async (_req, res) => {
        try {
            const cliInfo = await cliRunnerService.checkAvailability();
            const mcpServers = mcpRegistryService.list().map(s => ({
                name: s.name,
                status: s.status ?? 'disconnected',
            }));

            res.json({
                claudeCodeAvailable: cliInfo.available,
                claudeCodeVersion: cliInfo.version,
                activeProvider: cliRunnerService.getActiveProviderId(),
                mcpServers,
                configPath: mcpRegistryService.getRegistryFile(),
                uptime: process.uptime(),
                sandbox: sandboxService?.getStatus() ?? {enabled: false, apiUrl: '', activeCount: 0},
            });
        } catch (err) {
            res.status(500).json({code: 'SYSTEM_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/sandbox - 获取沙箱详细信息
    router.get('/sandbox', async (_req, res) => {
        if (!sandboxService) {
            res.json({enabled: false});
            return;
        }
        try {
            const status = sandboxService.getStatus();
            const sandboxes = await sandboxService.listActive();
            res.json({...status, sandboxes});
        } catch (err) {
            res.status(500).json({code: 'SANDBOX_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/cli-provider/status - 获取 CLI Provider 状态
    // 检测所有已安装的 CLI，返回配置状态和可用列表
    router.get('/cli-provider/status', async (_req, res) => {
        try {
            const configService = new ConfigService();
            let config: AppConfig;
            try {
                config = configService.load();
            } catch {
                config = configService.getDefaultConfig();
            }

            const detected = await detectInstalledProviders();

            // 合并 models.json 中的自定义供应商记录（kind='custom' 且启用），作为可选 Provider
            try {
                const store = new ModelProviderStore();
                const customs = store.listSafe().filter((r) => r.kind === 'custom' && r.enabled);
                for (const r of customs) {
                    detected.push({
                        id: r.id,
                        label: r.label || r.id,
                        available: !!(r.hasApiKey && r.baseUrl && r.models.length > 0),
                        version: 'custom',
                        path: r.baseUrl,
                        error: !r.hasApiKey || !r.baseUrl || r.models.length === 0
                            ? '需配置 API Key、Base URL 和至少一个模型'
                            : undefined,
                        meta: {
                            kind: 'custom',
                            models: r.models,
                            defaultModel: r.defaultModel,
                        },
                    });
                }
            } catch { /* custom 读取失败不影响内置列表 */ }

            res.json({
                configured: config.cliProvider?.setupCompleted ?? false,
                active: config.cliProvider?.active ?? DEFAULT_PROVIDER_ID,
                detected,
            });
        } catch (err) {
            res.status(500).json({code: 'PROVIDER_STATUS_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/system/cli-provider/select - 选择 CLI Provider
    // 首次引导或切换 Provider 时调用
    router.post('/cli-provider/select', async (req, res) => {
        try {
            const {providerId} = req.body as {providerId?: string};

            if (!providerId) {
                res.status(400).json({code: 'INVALID_PROVIDER', message: 'providerId is required'});
                return;
            }

            const isBuiltin = isBuiltinProviderId(providerId);

            // 自定义供应商记录：校验 models.json 中存在且 kind='custom'
            let customLabel = '';
            if (!isBuiltin) {
                let rec;
                try {
                    rec = new ModelProviderStore().get(providerId);
                } catch { /* fallthrough */ }
                if (!rec || rec.kind !== 'custom') {
                    res.status(400).json({code: 'INVALID_PROVIDER', message: `providerId must be one of ${getBuiltinProviderIds().map(id => `"${id}"`).join(', ')}, or a custom provider record id`});
                    return;
                }
                if (rec.enabled === false || !rec.apiKey || !rec.baseUrl) {
                    res.status(400).json({
                        code: 'PROVIDER_UNAVAILABLE',
                        message: 'Custom provider 需启用并配置 API Key 与 Base URL',
                    });
                    return;
                }
                customLabel = rec.label || rec.id;
            }

            if (isBuiltin) {
                // 检测选择的 Provider 是否可用
                const provider = getProvider(providerId);
                if (!provider) {
                    res.status(404).json({code: 'PROVIDER_NOT_FOUND', message: `Provider "${providerId}" not found`});
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
            }

            // 持久化选择到 config
            const configService = new ConfigService();
            let config: AppConfig;
            try {
                config = configService.load();
            } catch {
                config = configService.getDefaultConfig();
            }

            config.cliProvider = {
                ...config.cliProvider,
                active: providerId,
                setupCompleted: true,
            };
            configService.save(config);

            // 切换运行时 Provider（custom 记录经 claude 引擎调用）
            await cliRunnerService.switchProvider(providerId);

            // 读取对应 Provider 的 skills 和 MCP 配置（custom 复用引擎 Provider 的能力）
            const engineProvider = isBuiltin ? getProvider(providerId) : getProvider(CUSTOM_MODEL_ENGINE_ID);
            let skills: Awaited<ReturnType<NonNullable<typeof engineProvider>['loadSkills']>> = [];
            let mcpServers: Awaited<ReturnType<NonNullable<typeof engineProvider>['loadMcpServers']>> = [];
            if (engineProvider) {
                skills = await engineProvider.loadSkills();
                mcpServers = await engineProvider.loadMcpServers();
            }

            res.json({
                success: true,
                provider: {id: providerId, label: customLabel || providerId},
                skills,
                mcpServers,
            });
        } catch (err) {
            res.status(500).json({code: 'PROVIDER_SELECT_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/available-models - 读取各 Provider 本地可提供的模型选项
    // 由 Provider 可选方法 loadModelOptions 提供（如 Claude 档位映射、Codex 当前模型）
    router.get('/available-models', async (_req, res) => {
        try {
            const providers: Record<string, {tiers?: Array<{value: string; label: string; model: string}>; current?: string | null}> = {};
            for (const provider of getAllProviders()) {
                if (!provider.loadModelOptions) continue;
                try {
                    providers[provider.id] = await provider.loadModelOptions();
                } catch { /* 单个 Provider 读取失败不影响其他 */ }
            }
            res.json({providers});
        } catch (err) {
            res.status(500).json({code: 'MODEL_LIST_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/model-config - 获取当前模型配置
    // models 为开放 map：内置 Provider 条目缺失时回退 Provider 自带的默认配置
    router.get('/model-config', (_req, res) => {
        try {
            const config = new ConfigService().load();
            const activeProvider = config.cliProvider?.active || DEFAULT_PROVIDER_ID;
            const stored = config.cliProvider?.models ?? {};

            const models: Record<string, ProviderModelSettings> = {};
            for (const provider of getAllProviders()) {
                models[provider.id] = stored[provider.id] ?? provider.defaultModelSettings ?? {};
            }
            // 保留存储中的非内置 key（如自定义供应商记录 id 的覆盖配置）
            for (const [id, settings] of Object.entries(stored)) {
                if (models[id] === undefined) models[id] = settings;
            }

            res.json({activeProvider, models});
        } catch (err) {
            res.status(500).json({code: 'CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // PUT /api/system/model-config - 更新模型配置
    // body: { provider?, models?: Record<providerId, ProviderModelSettings> }
    // 兼容旧 body { provider?, claude?, codex?, pi? }（自动迁移进 models）
    router.put('/model-config', async (req, res) => {
        try {
            const body = req.body as {
                provider?: string;
                models?: Record<string, ProviderModelSettings>;
                claude?: ProviderModelSettings & {provider?: string};
                codex?: ProviderModelSettings;
                pi?: ProviderModelSettings & {provider?: string};
            };

            // 内置 provider 或有效的 custom 记录 id 才算合法
            const isKnownProvider = (id: string): boolean => {
                if (isBuiltinProviderId(id)) return true;
                try {
                    const rec = new ModelProviderStore().get(id);
                    return !!rec && rec.kind === 'custom' && rec.enabled !== false;
                } catch {
                    return false;
                }
            };

            // 归一化入参：models map + 旧版 claude/codex/pi 字段 → 统一 map（pi 的 provider → modelProvider）
            const incoming: Record<string, ProviderModelSettings> = {};
            if (body.models && typeof body.models === 'object') Object.assign(incoming, body.models);
            for (const legacyId of ['claude', 'codex', 'pi'] as const) {
                const legacy = body[legacyId] as (ProviderModelSettings & {provider?: string}) | undefined;
                if (!legacy || typeof legacy !== 'object') continue;
                const {provider: legacyProvider, ...rest} = legacy;
                incoming[legacyId] = legacyProvider !== undefined ? {...rest, modelProvider: legacyProvider} : rest;
            }

            // 入参校验：复用配置校验器的 ProviderModelSettings 规则
            const validationErrors = validateConfig({cliProvider: {models: incoming}});
            if (validationErrors.length > 0) {
                res.status(400).json({
                    code: 'INVALID_MODEL_CONFIG',
                    message: validationErrors.map(e => `${e.field}: ${e.message}`).join('; '),
                });
                return;
            }

            const configService = new ConfigService();
            const config = configService.load();
            const prevActive = config.cliProvider?.active;

            config.cliProvider = {
                ...config.cliProvider,
                ...(body.provider && isKnownProvider(body.provider) ? {active: body.provider} : {}),
                models: {...config.cliProvider?.models, ...incoming},
            };
            configService.save(config);

            // 如果切换了 Provider，通知 CLI Runner（对比切换前的值）
            if (body.provider && body.provider !== prevActive) {
                await cliRunnerService.switchProvider(body.provider);
            }

            res.json({success: true, config: config.cliProvider});
        } catch (err) {
            res.status(500).json({code: 'CONFIG_UPDATE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
