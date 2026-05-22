/**
 * @file Node.js 测试 Provider
 * @description Node.js 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Vitest、Jest、Playwright 三种框架，通过 package.json 依赖和配置文件双重检测。
 */
import type { TestProvider, ProjectInfo, TestTarget, TestResults } from './types.js';
/**
 * Node.js 测试 Provider
 * @description 检测 Node.js 项目中的测试框架，支持 Vitest、Jest 和 Playwright。
 *   通过 package.json 依赖字段和配置文件双重检测，提高准确性。
 */
export declare class NodeTestProvider implements TestProvider {
    type: string;
    priority: number;
    /**
     * 检测项目是否为 Node.js 项目
     * @description 通过 package.json 的存在性判断，并读取其中的依赖和脚本信息
     */
    detect(workspacePath: string): ProjectInfo | null;
    /**
     * 根据变更文件列出可运行的测试目标
     * @description 基于源文件路径，按常见测试文件约定映射到对应的测试文件。
     *   仅返回实际存在的测试文件。
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[];
    /**
     * 获取框架的默认执行命令
     * @description 根据 framework 找到对应规则，生成执行命令。
     *   如果指定了 targets，追加文件路径参数。
     *   如果指定了 filter，追加过滤参数。
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string;
    /**
     * 解析测试输出
     * @description 根据 framework 类型分派到对应的解析器
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults;
    /**
     * 检测包管理器
     */
    private detectPackageManager;
    /**
     * 检测测试框架
     * @description 双重检测：package.json 依赖 + 配置文件 + scripts 字段
     */
    private detectFrameworks;
    /**
     * 检查 vite.config 文件中是否包含 test 配置
     * @description Vitest 可以不使用独立的 vitest.config，而是将配置写在 vite.config 中
     */
    private checkViteConfigForTest;
    /**
     * 判断文件是否为测试文件
     */
    private isTestFile;
    /**
     * 判断文件是否为源代码文件
     */
    private isSourceFile;
    /**
     * 将源文件路径映射到候选测试文件路径
     */
    private mapSourceToTestFiles;
    /**
     * 根据测试文件路径推断所属框架
     */
    private detectFrameworkFromPath;
    /**
     * 扫描所有测试文件
     */
    private findAllTestFiles;
    /**
     * 解析 Vitest 输出
     * @description Vitest 输出格式与 Jest 类似，但有自己的变体
     */
    private parseVitestOutput;
    /**
     * 解析 Jest 输出
     */
    private parseJestOutput;
    /**
     * 解析 Playwright 输出
     */
    private parsePlaywrightOutput;
    /**
     * 通用 Node.js 测试输出解析
     */
    private parseGenericNodeOutput;
    /**
     * 从 Node.js 测试输出中尽力解析测试套件和用例
     */
    private parseTestSuitesFromNodeOutput;
}
//# sourceMappingURL=node-provider.d.ts.map