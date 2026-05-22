/**
 * @file Node.js 测试 Provider
 * @description Node.js 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Vitest、Jest、Playwright 三种框架，通过 package.json 依赖和配置文件双重检测。
 */

import fs from 'fs';
import path from 'path';
import type {TestProvider, ProjectInfo, TestFrameworkDetail, TestTarget, TestResults, TestSuite, TestCase} from './types.js';

// === 框架检测规则 ===

interface FrameworkRule {
    /** 框架名称 */
    name: string;
    /** package.json 中的依赖名 */
    depNames: string[];
    /** 配置文件名（按优先级排列） */
    configFiles: string[];
    /** 默认执行命令 */
    defaultCommand: string;
    /** 是否支持 JSON 输出 */
    supportsJsonOutput: boolean;
    /** JSON 输出的命令行参数 */
    jsonOutputArgs: string[];
    /** package.json scripts 字段中的关键字 */
    scriptKeywords: string[];
}

/**
 * Node.js 测试框架检测规则列表
 */
const FRAMEWORK_RULES: FrameworkRule[] = [
    {
        name: 'vitest',
        depNames: ['vitest'],
        configFiles: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'],
        defaultCommand: 'npx vitest run',
        supportsJsonOutput: true,
        jsonOutputArgs: ['--reporter=json', '--outputFile=.vitest-result.json'],
        scriptKeywords: ['vitest'],
    },
    {
        name: 'jest',
        depNames: ['jest'],
        configFiles: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs'],
        defaultCommand: 'npx jest',
        supportsJsonOutput: true,
        jsonOutputArgs: ['--json', '--outputFile=.jest-result.json'],
        scriptKeywords: ['jest'],
    },
    {
        name: 'playwright',
        depNames: ['@playwright/test'],
        configFiles: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'],
        defaultCommand: 'npx playwright test',
        supportsJsonOutput: true,
        jsonOutputArgs: ['--reporter=json'],
        scriptKeywords: ['playwright'],
    },
];

/**
 * 测试文件匹配模式列表
 * @description 源文件到测试文件的映射规则，按常见约定排列
 */
const TEST_FILE_PATTERNS = [
    // 同目录: src/foo.ts → src/foo.test.ts
    (base: string, ext: string) => `${base}.test${ext}`,
    // 同目录: src/foo.ts → src/foo.spec.ts
    (base: string, ext: string) => `${base}.spec${ext}`,
    // __tests__ 目录: src/foo.ts → src/__tests__/foo.test.ts
    (dir: string, name: string, ext: string) => `${dir}/__tests__/${name}.test${ext}`,
    // 顶层 tests 目录: src/foo.ts → tests/foo.test.ts
    (_dir: string, name: string, ext: string) => `tests/${name}.test${ext}`,
    // 顶层 test 目录: src/foo.ts → test/foo.test.ts
    (_dir: string, name: string, ext: string) => `test/${name}.test${ext}`,
];

// === Provider 实现 ===

/**
 * Node.js 测试 Provider
 * @description 检测 Node.js 项目中的测试框架，支持 Vitest、Jest 和 Playwright。
 *   通过 package.json 依赖字段和配置文件双重检测，提高准确性。
 */
export class NodeTestProvider implements TestProvider {
    type = 'node';
    priority = 10;

    /**
     * 检测项目是否为 Node.js 项目
     * @description 通过 package.json 的存在性判断，并读取其中的依赖和脚本信息
     */
    detect(workspacePath: string): ProjectInfo | null {
        const pkgPath = path.join(workspacePath, 'package.json');
        if (!fs.existsSync(pkgPath)) return null;

        // 解析 package.json
        let pkg: Record<string, unknown>;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        } catch {
            return null;
        }

        // 确定包管理器
        const buildTool = this.detectPackageManager(workspacePath);
        const frameworks = this.detectFrameworks(workspacePath, pkg);

