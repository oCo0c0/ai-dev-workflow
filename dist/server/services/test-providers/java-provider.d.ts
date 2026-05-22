/**
 * @file Java 测试 Provider
 * @description Java 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Maven 和 Gradle 两种构建工具，以及 JUnit/TestNG 测试框架。
 */
import type { TestProvider, ProjectInfo, TestTarget, TestResults } from './types.js';
/**
 * Java 测试 Provider
 * @description 检测 Java 项目（Maven/Gradle），支持定向测试执行和 Surefire 报告解析。
 */
export declare class JavaTestProvider implements TestProvider {
    type: string;
    priority: number;
    /**
     * 检测项目是否为 Java 项目
     * @description 通过 pom.xml（Maven）或 build.gradle（Gradle）判断
     */
    detect(workspacePath: string): ProjectInfo | null;
    /**
     * 根据变更文件列出可运行的测试目标
     * @description Java 映射规则：src/main/java/com/foo/Bar.java → src/test/java/com/foo/BarTest.java
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[];
    /**
     * 获取 Maven/Gradle 测试执行命令
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string;
    /**
     * 解析 Java 测试输出
     * @description 优先尝试解析 Surefire XML 报告，回退到控制台文本解析
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults;
    /**
     * 检测 Maven 项目中的测试框架
     */
    private detectMavenFrameworks;
    /**
     * 检测 Gradle 项目中的测试框架
     */
    private detectGradleFrameworks;
    /**
     * 检查是否有 Maven Wrapper
     */
    private hasMavenWrapper;
    /**
     * 检查是否有 Gradle Wrapper
     */
    private hasGradleWrapper;
    /**
     * 生成 Maven 测试命令
     */
    private getMavenCommand;
    /**
     * 生成 Gradle 测试命令
     */
    private getGradleCommand;
    /**
     * 扫描所有 Java 测试文件
     */
    private findAllTestFiles;
    /**
     * 解析 Maven/Gradle 控制台输出
     */
    private parseConsoleOutput;
    /**
     * 解析 Surefire XML 报告
     * @description 读取 target/surefire-reports/TEST-*.xml 中的测试结果
     */
    parseSurefireReports(workspacePath: string): TestResults | null;
}
//# sourceMappingURL=java-provider.d.ts.map