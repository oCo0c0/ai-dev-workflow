/**
 * @file 通用测试 Provider
 * @description 兜底 Provider，当所有其他 Provider 都无法匹配时使用。
 *   不检测框架，直接执行用户指定的命令，用通用正则解析输出。
 */

import type {TestProvider, ProjectInfo, TestFrameworkDetail, TestTarget, TestResults} from './types.js';

/**
 * 通用测试 Provider
 * @description 兜底实现，支持任意自定义测试命令。
 *   不做项目检测（总是返回 null），仅在用户手动指定时使用。
 */
export class GenericTestProvider implements TestProvider {
    type = 'generic';
    priority = 999;

    /**
     * 通用 Provider 不做自动检测
     */
    detect(_workspacePath: string): ProjectInfo | null {
        // 通用 Provider 不匹配任何项目，仅作为兜底
        return null;
    }

    /**
     * 生成可显示的项目信息
     */
    createProjectInfo(workspacePath: string): ProjectInfo {
        return {
            type: 'generic',
            label: 'Unknown Project',
            buildTool: 'unknown',
            testFrameworks: [{
                name: 'custom',
                detected: true,
                command: 'npm test',
                supportsJsonOutput: false,
                jsonOutputArgs: [],
            }],
            rootPath: workspacePath,
        };
    }

    /**
     * 通用 Provider 不支持测试目标发现
     */
    listTestTargets(_workspacePath: string, _changedFiles?: string[]): TestTarget[] {
        return [];
    }

    /**
     * 获取执行命令
     */
    getRunCommand(framework: string, _targets?: TestTarget[], filter?: string): string {
        let command = framework; // 对于 generic，framework 就是命令本身
        if (filter) {
            command += ` ${filter}`;
        }
        return command;
    }

    /**
     * 通用输出解析
     * @description 使用通用正则模式从输出中提取 passed/failed/skipped
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults {
        const combined = stdout + '\n' + stderr;

        const results: TestResults = {
            framework,
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // 通用模式匹配
        const passedMatch = combined.match(/(\d+)\s+(?:passed|passing)/i);
        const failedMatch = combined.match(/(\d+)\s+(?:failed|failing)/i);
        const skippedMatch = combined.match(/(\d+)\s+(?:skipped|pending)/i);

        if (passedMatch) results.passed = parseInt(passedMatch[1], 10);
        if (failedMatch) results.failed = parseInt(failedMatch[1], 10);
        if (skippedMatch) results.skipped = parseInt(skippedMatch[1], 10);
        results.totalTests = results.passed + results.failed + results.skipped;

        // 兜底：根据退出码推断
        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }
}