        return {
            type: 'node',
            label: `Node.js (${buildTool})`,
            buildTool,
            testFrameworks: frameworks,
            rootPath: workspacePath,
        };
    }

    /**
     * 根据变更文件列出可运行的测试目标
     * @description 基于源文件路径，按常见测试文件约定映射到对应的测试文件。
     *   仅返回实际存在的测试文件。
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[] {
        const targets: TestTarget[] = [];

        if (!changedFiles || changedFiles.length === 0) {
            // 无变更文件时，扫描所有测试文件
            return this.findAllTestFiles(workspacePath);
        }

        // 根据变更文件映射测试文件
        for (const file of changedFiles) {
            // 跳过非源代码文件
            if (this.isTestFile(file)) {
                // 变更文件本身就是测试文件
                targets.push({filePath: file, framework: this.detectFrameworkFromPath(file)});
                continue;
            }

            if (!this.isSourceFile(file)) continue;

            const candidates = this.mapSourceToTestFiles(file);
            for (const candidate of candidates) {
                const fullPath = path.join(workspacePath, candidate);
                if (fs.existsSync(fullPath)) {
                    targets.push({
                        filePath: candidate,
                        sourceFile: file,
                        framework: this.detectFrameworkFromPath(candidate),
                    });
                }
            }
        }

        return targets;
    }

    /**
     * 获取框架的默认执行命令
     * @description 根据 framework 找到对应规则，生成执行命令。
     *   如果指定了 targets，追加文件路径参数。
     *   如果指定了 filter，追加过滤参数。
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string {
        const rule = FRAMEWORK_RULES.find(r => r.name === framework);
        let command = rule?.defaultCommand ?? `npx ${framework}`;

        // 指定测试文件
        if (targets && targets.length > 0) {
            const files = targets.map(t => t.filePath).join(' ');
            command += ` ${files}`;
        }

        // 过滤条件
        if (filter) {
            switch (framework) {
                case 'vitest':
                    command += ` -t "${filter}"`;
                    break;
                case 'jest':
                    command += ` --testNamePattern="${filter}"`;
                    break;
                case 'playwright':
                    command += ` --grep "${filter}"`;
                    break;
                default:
                    command += ` ${filter}`;
            }
        }

        return command;
    }

    /**
     * 解析测试输出
     * @description 根据 framework 类型分派到对应的解析器
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults {
        const combined = stdout + '\n' + stderr;

        switch (framework) {
            case 'vitest':
                return this.parseVitestOutput(combined, exitCode);
            case 'jest':
                return this.parseJestOutput(combined, exitCode);
            case 'playwright':
                return this.parsePlaywrightOutput(combined, exitCode);
            default:
                return this.parseGenericNodeOutput(framework, combined, exitCode);
        }
    }

    // === 私有方法 ===

    /**
     * 检测包管理器
     */
    private detectPackageManager(workspacePath: string): string {
        if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) return 'yarn';
        if (fs.existsSync(path.join(workspacePath, 'bun.lockb'))) return 'bun';
        return 'npm';
    }

    /**
     * 检测测试框架
     * @description 双重检测：package.json 依赖 + 配置文件 + scripts 字段
     */
    private detectFrameworks(workspacePath: string, pkg: Record<string, unknown>): TestFrameworkDetail[] {
        const deps = {
            ...(pkg.dependencies as Record<string, string> ?? {}),
            ...(pkg.devDependencies as Record<string, string> ?? {}),
        };
        const scripts = (pkg.scripts as Record<string, string>) ?? {};
        const testScript = scripts.test ?? '';

        return FRAMEWORK_RULES.map(rule => {
            // 优先级1: 依赖中存在
            const depFound = rule.depNames.some(d => deps[d]);
            // 优先级2: 配置文件存在
            let configFile: string | undefined;
            for (const cf of rule.configFiles) {
                if (fs.existsSync(path.join(workspacePath, cf))) {
                    configFile = cf;
                    break;
                }
            }
            // 优先级3: vite.config 中可能有 test 配置（Vitest 内嵌场景）
            if (!configFile && rule.name === 'vitest') {
                configFile = this.checkViteConfigForTest(workspacePath);
            }
            // 优先级4: scripts 中包含关键字
            const scriptFound = rule.scriptKeywords.some(kw => testScript.toLowerCase().includes(kw));

            const detected = depFound || !!configFile || scriptFound;

            // 生成命令：如果有 test script 且匹配，优先用 script
            let command = rule.defaultCommand;
            if (scriptFound && testScript) {
                // 如果 script 不是默认的 "echo ..." 占位符，使用它
                if (!testScript.includes('echo') && !testScript.includes('no test specified')) {
                    command = testScript.startsWith('npx') || testScript.startsWith('npm')
                        ? testScript
                        : `npx ${testScript}`;
                }
            }

            return {
                name: rule.name,
                detected,
                configFile,
                command,
                supportsJsonOutput: rule.supportsJsonOutput,
                jsonOutputArgs: rule.jsonOutputArgs,
            };
        });
    }

    /**
     * 检查 vite.config 文件中是否包含 test 配置
     * @description Vitest 可以不使用独立的 vitest.config，而是将配置写在 vite.config 中
     */
    private checkViteConfigForTest(workspacePath: string): string | undefined {
        const viteConfigs = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
        for (const vc of viteConfigs) {
            const fullPath = path.join(workspacePath, vc);
            if (fs.existsSync(fullPath)) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    // 检查是否有 test: { 或 test:{ 或 /** @type {import('vitest')} */
                    if (content.includes('test:') || content.includes('vitest')) {
                        return vc;
                    }
                } catch {
                    // 忽略读取错误
                }
            }
        }
        return undefined;
    }

    /**
     * 判断文件是否为测试文件
     */
    private isTestFile(filePath: string): boolean {
        const normalized = filePath.replace(/\\/g, '/');
        return normalized.includes('.test.') || normalized.includes('.spec.') ||
            normalized.includes('__tests__') || normalized.includes('/tests/') || normalized.includes('/test/');
    }

    /**
     * 判断文件是否为源代码文件
     */
    private isSourceFile(filePath: string): boolean {
        const normalized = filePath.replace(/\\/g, '/');
        const ext = path.extname(normalized);
        // 排除配置、样式、资源文件
        const sourceExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
        if (!sourceExts.includes(ext)) return false;
        // 排除常见非源码目录
        const excludeDirs = ['node_modules', 'dist', '.output', '.nuxt', '.next', 'build', 'public', 'assets', 'styles'];
        return !excludeDirs.some(d => normalized.includes(`/${d}/`));
    }

    /**
     * 将源文件路径映射到候选测试文件路径
     */
    private mapSourceToTestFiles(sourcePath: string): string[] {
        const normalized = sourcePath.replace(/\\/g, '/');
        const ext = path.extname(normalized);
        const dir = path.dirname(normalized);
        const name = path.basename(normalized, ext);

        const candidates: string[] = [];

        // 使用模式列表生成候选路径
        for (const pattern of TEST_FILE_PATTERNS) {
            try {
                const candidate = pattern.length === 2
                    ? (pattern as (b: string, e: string) => string)(path.join(dir, name), ext)
                    : (pattern as (d: string, n: string, e: string) => string)(dir, name, ext);
                candidates.push(candidate);
            } catch {
                // 忽略模式执行错误
            }
        }

        return candidates;
    }

    /**
     * 根据测试文件路径推断所属框架
     */
    private detectFrameworkFromPath(_filePath: string): string {
        // Node.js 项目中无法仅从路径区分 Vitest/Jest，返回通用标识
        return 'node-test';
    }

    /**
     * 扫描所有测试文件
     */
    private findAllTestFiles(workspacePath: string): TestTarget[] {
        const targets: TestTarget[] = [];
        const maxDepth = 5;
        const excludeDirs = new Set(['node_modules', 'dist', '.git', '.output', 'build', 'coverage']);

        const walk = (dir: string, depth: number) => {
            if (depth > maxDepth) return;
            try {
                const entries = fs.readdirSync(dir, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        if (!excludeDirs.has(entry.name)) {
                            walk(path.join(dir, entry.name), depth + 1);
                        }
                    } else if (this.isTestFile(entry.name)) {
                        const relativePath = path.relative(workspacePath, path.join(dir, entry.name)).replace(/\\/g, '/');
                        targets.push({filePath: relativePath, framework: 'node-test'});
                    }
                }
            } catch {
                // 忽略权限错误
            }
        };

        walk(workspacePath, 0);
        return targets;
    }

    // === 输出解析器 ===

    /**
     * 解析 Vitest 输出
     * @description Vitest 输出格式与 Jest 类似，但有自己的变体
     */
    private parseVitestOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'vitest',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // Vitest 摘要格式: Tests  X passed / Y failed / Z skipped (N)
        // 或:  ✓ src/foo.test.ts (2 tests) Xms
        // 或:  Tests  X passed | Y failed | Z skipped

        // 格式1: "X passed | Y failed | Z skipped"
        const pipeMatch = output.match(/(\d+)\s+passed\s*\|\s*(\d+)\s+failed\s*(?:\|\s*(\d+)\s+skipped)?/);
        if (pipeMatch) {
            results.passed = parseInt(pipeMatch[1], 10);
            results.failed = parseInt(pipeMatch[2], 10);
            results.skipped = parseInt(pipeMatch[3] ?? '0', 10);
            results.totalTests = results.passed + results.failed + results.skipped;
        }

        // 格式2: "Tests  X passed / Y failed / Z skipped"
        if (results.totalTests === 0) {
            const slashMatch = output.match(/(\d+)\s+passed\s*\/\s*(\d+)\s+failed\s*(?:\/\s*(\d+)\s+skipped)?/);
            if (slashMatch) {
                results.passed = parseInt(slashMatch[1], 10);
                results.failed = parseInt(slashMatch[2], 10);
                results.skipped = parseInt(slashMatch[3] ?? '0', 10);
                results.totalTests = results.passed + results.failed + results.skipped;
            }
        }

        // 格式3: 简单 "X passed, Y failed"
        if (results.totalTests === 0) {
            const simpleMatch = output.match(/(\d+)\s+passed/);
            const failMatch = output.match(/(\d+)\s+failed/);
            if (simpleMatch) {
                results.passed = parseInt(simpleMatch[1], 10);
                results.failed = failMatch ? parseInt(failMatch[1], 10) : 0;
                results.totalTests = results.passed + results.failed;
            }
        }

        // 解析耗时
        const timeMatch = output.match(/(?:Time|Duration):\s+([\d.]+)\s*(ms|s|ms)/i)
            ?? output.match(/([\d.]+s)\s*\n/);
        if (timeMatch) {
            const value = parseFloat(timeMatch[1]);
            results.duration = timeMatch[1].endsWith('s') && !timeMatch[1].includes('ms')
                ? value * 1000
                : value;
        }

        // 解析测试套件
        results.suites = this.parseTestSuitesFromNodeOutput(output);

        // 兜底
        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 解析 Jest 输出
     */
    private parseJestOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'jest',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // Tests: X passed, Y failed, Z skipped, N total
        const testsMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?[,\s]*(\d+)\s+total/);
        if (testsMatch) {
            results.passed = parseInt(testsMatch[1] ?? '0', 10);
            results.failed = parseInt(testsMatch[2] ?? '0', 10);
            results.skipped = parseInt(testsMatch[3] ?? '0', 10);
            results.totalTests = parseInt(testsMatch[4] ?? '0', 10);
        }

        const timeMatch = output.match(/Time:\s+([\d.]+)\s*s/);
        if (timeMatch) {
            results.duration = parseFloat(timeMatch[1]) * 1000;
        }

        const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)/);
        if (coverageMatch) {
            results.coverage = parseFloat(coverageMatch[1]);
        }

        results.suites = this.parseTestSuitesFromNodeOutput(output);

        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 解析 Playwright 输出
     */
    private parsePlaywrightOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'playwright',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        const summaryMatch = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/);
        if (summaryMatch) {
            results.passed = parseInt(summaryMatch[1] ?? '0', 10);
            results.failed = parseInt(summaryMatch[2] ?? '0', 10);
            results.skipped = parseInt(summaryMatch[3] ?? '0', 10);
            results.totalTests = results.passed + results.failed + results.skipped;
        }

        const durationMatch = output.match(/(\d+(?:\.\d+)?)\s*(?:ms|s)/);
        if (durationMatch) {
            const value = parseFloat(durationMatch[1]);
            results.duration = durationMatch[0].includes('s') && !durationMatch[0].includes('ms')
                ? value * 1000
                : value;
        }

        results.suites = this.parseTestSuitesFromNodeOutput(output);

        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 通用 Node.js 测试输出解析
     */
    private parseGenericNodeOutput(framework: string, output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework,
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        const passedMatch = output.match(/(\d+)\s+(?:passed|passing)/i);
        const failedMatch = output.match(/(\d+)\s+(?:failed|failing)/i);
        const skippedMatch = output.match(/(\d+)\s+(?:skipped|pending)/i);

        if (passedMatch) results.passed = parseInt(passedMatch[1], 10);
        if (failedMatch) results.failed = parseInt(failedMatch[1], 10);
        if (skippedMatch) results.skipped = parseInt(skippedMatch[1], 10);
        results.totalTests = results.passed + results.failed + results.skipped;

        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 从 Node.js 测试输出中尽力解析测试套件和用例
     */
    private parseTestSuitesFromNodeOutput(output: string): TestSuite[] {
        const suites: TestSuite[] = [];
        const lines = output.split('\n');
        let currentSuite: TestSuite | null = null;

        for (const line of lines) {
            // 套件标题: PASS/FAIL/RUN src/foo.test.ts
            const suiteMatch = line.match(/^\s*(PASS|FAIL|RUNS?)\s+(.+)/);
            if (suiteMatch) {
                if (currentSuite && currentSuite.tests.length > 0) {
                    suites.push(currentSuite);
                }
                currentSuite = {name: suiteMatch[2].trim(), tests: []};
                continue;
            }

            // Vitest: ✓ > test name  Xms
            const vitestPass = line.match(/^\s*✓\s+(?:>\s+)?(.+?)(?:\s+(\d+)\s*ms)?$/);
            if (vitestPass && currentSuite) {
                currentSuite.tests.push({
                    name: vitestPass[1].trim(),
                    status: 'passed',
                    duration: parseInt(vitestPass[2] ?? '0', 10),
                });
                continue;
            }

            // 通过: ✓ should work (123 ms)
            const passMatch = line.match(/^\s*[✓✔√]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
            if (passMatch && currentSuite) {
                currentSuite.tests.push({
                    name: passMatch[1].trim(),
                    status: 'passed',
                    duration: parseInt(passMatch[2] ?? '0', 10),
                });
                continue;
            }

            // 失败: × should work
            const failMatch = line.match(/^\s*[✗✘×]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
            if (failMatch && currentSuite) {
                currentSuite.tests.push({
                    name: failMatch[1].trim(),
                    status: 'failed',
                    duration: parseInt(failMatch[2] ?? '0', 10),
                });
                continue;
            }

            // 跳过: ○ test name
            const skipMatch = line.match(/^\s*[○-]\s+(.+)/);
            if (skipMatch && currentSuite) {
                currentSuite.tests.push({
                    name: skipMatch[1].trim(),
                    status: 'skipped',
                    duration: 0,
                });
            }
        }

        if (currentSuite && currentSuite.tests.length > 0) {
            suites.push(currentSuite);
        }

        return suites;
    }
}
