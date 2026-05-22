/**
 * @module cli-providers
 * @description CLI Provider 注册表和检测服务
 *
 * 管理所有 CLI Provider 的注册、查询和自动检测。
 * 参考 test-providers 的 strategy + registry 模式。
 */
import type { CLIProvider } from './types.js';
/**
 * 注册一个 CLI Provider
 * @param provider - Provider 实例
 */
export declare function registerProvider(provider: CLIProvider): void;
/**
 * 获取指定 ID 的 Provider
 * @param id - Provider ID ('claude' | 'codex')
 * @returns Provider 实例，未找到返回 undefined
 */
export declare function getProvider(id: string): CLIProvider | undefined;
/**
 * 获取所有已注册的 Provider
 * @returns Provider 实例数组
 */
export declare function getAllProviders(): CLIProvider[];
/**
 * 检测所有已安装的 CLI Provider
 * @returns 每个 Provider 的可用性状态（包含 id 和 label）
 */
export declare function detectInstalledProviders(): Promise<DetectedProviderStatus[]>;
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
export type { CLIProvider, CLIProviderStatus, CLIProviderInput, CLIProviderOptions, CLIProviderResult, SkillInfo, McpServerInfo } from './types.js';
//# sourceMappingURL=index.d.ts.map