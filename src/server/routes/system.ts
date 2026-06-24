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
import fs from 'fs';
import path from 'path';
import os from 'os';
import {CLIRunnerService} from '../services/cli-runner-service.js';
import {MCPConfigService} from '../services/mcp-config-service.js';
import type {SandboxService} from '../services/sandbox-service.js';
import {ConfigService, type AppConfig} from '../services/config-service.js';
import {detectInstalledProviders, getProvider} from '../services/cli-providers';
import {getErrorMessage} from '../utils/error-utils.js';

/** Claude Code settings.json 路径 */
const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), '.claude', 'settings.json');
/** Codex config.toml 路径 */
const CODEX_CONFIG_FILE = path.join(os.homedir(), '.codex', 'config.toml');

/**
 * 从 Claude Code settings.json 的 env 解析模型档位映射
 * 返回 [{tier, label, model}] —— tier 为 SDK 可识别的别名
 */
function readClaudeModelTiers(): Array<{tier: string; label: string; model: string}> {
    const result: Array<{tier: string; label: string; model: string}> = [];
    try {
        if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return result;
        const raw = fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8');
        const settings = JSON.parse(raw) as {env?: Record<string, string>};
        const env = settings.env ?? {};
        const tiers: Array<[string, string, string]> = [
            ['haiku', 'Haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
            ['sonnet', 'Sonnet', 'ANTHROPIC_DEFAULT_SONNET_MODEL'],
            ['opus', 'Opus', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
        ];
        for (const [tier, label, envKey] of tiers) {
            const model = env[envKey];
            if (model) result.push({tier, label, model});
        }
    } catch { /* ignore */ }
    return result;
}

/**
 * 从 Codex config.toml 解析当前配置的模型
 * 读取顶层 model = "xxx" 字段
 */
function readCodexModel(): string | null {
    try {
        if (!fs.existsSync(CODEX_CONFIG_FILE)) return null;
        const raw = fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
        // 简单解析顶层 model = "xxx"（在第一个 [section] 之前）
        const sectionIdx = raw.indexOf('\n[');
        const head = sectionIdx >= 0 ? raw.slice(0, sectionIdx) : raw;
        const match = head.match(/^model\s*=\s*"([^"]+)"/m);
        return match ? match[1] : null;
    } catch { /* ignore */ }
    return null;
}

/**
 * 创建系统状态路由实例
 *
 * @param cliRunnerService - CLI 运行器服务实例
 * @param mcpConfigService - MCP 配置服务实例
 * @param sandboxService - 沙箱服务实例（可选）
 * @returns 配置好路由的 Express Router
 */
export function createSystemRoutes(
    cliRunnerService: CLIRunnerService,
    mcpConfigService: MCPConfigService,
    sandboxService?: SandboxService
): Router {
    const router = Router();

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

            res.json({
                configured: config.cliProvider?.setupCompleted ?? false,
                active: config.cliProvider?.active ?? 'claude',
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

            if (!providerId || (providerId !== 'claude' && providerId !== 'codex')) {
                res.status(400).json({code: 'INVALID_PROVIDER', message: 'providerId must be "claude" or "codex"'});
                return;
            }

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

            // 持久化选择到 config
            const configService = new ConfigService();
            let config: AppConfig;
            try {
                config = configService.load();
            } catch {
                config = configService.getDefaultConfig();
            }

            config.cliProvider = {
                active: providerId,
                setupCompleted: true,
                ...config.cliProvider,
            };
            configService.save(config);

            // 切换运行时 Provider
            await cliRunnerService.switchProvider(providerId);

            // 读取对应 Provider 的 skills 和 MCP 配置
            const skills = await provider.loadSkills();
            const mcpServers = await provider.loadMcpServers();

            res.json({
                success: true,
                provider: {id: provider.id, label: provider.label},
                skills,
                mcpServers,
            });
        } catch (err) {
            res.status(500).json({code: 'PROVIDER_SELECT_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/available-models - 读取配置文件中的可用模型列表
    // Claude: settings.json 的 3 个模型档位映射
    // Codex: config.toml 的当前 model
    router.get('/available-models', (_req, res) => {
        try {
            res.json({
                claude: readClaudeModelTiers(),
                codex: readCodexModel(),
            });
        } catch (err) {
            res.status(500).json({code: 'MODEL_LIST_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/system/model-config - 获取当前模型配置
    router.get('/model-config', (_req, res) => {
        try {
            const configService = new ConfigService();
            const config = configService.load();
            const activeProvider = config.cliProvider?.active || 'claude';

            res.json({
                activeProvider,
                claude: config.cliProvider?.claude || {
                    model: 'claude-sonnet-4-20250514',
                    extendedThinking: true,
                    reasoningEffort: 'high',
                    streaming: true,
                },
                codex: config.cliProvider?.codex || {
                    model: 'codex-mini-latest',
                    streaming: true,
                },
            });
        } catch (err) {
            res.status(500).json({code: 'CONFIG_ERROR', message: getErrorMessage(err)});
        }
    });

    // PUT /api/system/model-config - 更新模型配置
    router.put('/model-config', async (req, res) => {
        try {
            const {provider, claude, codex} = req.body as {
                provider?: 'claude' | 'codex';
                claude?: {
                    model?: string;
                    extendedThinking?: boolean;
                    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
                    streaming?: boolean;
                    maxTokens?: number;
                };
                codex?: {
                    model?: string;
                    streaming?: boolean;
                    maxTokens?: number;
                };
            };

            const configService = new ConfigService();
            const config = configService.load();

            // 更新 Provider（如果指定）
            if (provider && (provider === 'claude' || provider === 'codex')) {
                config.cliProvider = {...config.cliProvider, active: provider};
            }

            // 更新 Claude 配置
            if (claude) {
                config.cliProvider = {
                    ...config.cliProvider,
                    claude: {...config.cliProvider?.claude, ...claude},
                };
            }

            // 更新 Codex 配置
            if (codex) {
                config.cliProvider = {
                    ...config.cliProvider,
                    codex: {...config.cliProvider?.codex, ...codex},
                };
            }

            configService.save(config);

            // 如果切换了 Provider，通知 CLI Runner
            if (provider && provider !== config.cliProvider?.active) {
                await cliRunnerService.switchProvider(provider);
            }

            res.json({success: true, config: config.cliProvider});
        } catch (err) {
            res.status(500).json({code: 'CONFIG_UPDATE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
