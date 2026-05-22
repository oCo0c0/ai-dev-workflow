/**
 * @file Java 测试 Provider
 * @description Java 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Maven 和 Gradle 两种构建工具，以及 JUnit/TestNG 测试框架。
 */

import fs from 'fs';
import path from 'path';
import type {TestProvider, ProjectInfo, TestFrameworkDetail, TestTarget, TestResults} from './types.js';

/**
 * Java 测试 Provider
 * @description 检测 Java 项目（Maven/Gradle），支持定向测试执行和 Surefire 报告解析。
 */
export class JavaTestProvider implements TestProvider {
    type = 'java';
    priority = 20;

    /**
     * 检测项目是否为 Java 项目
     * @description 通过 pom.xml（Maven）或 build.gradle（Gradle）判断
     */
    detect(workspacePath: string): ProjectInfo | null {
        // Maven 项目
        const pomPath = path.join(workspacePath, 'pom.xml');
        if (fs.existsSync(pomPath)) {
            return {
                type: 'java',
                label: 'Java (Maven)',
                buildTool: 'maven',
                testFrameworks: this.detectMavenFrameworks(workspacePath, pomPath),
                rootPath: workspacePath,
            };
        }

        // Gradle 项目
        const gradleFiles = ['build.gradle', 'build.gradle.kts'];
        for (const gf of gradleFiles) {
            if (fs.existsSync(path.join(workspacePath, gf))) {
                return {
                    type: 'java',
                    label: 'Java (Gradle)',
                    buildTool: 'gradle',
                    testFrameworks: this.detectGradleFrameworks(workspacePath),
                    rootPath: workspacePath,
                };
            }
        }

        return null;
    }

    /**
     * 根据变更文件列出可运行的测试目标
     * @description Java 映射规则：src/main/java/com/foo/Bar.java → src/test/java/com/foo/BarTest.java
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[] {
        const targets: TestTarget[] = [];

        if (!changedFiles || changedFiles.length === 0) {
            return this.findAllTestFiles(workspacePath);
        }

        for (const file of changedFiles) {
            const normalized = file.replace(/\\/g, '/');

            // 测试文件本身就是目标
            if (normalized.includes('/test/java/') || normalized.endsWith('Test.java') || normalized.endsWith('Tests.java')) {
                targets.push({filePath: normalized, framework: 'junit'});
                continue;
            }

            // 源文件映射到测试文件
            if (!normalized.includes('/main/java/')) continue;
            if (!normalized.endsWith('.java')) continue;

            // src/main/java/com/foo/Bar.java → src/test/java/com/foo/BarTest.java
            const testPath = normalized
                .replace('/main/java/', '/test/java/')
                .replace(/\.java$/, 'Test.java');

            const fullPath = path.join(workspacePath, testPath);
            if (fs.existsSync(fullPath)) {
                targets.push({filePath: testPath, sourceFile: normalized, framework: 'junit'});
            }

            // 也检查 Tests 后缀变体
            const testPathPlural = normalized
                .replace('/main/java/', '/test/java/')
                .replace(/\.java$/, 'Tests.java');

            if (testPathPlural !== testPath) {
                const fullPluralPath = path.join(workspacePath, testPathPlural);
                if (fs.existsSync(fullPluralPath)) {
                    targets.push({filePath: testPathPlural, sourceFile: normalized, framework: 'junit'});
                }
            }
        }

        return targets;
    }

    /**
     * 获取 Maven/Gradle 测试执行命令
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string {
        // framework 可能是 'junit'、'testng' 或 'maven'/'gradle'（构建工具直接指定）
        // 从 targets 的路径可以推断构建工具
        if (framework === 'gradle') {
            return this.getGradleCommand(targets, filter);
        }

        // 默认 Maven
        return this.getMavenCommand(targets, filter);
    }

    /**
     * 解析 Java 测试输出
     * @description 优先尝试解析 Surefire XML 报告，回退到控制台文本解析
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults {
        // 这里无法直接访问 workspacePath，回退到控制台输出解析
        // Surefire 报告的解析由 runTests 完成后单独处理
        return this.parseConsoleOutput(stdout + '\n' + stderr, exitCode);
    }

    // === 私有方法 ===

    /**
     * 检测 Maven 项目中的测试框架
     */
    private detectMavenFrameworks(workspacePath: string, pomPath: string): TestFrameworkDetail[] {
        const frameworks: TestFrameworkDetail[] = [];

        try {
            const content = fs.readFileSync(pomPath, 'utf-8');

            // JUnit 5 (Jupiter)
            const hasJunit = content.includes('junit-jupiter') ||
                content.includes('junit:junit') ||
                content.includes('org.junit');

            frameworks.push({
                name: 'junit',
                detected: hasJunit,
                configFile: 'pom.xml',
                command: this.hasMavenWrapper(workspacePath) ? './mvnw test' : 'mvn test',
                supportsJsonOutput: false,
                jsonOutputArgs: [],
            });

            // TestNG
            const hasTestNg = content.includes('testng');
            if (hasTestNg) {
                frameworks.push({
                    name: 'testng',
                    detected: true,
                    configFile: 'pom.xml',
                    command: this.hasMavenWrapper(workspacePath) ? './mvnw test' : 'mvn test',
                    supportsJsonOutput: false,
                    jsonOutputArgs: [],
                });
            }

            // 如果都没检测到但有 pom.xml，仍然提供默认 junit
            if (!hasJunit && !hasTestNg) {
                frameworks.push({
                    name: 'junit',
                    detected: true, // Java 项目默认有 junit
                    configFile: 'pom.xml',
                    command: this.hasMavenWrapper(workspacePath) ? './mvnw test' : 'mvn test',
                    supportsJsonOutput: false,
                    jsonOutputArgs: [],
                });
            }
        } catch {
            frameworks.push({
                name: 'junit',
                detected: true,
                command: 'mvn test',
                supportsJsonOutput: false,
                jsonOutputArgs: [],
            });
        }

        return frameworks;
    }

