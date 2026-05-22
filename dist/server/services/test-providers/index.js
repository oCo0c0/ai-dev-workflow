"use strict";
/**
 * @file 测试 Provider 注册表
 * @description 管理所有测试 Provider 的注册、自动检测和选择。
 *   按 priority 排序，自动选择最匹配的 Provider。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectProvider = detectProvider;
exports.getProvider = getProvider;
exports.getGenericProvider = getGenericProvider;
exports.detectAll = detectAll;
exports.listProviders = listProviders;
exports.clearDetectCache = clearDetectCache;
const node_provider_js_1 = require("./node-provider.js");
const java_provider_js_1 = require("./java-provider.js");
const python_provider_js_1 = require("./python-provider.js");
const generic_provider_js_1 = require("./generic-provider.js");
/**
 * 所有已注册的 Provider，按 priority 升序排列
 */
const providers = [
    new node_provider_js_1.NodeTestProvider(), // priority: 10
    new java_provider_js_1.JavaTestProvider(), // priority: 20
    new python_provider_js_1.PythonTestProvider(), // priority: 30
].sort((a, b) => a.priority - b.priority);
/** 通用兜底 Provider（不参与自动检测） */
const genericProvider = new generic_provider_js_1.GenericTestProvider();
/**
 * 检测结果缓存
 * @description key 为 workspacePath，避免重复检测
 */
const detectCache = new Map();
/**
 * 自动检测项目类型并返回匹配的 Provider
 * @param workspacePath - 项目工作空间路径
 * @returns 匹配的 Provider 和项目信息，无匹配时返回 null
 */
function detectProvider(workspacePath) {
    // 检查缓存
    const cached = detectCache.get(workspacePath);
    if (cached)
        return cached;
    // 按 priority 顺序检测
    for (const provider of providers) {
        const info = provider.detect(workspacePath);
        if (info) {
            const result = { provider, info };
            detectCache.set(workspacePath, result);
            return result;
        }
    }
    return null;
}
/**
 * 获取指定类型的 Provider
 * @param type - Provider 类型标识（如 'node', 'java', 'python', 'generic'）
 */
function getProvider(type) {
    if (type === 'generic')
        return genericProvider;
    return providers.find(p => p.type === type);
}
/**
 * 获取通用兜底 Provider
 */
function getGenericProvider() {
    return genericProvider;
}
/**
 * 列出所有 Provider 对指定工作空间的检测结果
 * @param workspacePath - 项目工作空间路径
 * @returns 每个 Provider 的检测结果
 */
function detectAll(workspacePath) {
    return providers.map(provider => ({
        provider,
        info: provider.detect(workspacePath),
    }));
}
/**
 * 获取所有已注册的 Provider 列表
 */
function listProviders() {
    return [...providers];
}
/**
 * 清除检测缓存
 * @param workspacePath - 可选，指定路径则只清除该路径的缓存
 */
function clearDetectCache(workspacePath) {
    if (workspacePath) {
        detectCache.delete(workspacePath);
    }
    else {
        detectCache.clear();
    }
}
//# sourceMappingURL=index.js.map