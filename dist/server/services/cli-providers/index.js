"use strict";
/**
 * @module cli-providers
 * @description CLI Provider 注册表和检测服务
 *
 * 管理所有 CLI Provider 的注册、查询和自动检测。
 * 参考 test-providers 的 strategy + registry 模式。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProvider = registerProvider;
exports.getProvider = getProvider;
exports.getAllProviders = getAllProviders;
exports.detectInstalledProviders = detectInstalledProviders;
const claude_provider_js_1 = require("./claude-provider.js");
const codex_provider_js_1 = require("./codex-provider.js");
/** 已注册的 Provider 实例映射 */
const providers = new Map();
// 注册内置 Provider
registerProvider(new claude_provider_js_1.ClaudeProvider());
registerProvider(new codex_provider_js_1.CodexProvider());
/**
 * 注册一个 CLI Provider
 * @param provider - Provider 实例
 */
function registerProvider(provider) {
    providers.set(provider.id, provider);
}
/**
 * 获取指定 ID 的 Provider
 * @param id - Provider ID ('claude' | 'codex')
 * @returns Provider 实例，未找到返回 undefined
 */
function getProvider(id) {
    return providers.get(id);
}
/**
 * 获取所有已注册的 Provider
 * @returns Provider 实例数组
 */
function getAllProviders() {
    return Array.from(providers.values());
}
/**
 * 检测所有已安装的 CLI Provider
 * @returns 每个 Provider 的可用性状态（包含 id 和 label）
 */
async function detectInstalledProviders() {
    const results = [];
    for (const provider of providers.values()) {
        try {
            const status = await provider.detect();
            results.push({
                id: provider.id,
                label: provider.label,
                available: status.available,
                version: status.version,
                path: status.path,
                error: status.error,
            });
        }
        catch (err) {
            results.push({
                id: provider.id,
                label: provider.label,
                available: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return results;
}
//# sourceMappingURL=index.js.map