    /**
     * 检测 Gradle 项目中的测试框架
     */
    private detectGradleFrameworks(workspacePath: string): TestFrameworkDetail[] {
        const command = this.hasGradleWrapper(workspacePath) ? './gradlew test' : 'gradle test';
        const frameworks: TestFrameworkDetail[] = [];

        // 尝试读取 build.gradle 内容
        const gradleFiles = ['build.gradle.kts', 'build.gradle'];
        let gradleContent = '';
        for (const gf of gradleFiles) {
            const fp = path.join(workspacePath, gf);
            if (fs.existsSync(fp)) {
                try {
                    gradleContent = fs.readFileSync(fp, 'utf-8');
                } catch {
                    // 忽略
                }
                break;
            }
        }

        const hasJunit = gradleContent.includes('junit') || gradleContent.includes('testImplementation');
        frameworks.push({
            name: 'junit',
            detected: hasJunit || gradleContent.length === 0,
            command,
            supportsJsonOutput: false,
            jsonOutputArgs: [],
        });

        if (gradleContent.includes('testng')) {
            frameworks.push({
                name: 'testng',
                detected: true,
                command,
                supportsJsonOutput: false,
                jsonOutputArgs: [],
            });
        }

        return frameworks;
    }

    /**
     * 检查是否有 Maven Wrapper
     */
    private hasMavenWrapper(workspacePath: string): boolean {
        return fs.existsSync(path.join(workspacePath, 'mvnw')) ||
            fs.existsSync(path.join(workspacePath, 'mvnw.cmd'));
    }

    /**
     * 检查是否有 Gradle Wrapper
     */
    private hasGradleWrapper(workspacePath: string): boolean {
        return fs.existsSync(path.join(workspacePath, 'gradlew')) ||
            fs.existsSync(path.join(workspacePath, 'gradlew.bat'));
    }

    /**
     * 生成 Maven 测试命令
     */
    private getMavenCommand(targets?: TestTarget[], filter?: string): string {
        let command = 'mvn test';

        if (targets && targets.length > 0) {
            // 从测试文件路径提取类名
            const classNames = targets
                .map(t => {
                    const base = path.basename(t.filePath, '.java');
                    return base;
                })
                .filter(Boolean);

            if (classNames.length > 0) {
                command += ` -Dtest=${classNames.join(',')}`;
            }
        }

        if (filter) {
            command += ` -Dtest="${filter}"`;
        }

        return command;
    }

