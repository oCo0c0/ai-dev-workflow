/**
 * @module cli-providers
 * @description CLI Provider 注册表和检测服务
 *
 * 管理所有 CLI Provider 的注册、查询和自动检测。
 * 参考 test-providers 的 strategy + registry 模式。
 */

import type {CLIProvider, CLIProviderStatus} from './types.js';
import {ClaudeProvider} from './claude-provider.js';
import {CodexProvider} from './codex-provider.js';

/** 已注册的 Provider 实例映射 */
const providers = new Map<string, CLIProvider>();

// 注册内置 Provider
registerProvider(new ClaudeProvider());
registerProvider(new CodexProvider());

/**
 * 注册一个 CLI Provider
 * @param provider - Provider 实例
 */
export function registerProvider(provider: CLIProvider): void {
    providers.set(provider.id, provider);
}

/**
 * 获取指定 ID 的 Provider
 * @param id - Provider ID ('claude' | 'codex')
 * @returns Provider 实例，未找到返回 undefined
 */
export function getProvider(id: string): CLIProvider | undefined {
    return providers.get(id);
}

/**
 * 获取所有已注册的 Provider
 * @returns Provider 实例数组
 */
export function getAllProviders(): CLIProvider[] {
    return Array.from(providers.values());
}

/**
 * 检测所有已安装的 CLI Provider
 * @returns 每个 Provider 的可用性状态（包含 id 和 label）
 */
export async function detectInstalledProviders(): Promise<DetectedProviderStatus[]> {
    const results: DetectedProviderStatus[] = [];
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
}

// 重导出类型
export type {CLIProvider, CLIProviderCapabilities, CLIProviderStatus, CLIProviderInput, CLIProviderOptions, CLIProviderResult, SkillInfo, McpServerInfo} from './types.js';
