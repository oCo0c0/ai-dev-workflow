/**
 * @file Python 测试 Provider
 * @description Python 项目的测试框架检测、目标发现、命令生成和输出解析。
 *   支持 Pytest 和 unittest 两种测试框架。
 */

import fs from 'fs';
import path from 'path';
import type {TestProvider, ProjectInfo, TestFrameworkDetail, TestTarget, TestResults} from './types.js';

/**
 * Python 测试 Provider
 * @description 检测 Python 项目中的测试框架，支持 Pytest 和标准库 unittest。
 */
export class PythonTestProvider implements TestProvider {
    type = 'python';
    priority = 30;

    /**
     * 检测项目是否为 Python 项目
     * @description 通过 requirements.txt、pyproject.toml、setup.py、Pipfile 等文件判断
     */
    detect(workspacePath: string): ProjectInfo | null {
        const pythonMarkers = [
            'requirements.txt', 'pyproject.toml', 'setup.py',
            'setup.cfg', 'Pipfile', 'poetry.lock', 'pdm.lock',
            'pytest.ini', 'conftest.py',
        ];

        let hasPythonMarker = false;
        for (const marker of pythonMarkers) {
            if (fs.existsSync(path.join(workspacePath, marker))) {
                hasPythonMarker = true;
                break;
            }
        }

        // 也检查是否有 .py 文件（作为弱信号）
        if (!hasPythonMarker) {
            try {
                const entries = fs.readdirSync(workspacePath);
                hasPythonMarker = entries.some(e => e.endsWith('.py'));
            } catch {
                return null;
            }
        }

        if (!hasPythonMarker) return null;

        const buildTool = this.detectBuildTool(workspacePath);
        const frameworks = this.detectFrameworks(workspacePath);

        return {
            type: 'python',
            label: `Python (${buildTool})`,
            buildTool,
            testFrameworks: frameworks,
            rootPath: workspacePath,
        };
    }

    /**
     * 根据变更文件列出可运行的测试目标
     * @description Python 映射规则：
     *   src/foo.py → tests/test_foo.py, test/test_foo.py
     *   app/bar.py → tests/test_bar.py
     */
    listTestTargets(workspacePath: string, changedFiles?: string[]): TestTarget[] {
        const targets: TestTarget[] = [];

        if (!changedFiles || changedFiles.length === 0) {
            return this.findAllTestFiles(workspacePath);
        }

        for (const file of changedFiles) {
            const normalized = file.replace(/\\/g, '/');

            // 测试文件本身就是目标
            if (normalized.includes('test_') || normalized.startsWith('test/') || normalized.includes('/tests/')) {
                targets.push({filePath: normalized, framework: 'pytest'});
                continue;
            }

            if (!normalized.endsWith('.py')) continue;
            // 排除 __init__.py, setup.py 等非源码文件
            if (normalized.endsWith('__init__.py') || normalized.endsWith('conftest.py')) continue;

            const moduleName = path.basename(normalized, '.py');
            const candidates = this.mapSourceToTestFiles(normalized, moduleName);

            for (const candidate of candidates) {
                const fullPath = path.join(workspacePath, candidate);
                if (fs.existsSync(fullPath)) {
                    targets.push({
                        filePath: candidate,
                        sourceFile: normalized,
                        framework: 'pytest',
                    });
                }
            }
        }

        return targets;
    }

    /**
     * 获取 Pytest/unittest 执行命令
     */
    getRunCommand(framework: string, targets?: TestTarget[], filter?: string): string {
        if (framework === 'unittest') {
            return this.getUnittestCommand(targets, filter);
        }

        // 默认 Pytest
        return this.getPytestCommand(targets, filter);
    }

    /**
     * 解析 Python 测试输出
     */
    parseOutput(framework: string, stdout: string, stderr: string, exitCode: number | null): TestResults {
        const combined = stdout + '\n' + stderr;

        if (framework === 'unittest') {
            return this.parseUnittestOutput(combined, exitCode);
        }

        return this.parsePytestOutput(combined, exitCode);
    }

    // === 私有方法 ===