    /**
     * 生成 Gradle 测试命令
     */
    private getGradleCommand(targets?: TestTarget[], filter?: string): string {
        let command = 'gradle test';

        if (targets && targets.length > 0) {
            const classNames = targets
                .map(t => path.basename(t.filePath, '.java'))
                .filter(Boolean);

            if (classNames.length > 0) {
                command += ` --tests ${classNames.join(' --tests ')}`;
            }
        }

        if (filter) {
            command += ` --tests "${filter}"`;
        }

        return command;
    }

    /**
     * 扫描所有 Java 测试文件
     */
    private findAllTestFiles(workspacePath: string): TestTarget[] {
        const targets: TestTarget[] = [];
        const testDir = path.join(workspacePath, 'src', 'test', 'java');
        if (!fs.existsSync(testDir)) return targets;

        const walk = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, {withFileTypes: true});
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    } else if (entry.name.endsWith('Test.java') || entry.name.endsWith('Tests.java')) {
                        targets.push({
                            filePath: path.relative(workspacePath, fullPath).replace(/\\/g, '/'),
                            framework: 'junit',
                        });
                    }
                }
            } catch {
                // 忽略权限错误
            }
        };

        walk(testDir);
        return targets;
    }

    /**
     * 解析 Maven/Gradle 控制台输出
     */
    private parseConsoleOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'junit',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // Maven Surefire 输出: Tests run: X, Failures: Y, Skipped: Z, Time elapsed: N sec
        const mavenMatch = output.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/);
        if (mavenMatch) {
            const run = parseInt(mavenMatch[1], 10);
            const failures = parseInt(mavenMatch[2], 10);
            const errors = parseInt(mavenMatch[3], 10);
            results.skipped = parseInt(mavenMatch[4], 10);
            results.failed = failures + errors;
            results.passed = run - results.failed - results.skipped;
            results.totalTests = run;
        }

        // Gradle 输出: X tests completed, Y failed, Z skipped
        if (results.totalTests === 0) {
            const gradleMatch = output.match(/(\d+)\s+tests?\s+completed(?:,?\s*(\d+)\s+failed)?(?:,?\s*(\d+)\s+skipped)?/);
            if (gradleMatch) {
                results.totalTests = parseInt(gradleMatch[1], 10);
                results.failed = parseInt(gradleMatch[2] ?? '0', 10);
                results.skipped = parseInt(gradleMatch[3] ?? '0', 10);
                results.passed = results.totalTests - results.failed - results.skipped;
            }
        }

        // 耗时
        const timeMatch = output.match(/Time elapsed:\s*([\d.]+)\s*s/i);
        if (timeMatch) {
            results.duration = parseFloat(timeMatch[1]) * 1000;
        }

        // BUILD SUCCESS / BUILD FAILURE
        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 解析 Surefire XML 报告
     * @description 读取 target/surefire-reports/TEST-*.xml 中的测试结果
     */
    parseSurefireReports(workspacePath: string): TestResults | null {
        const reportsDir = path.join(workspacePath, 'target', 'surefire-reports');
        if (!fs.existsSync(reportsDir)) return null;

        const results: TestResults = {
            framework: 'junit',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        try {
            const files = fs.readdirSync(reportsDir).filter(f => f.startsWith('TEST-') && f.endsWith('.xml'));
            for (const file of files) {
                const content = fs.readFileSync(path.join(reportsDir, file), 'utf-8');
                // 解析 testsuite 标签属性
                const suiteMatch = content.match(/<testsuite\s+[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*skipped="(\d+)"[^>]*time="([\d.]+)"/);
                if (suiteMatch) {
                    const suiteTests = parseInt(suiteMatch[1], 10);
                    const suiteFailures = parseInt(suiteMatch[2], 10);
                    const suiteErrors = parseInt(suiteMatch[3], 10);
                    const suiteSkipped = parseInt(suiteMatch[4], 10);
                    const suiteTime = parseFloat(suiteMatch[5]);

                    results.totalTests += suiteTests;
                    results.failed += suiteFailures + suiteErrors;
                    results.skipped += suiteSkipped;
                    results.duration += suiteTime * 1000;

                    const suiteName = file.replace('TEST-', '').replace('.xml', '');
                    results.suites.push({
                        name: suiteName,
                        tests: [], // 详细用例解析可后续扩展
                    });
                }
            }
            results.passed = results.totalTests - results.failed - results.skipped;
        } catch {
            return null;
        }

        return results.totalTests > 0 ? results : null;
    }
}
