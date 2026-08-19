/**
 * @module requirement-sources
 * @description 需求源适配器注册表（热插拔）
 *
 * 管理所有需求源适配器的注册、查询和自动路由。
 * 与 cli-providers 同构：strategy + registry + 工厂注册。
 *
 * 扩展方式：调用 registerRequirementSource(() => new YourAdapter()) 注册一行，
 * 无需修改 MCPBridgeService、路由或前端。
 *
 * 适配器路由规则（resolveAdapter）：
 * 1. 按 serverName 精确绑定（bindServer 显式指定，优先级最高）
 * 2. 按注册顺序询问各适配器 matchServer(config) 自动认领
 * 3. 都不认领 → generic 兜底适配器
 */
import { OnesAdapter } from './ones-adapter.js';
import { GithubAdapter } from './github-adapter.js';
import { GenericAdapter } from './generic-adapter.js';
/** 已注册的适配器工厂（有序：matchServer 按此顺序询问） */
const factories = [];
/** 预热的共享实例（id → 实例） */
const instances = new Map();
/** serverName → adapterId 显式绑定（优先于自动认领） */
const bindings = new Map();
/** generic 兜底单例（不参与自动认领） */
const genericAdapter = new GenericAdapter();
/**
 * 注册一个需求源适配器
 * @param factory - 返回适配器实例的工厂函数
 */
export function registerRequirementSource(factory) {
    const instance = factory();
    factories.push(factory);
    instances.set(instance.id, instance);
}
// 注册内置适配器（顺序即 matchServer 的认领优先级）
registerRequirementSource(() => new OnesAdapter());
registerRequirementSource(() => new GithubAdapter());
/**
 * 显式绑定 MCP server 到适配器
 * @description 优先级最高：用于自动认领误判时的人工纠偏
 */
export function bindServer(serverName, adapterId) {
    bindings.set(serverName, adapterId);
}
/** 解除显式绑定 */
export function unbindServer(serverName) {
    bindings.delete(serverName);
}
/**
 * 获取指定 id 的适配器（含 generic）
 */
export function getAdapter(id) {
    if (id === genericAdapter.id)
        return genericAdapter;
    return instances.get(id);
}
/**
 * 列出所有已注册适配器（含 generic，按注册顺序）
 */
export function listAdapters() {
    return [...instances.values(), genericAdapter];
}
/**
 * 列出源目录适配器（不含 generic 兜底）
 * @description 目录是平台能力的外显：前端源选择器只展示这些，
 *   generic 是运行时对未知 server 的容错，不作为可选源推荐。
 */
export function listCatalogAdapters() {
    return [...instances.values()];
}
/**
 * 为 MCP server 配置解析适配器
 * @description 路由规则见模块注释；config 为空时返回 generic
 */
export function resolveAdapter(serverName, config) {
    // 1. 显式绑定
    const boundId = bindings.get(serverName);
    if (boundId) {
        const bound = getAdapter(boundId);
        if (bound)
            return bound;
    }
    // 2. 自动认领（按注册顺序）
    if (config) {
        for (const adapter of instances.values()) {
            try {
                if (adapter.matchServer(config))
                    return adapter;
            }
            catch { /* matchServer 异常视为不认领 */ }
        }
    }
    // 3. generic 兜底
    return genericAdapter;
}
export { mapJsonToRequirement, mapJsonToDetailBase, parseMarkdownRequirementList } from './parsers.js';
//# sourceMappingURL=index.js.map