    /**
     * 检测 Python 构建工具/包管理器
     */
    private detectBuildTool(workspacePath: string): string {
        if (fs.existsSync(path.join(workspacePath, 'poetry.lock'))) return 'poetry';
        if (fs.existsSync(path.join(workspacePath, 'pdm.lock'))) return 'pdm';
        if (fs.existsSync(path.join(workspacePath, 'Pipfile'))) return 'pipenv';
        if (fs.existsSync(path.join(workspacePath, 'uv.lock'))) return 'uv';
        return 'pip';
    }

    /**
     * 检测 Python 测试框架
     */
    private detectFrameworks(workspacePath: string): TestFrameworkDetail[] {
        const frameworks: TestFrameworkDetail[] = [];

        // Pytest 检测
        let pytestDetected = false;
        let pytestConfigFile: string | undefined;

        // 配置文件检测
        const pytestConfigFiles = ['pytest.ini', 'pyproject.toml', 'setup.cfg'];
        for (const cf of pytestConfigFiles) {
            const fp = path.join(workspacePath, cf);
            if (fs.existsSync(fp)) {
                try {
                    const content = fs.readFileSync(fp, 'utf-8');
                    if (cf === 'pytest.ini' || content.includes('[tool.pytest') || content.includes('[pytest]') || content.includes('pytest')) {
                        pytestConfigFile = cf;
                        pytestDetected = true;
                        break;
                    }
                } catch {
                    // 忽略
                }
            }
        }

        // conftest.py 也是 pytest 标志
        if (!pytestDetected && fs.existsSync(path.join(workspacePath, 'conftest.py'))) {
            pytestDetected = true;
            pytestConfigFile = 'conftest.py';
        }

        // requirements.txt 中查找 pytest 依赖
        if (!pytestDetected) {
            const reqPath = path.join(workspacePath, 'requirements.txt');
            if (fs.existsSync(reqPath)) {
                try {
                    const content = fs.readFileSync(reqPath, 'utf-8');
                    if (content.includes('pytest')) {
                        pytestDetected = true;
                    }
                } catch {
                    // 忽略
                }
            }
        }

        // tests/ 或 test/ 目录存在也作为弱信号
        if (!pytestDetected) {
            if (fs.existsSync(path.join(workspacePath, 'tests')) || fs.existsSync(path.join(workspacePath, 'test'))) {
                // 检查目录中是否有 test_*.py 文件
                const testDir = fs.existsSync(path.join(workspacePath, 'tests'))
                    ? path.join(workspacePath, 'tests')
                    : path.join(workspacePath, 'test');
                try {
                    const entries = fs.readdirSync(testDir);
                    if (entries.some(e => e.startsWith('test_') && e.endsWith('.py'))) {
                        pytestDetected = true;
                    }
                } catch {
                    // 忽略
                }
            }
        }

        frameworks.push({
            name: 'pytest',
            detected: pytestDetected,
            configFile: pytestConfigFile,
            command: 'pytest',
            supportsJsonOutput: true,
            jsonOutputArgs: ['--json-report', '--json-report-file=.pytest-result.json'],
        });

        // unittest（Python 标准库，始终可用）
        frameworks.push({
            name: 'unittest',
            detected: true,
            command: 'python -m unittest discover',
            supportsJsonOutput: false,
            jsonOutputArgs: [],
        });

        return frameworks;
    }

    /**
     * 映射源文件到候选测试文件
     */
    private mapSourceToTestFiles(sourcePath: string, moduleName: string): string[] {
        const dir = path.dirname(sourcePath);
        const testFileName = `test_${moduleName}.py`;

        return [
            `tests/${testFileName}`,
            `test/${testFileName}`,
            `${dir}/test_${moduleName}.py`,
            `${dir.replace(/\/src\/|\/app\//, '/tests/')}${testFileName}`,
        ];
    }

    /**
     * 生成 Pytest 命令
     */
    private getPytestCommand(targets?: TestTarget[], filter?: string): string {
        let command = 'pytest';

        if (targets && targets.length > 0) {
            const files = targets.map(t => t.filePath).join(' ');
            command += ` ${files}`;
        }

        if (filter) {
            command += ` -k "${filter}"`;
        }

        return command;
    }

