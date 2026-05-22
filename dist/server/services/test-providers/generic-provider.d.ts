/**
 * @file 通用测试 Provider
 * @description 兜底 Provider，当所有其他 Provider 都无法匹配时使用。
 *   不检测框架，直接执行用户指定的命令，用通用正则解析输出。
 */
import type { TestProvider, ProjectInfo, TestTarget, TestResults } from './types.js';
/**
 * 通用测试 Provider
 * @description 兜底实现，支持任意自定义测试命令。
 *   不做项目检测（总是返回 null），仅在用户手动指定时使用。
 */
export declare class GenericTestProvider implements TestProvider {
    type: string;
    priority: number;
    /**
     * 通用 Provider 不做自动检测
     */
    detect(_workspacePath: string): ProjectInfo | null;
    /**
     * 生成可显示的项目信息
     */
    createProjectInfo(workspacePath: string): ProjectInfo;
    /**
     * 通用 Provider 不支持测试目标发现
     */
    listTestTargets(_workspacePath: string, _changedFiles?: string[]): TestTarget[];
    /**
     * 获取执行命令
     */
    getRunCommand(framework: string, _targets?: TestTarget[], filter?: string): string;
    /**
     * 通用输出解析
     * @description 使用通用正则模式从输出中提取 passed/failed/skipped
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults;
}
//# sourceMappingURL=generic-provider.d.ts.map