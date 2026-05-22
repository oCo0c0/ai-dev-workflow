/**
 * @file 测试 Provider 注册表
 * @description 管理所有测试 Provider 的注册、自动检测和选择。
 *   按 priority 排序，自动选择最匹配的 Provider。
 */
import type { TestProvider, ProjectInfo } from './types.js';
import { GenericTestProvider } from './generic-provider.js';
/**
 * 自动检测项目类型并返回匹配的 Provider
 * @param workspacePath - 项目工作空间路径
 * @returns 匹配的 Provider 和项目信息，无匹配时返回 null
 */
export declare function detectProvider(workspacePath: string): {
    provider: TestProvider;
    info: ProjectInfo;
} | null;
/**
 * 获取指定类型的 Provider
 * @param type - Provider 类型标识（如 'node', 'java', 'python', 'generic'）
 */
export declare function getProvider(type: string): TestProvider | undefined;
/**
 * 获取通用兜底 Provider
 */
export declare function getGenericProvider(): GenericTestProvider;
/**
 * 列出所有 Provider 对指定工作空间的检测结果
 * @param workspacePath - 项目工作空间路径
 * @returns 每个 Provider 的检测结果
 */
export declare function detectAll(workspacePath: string): Array<{
    provider: TestProvider;
    info: ProjectInfo | null;
}>;
/**
 * 获取所有已注册的 Provider 列表
 */
export declare function listProviders(): TestProvider[];
/**
 * 清除检测缓存
 * @param workspacePath - 可选，指定路径则只清除该路径的缓存
 */
export declare function clearDetectCache(workspacePath?: string): void;
export type { TestProvider, ProjectInfo, TestFrameworkDetail, TestTarget, TestResults, TestSuite, TestCase, TestFrameworkInfo } from './types.js';
//# sourceMappingURL=index.d.ts.map