    /**
     * 生成 unittest 命令
     */
    private getUnittestCommand(targets?: TestTarget[], filter?: string): string {
        if (targets && targets.length > 0) {
            const files = targets.map(t => t.filePath.replace(/\//g, '.').replace(/\.py$/, '')).join(' ');
            return `python -m unittest ${files}`;
        }

        if (filter) {
            return `python -m unittest discover -k "${filter}"`;
        }

        return 'python -m unittest discover';
    }

    /**
     * 扫描所有 Python 测试文件
     */
    private findAllTestFiles(workspacePath: string): TestTarget[] {
        const targets: TestTarget[] = [];
        const maxDepth = 5;
        const excludeDirs = new Set(['__pycache__', '.git', 'node_modules', '.venv', 'venv', 'env']);

        const walk = (dir: string, depth: number) => {
            if (depth > maxDepth) return;
            try {
                const entries = fs.readdirSync(dir, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        if (!excludeDirs.has(entry.name)) {
                            walk(path.join(dir, entry.name), depth + 1);
                        }
                    } else if (entry.name.startsWith('test_') && entry.name.endsWith('.py')) {
                        const relativePath = path.relative(workspacePath, path.join(dir, entry.name)).replace(/\\/g, '/');
                        targets.push({filePath: relativePath, framework: 'pytest'});
                    }
                }
            } catch {
                // 忽略权限错误
            }
        };

        walk(workspacePath, 0);
        return targets;
    }

    /**
     * 解析 Pytest 控制台输出
     */
    private parsePytestOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'pytest',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // Pytest 摘要: ===== X passed, Y failed, Z skipped in N.NNs =====
        const summaryMatch = output.match(/=+\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?.*?in\s+([\d.]+)s/);
        if (summaryMatch) {
            results.passed = parseInt(summaryMatch[1] ?? '0', 10);
            results.failed = parseInt(summaryMatch[2] ?? '0', 10);
            results.skipped = parseInt(summaryMatch[3] ?? '0', 10);
            results.totalTests = results.passed + results.failed + results.skipped;
            results.duration = parseFloat(summaryMatch[4] ?? '0') * 1000;
        }

        // 覆盖率: TOTAL NN NN XX%
        const coverageMatch = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/);
        if (coverageMatch) {
            results.coverage = parseInt(coverageMatch[1], 10);
        }

        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }

    /**
     * 解析 unittest 控制台输出
     */
    private parseUnittestOutput(output: string, exitCode: number | null): TestResults {
        const results: TestResults = {
            framework: 'unittest',
            totalTests: 0, passed: 0, failed: 0, skipped: 0,
            duration: 0, suites: [],
        };

        // unittest 输出: Ran X tests in N.NNNs
        const ranMatch = output.match(/Ran\s+(\d+)\s+tests?\s+in\s+([\d.]+)s/);
        if (ranMatch) {
            results.totalTests = parseInt(ranMatch[1], 10);
            results.duration = parseFloat(ranMatch[2]) * 1000;
        }

        // OK / FAILED (failures=X, errors=Y, skipped=Z)
        if (output.includes('OK')) {
            results.passed = results.totalTests;
        }
        const failedMatch = output.match(/failures=(\d+)/);
        if (failedMatch) {
            results.failed = parseInt(failedMatch[1], 10);
            results.passed = results.totalTests - results.failed;
        }
        const errorMatch = output.match(/errors=(\d+)/);
        if (errorMatch) {
            results.failed += parseInt(errorMatch[1], 10);
            results.passed = results.totalTests - results.failed;
        }
        const skipMatch = output.match(/skipped=(\d+)/);
        if (skipMatch) {
            results.skipped = parseInt(skipMatch[1], 10);
            results.passed = results.totalTests - results.failed - results.skipped;
        }

        if (results.totalTests === 0 && exitCode !== null) {
            results.totalTests = 1;
            results.passed = exitCode === 0 ? 1 : 0;
            results.failed = exitCode === 0 ? 0 : 1;
        }

        return results;
    }
}
