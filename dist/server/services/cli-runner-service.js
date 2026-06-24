"use strict";
/**
 * @module cli-runner-service
 * @description CLI 运行器服务模块（Facade 模式）
 *
 * 作为 CLI Provider 的统一门面，对外保持原有接口不变（checkAvailability / runBridge），
 * 内部委托给当前激活的 CLIProvider 实现（Claude Code / OpenAI Codex）。
 *
 * 支持运行时切换 Provider，首次启动时通过引导流程选择。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIRunnerService = void 0;
const error_utils_js_1 = require("../utils/error-utils.js");
const index_js_1 = require("./cli-providers/index.js");
const config_service_js_1 = require("./config-service.js");
// === CLI 运行器服务（Facade） ===
/**
 * CLI 运行器服务类
 *
 * Facade 模式：对外保持原有 API 不变，内部委托给 CLIProvider 实现。
 * 支持通过构造函数指定初始 Provider，支持运行时切换。
 */
class CLIRunnerService {
    /** 当前激活的 Provider */
    provider;
    /** 当前 Provider ID */
    activeProviderId;
    /**
     * 构造 CLI 运行器服务
     * @param activeProviderId - 初始 Provider ID，默认 'claude'
     */
    constructor(activeProviderId = 'claude') {
        this.activeProviderId = activeProviderId;
        const provider = (0, index_js_1.getProvider)(activeProviderId);
        if (!provider) {
            // fallback 到 claude
            this.provider = (0, index_js_1.getProvider)('claude');
            this.activeProviderId = 'claude';
        }
        else {
            this.provider = provider;
        }
        // 预热：非阻塞启动 Provider
        this.provider.initialize().catch(() => {
            // 启动失败时静默忽略，首次实际请求时会重试
        });
    }
    /**
     * 获取当前激活的 Provider ID
     */
    getActiveProviderId() {
        return this.activeProviderId;
    }
    /**
     * 获取当前激活的 Provider
     */
    getProvider() {
        return this.provider;
    }
    /**
     * 切换到指定的 Provider
     * @param providerId - 目标 Provider ID
     */
    async switchProvider(providerId) {
        const newProvider = (0, index_js_1.getProvider)(providerId);
        if (!newProvider) {
            throw new Error(`Unknown CLI provider: ${providerId}`);
        }
        // 释放当前 Provider 资源
        try {
            await this.provider.dispose();
        }
        catch { /* ignore dispose errors */ }
        this.provider = newProvider;
        this.activeProviderId = providerId;
        // 初始化新 Provider
        await this.provider.initialize();
    }
    /**
     * 检查 CLI 是否可用
     * @returns CLI 可用性信息
     */
    async checkAvailability() {
        try {
            await this.provider.initialize();
            const status = await this.provider.detect();
            return {
                available: status.available,
                version: status.version,
                path: status.path,
                error: status.error,
            };
        }
        catch (err) {
            return { available: false, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    /**
     * 通过当前 Provider 发送执行请求
     *
     * @param input - 执行输入参数
     * @param options - 可选的运行器配置
     * @returns 执行结果
     */
    async runBridge(input, options) {
        // 从配置文件读取当前 Provider 的模型配置并注入到 options
        let modelOptions = {};
        try {
            const configService = new config_service_js_1.ConfigService();
            const config = configService.load();
            if (this.activeProviderId === 'claude' && config.cliProvider?.claude) {
                modelOptions = {
                    model: config.cliProvider.claude.model,
                    reasoningEffort: config.cliProvider.claude.reasoningEffort,
                    extendedThinking: config.cliProvider.claude.extendedThinking,
                    streaming: config.cliProvider.claude.streaming,
                };
            }
            else if (this.activeProviderId === 'codex' && config.cliProvider?.codex) {
                modelOptions = {
                    model: config.cliProvider.codex.model,
                    streaming: config.cliProvider.codex.streaming,
                };
            }
        }
        catch {
            // 配置读取失败时使用 Provider 默认行为
        }
        const result = await this.provider.run({
            prompt: input.prompt,
            cwd: input.cwd,
            sessionId: input.sessionId,
            maxTurns: input.maxTurns,
            skills: input.skills,
        }, {
            workspacePath: options?.workspacePath,
            signal: options?.signal,
            onOutput: options?.onOutput,
            onError: options?.onError,
            ...modelOptions,
        });
        return {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr ?? '',
            aborted: result.aborted ?? false,
            sessionId: result.sessionId,
        };
    }
    /**
     * 释放资源
     */
    async dispose() {
        await this.provider.dispose();
    }
}
exports.CLIRunnerService = CLIRunnerService;
//# sourceMappingURL=cli-runner-service.js.map