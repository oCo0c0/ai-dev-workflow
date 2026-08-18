/**
 * @module cli-providers
 * @description CLI Provider 注册表和检测服务
 *
 * 管理所有 CLI Provider 的注册、查询和自动检测。
 * 参考 test-providers 的 strategy + registry 模式。
 *
 * 扩展方式：调用 registerProvider(() => new YourProvider()) 注册工厂函数，
 * 无需修改本模块以外的任何调用方。
 */

import type {CLIProvider, CLIProviderCapabilities, CLIProviderStatus, ProviderModelSettings} from './types.js';
import {ClaudeProvider} from './claude-provider.js';
import {CodexProvider} from './codex-provider.js';
import {PiProvider} from './pi-provider.js';

/** Provider 工厂：每次调用返回全新实例（多任务并行需要独立子进程） */
type ProviderFactory = () => CLIProvider;

/** 已注册的 Provider 工厂映射（id → 工厂） */
const factories = new Map<string, ProviderFactory>();

/** 预热的单例实例（getProvider 复用，避免重复启动子进程） */
const singletons = new Map<string, CLIProvider>();

/**
 * 注册一个 CLI Provider 工厂
 * @param factory - 返回 Provider 实例的工厂函数（会被调用两次：注册时探测 id、createProvider 时）
 */
export function registerProvider(factory: ProviderFactory): void {
    const probe = factory();
    factories.set(probe.id, factory);
    singletons.set(probe.id, probe);
}

// 注册内置 Provider
registerProvider(() => new ClaudeProvider());
registerProvider(() => new CodexProvider());
registerProvider(() => new PiProvider());

/** 兜底 Provider ID（配置缺失/非法时使用） */
export const DEFAULT_PROVIDER_ID = 'claude';

/**
 * 所有内置 Provider ID（只读快照，按注册顺序）
 */
export function getBuiltinProviderIds(): readonly string[] {
    return Array.from(factories.keys());
}

/**
 * 判断是否为内置 Provider ID（自定义供应商记录 id 返回 false）
 * @description 内置集合的单一事实来源，调用方不得再自行枚举 id 判断
 */
export function isBuiltinProviderId(id: string): boolean {
    return factories.has(id);
}

/**
 * 获取指定 ID 的共享单例 Provider
 * @param id - Provider ID（内置 id；自定义记录请先解析为引擎 id）
 * @returns Provider 实例，未找到返回 undefined
 */
export function getProvider(id: string): CLIProvider | undefined {
    return singletons.get(id);
}

/**
 * 创建指定 ID 的全新 Provider 实例
 * @description 与 getProvider 的共享单例不同，每次调用返回独立实例，
 *              适用于任务级隔离（独立子进程/会话）。调用方负责 initialize()/dispose() 生命周期。
 * @param id - Provider ID
 * @returns Provider 实例，未找到返回 undefined
 */
export function createProvider(id: string): CLIProvider | undefined {
    return factories.get(id)?.();
}

/**
 * 获取所有已注册的 Provider
 * @returns Provider 实例数组
 */
export function getAllProviders(): CLIProvider[] {
    return Array.from(singletons.values());
}

/**
 * 检测所有已安装的 CLI Provider
 * @returns 每个 Provider 的可用性状态（包含 id 和 label）
 */
export async function detectInstalledProviders(): Promise<DetectedProviderStatus[]> {
    const results: DetectedProviderStatus[] = [];
    for (const provider of singletons.values()) {
        try {
            const status = await provider.detect();
            results.push({
                id: provider.id,
                label: provider.label,
                available: status.available,
                version: status.version,
                path: status.path,
                error: status.error,
                meta: status.meta,
                capabilities: provider.capabilities,
                defaultModelSettings: provider.defaultModelSettings,
            });
        } catch (err) {
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

/**
 * 检测状态（带 id 和 label 字段）
 */
export interface DetectedProviderStatus {
    id: string;
    label: string;
    available: boolean;
    version?: string;
    path?: string;
    error?: string;
    /** Provider 特定的元数据（如 pi 的可用 LLM 提供商列表） */
    meta?: Record<string, unknown>;
    /** 能力声明（前端据此渲染配置 UI） */
    capabilities?: CLIProviderCapabilities;
    /** Provider 自带的默认模型配置 */
    defaultModelSettings?: ProviderModelSettings;
}

// 重导出类型
export type {CLIProvider, CLIProviderCapabilities, CLIProviderStatus, CLIProviderInput, CLIProviderOptions, CLIProviderResult, CLIProviderModelConnection, CLIProviderModelOptions, ProviderModelSettings, SkillInfo, McpServerInfo} from './types.js';
