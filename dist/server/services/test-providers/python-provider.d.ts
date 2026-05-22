/**
 * @file Python 测试 Provider
 * @description Python 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Pytest 和 unittest 两种测试框架。
 */
import type { TestProvider, ProjectInfo, TestTarget, TestResults } from './types.js';
/**
 * Python 测试 Provider
 * @description 检测 Python 项目中的测试框架，支持 Pytest 和标准库 unittest。
 */
export declare class PythonTestProvider implements TestProvider {
    type: string;
    priority: number;
    /**
     * 检测项目是否为 Python 项目
     * @description 通过 requirements.txt、pyproject.toml、setup.py、Pipfile 等文件判断
     */
    detect(workspacePath: string): ProjectInfo | null;
    /**
     * 根据变更文件列出可运行的测试目标
     * @description Python 映射规则：
     *   src/foo.py → tests/test_foo.py, test/test_foo.py
     *   app/bar.py → tests/test_bar.py
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[];
    /**
     * 获取 Pytest/unittest 执行命令
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string;
    /**
     * 解析 Python 测试输出
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults;
    /**
     * 检测 Python 构建工具/包管理器
     */
    private detectBuildTool;
    /**
     * 检测 Python 测试框架
     */
    private detectFrameworks;
    /**
     * 映射源文件到候选测试文件
     */
    private mapSourceToTestFiles;
    /**
     * 生成 Pytest 命令
     */
    private getPytestCommand;
    /**
     * 生成 unittest 命令
     */
    private getUnittestCommand;
    /**
     * 扫描所有 Python 测试文件
     */
    private findAllTestFiles;
    /**
     * 解析 Pytest 控制台输出
     */
    private parsePytestOutput;
    /**
     * 解析 unittest 控制台输出
     */
    private parseUnittestOutput;
}
//# sourceMappingURL=python-provider.d.ts.map