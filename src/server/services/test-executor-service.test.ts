/**
 * @file test-executor-service.test.ts
 * @description TestExecutorService（测试执行服务）的单元测试文件
 *
 * 本测试文件覆盖了 TestExecutorService 的核心功能，包括：
 * - 测试框架自动检测（Vitest、Jest、Playwright、Pytest）
 * - 项目类型检测（Node.js、Java、Python）
 * - 通过配置文件特征和 package.json 依赖识别不同框架
 * - 测试命令执行与结果解析
 * - 实时输出流回调机制
 * - AbortSignal 中止信号支持
 * - 运行状态查询与取消操作
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {TestExecutorService} from './test-executor-service.js';

describe('TestExecutorService', () => {
    let tempDir: string;
    let service: TestExecutorService;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-executor-test-'));
        service = new TestExecutorService();
    });

    afterEach(async () => {
        service.cancelAll();
        // 给进程一点时间释放文件锁
        await new Promise(r => setTimeout(r, 100));
        try {
            fs.rmSync(tempDir, {recursive: true, force: true});
        } catch {
            // Windows 下可能仍有文件锁，忽略清理失败
        }
    });

    describe('detectFrameworks', () => {
        it('returns frameworks for Node.js project with package.json', () => {
            // Node Provider 需要 package.json 才能匹配
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({name: 'test', scripts: {test: 'vitest'}}),
                'utf-8'
            );

            const results = service.detectFrameworks(tempDir);
            // Node 项目应返回 vitest, jest, playwright 三个框架
            expect(results.length).toBeGreaterThanOrEqual(2);
        });

        it('detects Vitest from package.json devDependencies', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    devDependencies: {vitest: '^1.0.0'},
                    scripts: {test: 'vitest run'},
                }),
                'utf-8'
            );

            const results = service.detectFrameworks(tempDir);
            const vitest = results.find(r => r.name === 'vitest');

            expect(vitest).toBeDefined();
            expect(vitest!.detected).toBe(true);
        });

        it('detects Vitest from vite.config.ts with test field', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({name: 'test'}),
                'utf-8'
            );
            fs.writeFileSync(
                path.join(tempDir, 'vite.config.ts'),
                'import { defineConfig } from "vitest/config"; export default defineConfig({ test: {} })',
                'utf-8'
            );

            const results = service.detectFrameworks(tempDir);
            const vitest = results.find(r => r.name === 'vitest');

            expect(vitest).toBeDefined();
            expect(vitest!.detected).toBe(true);
        });

        it('detects Jest from jest.config.ts', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({name: 'test'}),
                'utf-8'
            );
            fs.writeFileSync(path.join(tempDir, 'jest.config.ts'), 'export default {}', 'utf-8');

            const results = service.detectFrameworks(tempDir);
            const jest = results.find(r => r.name === 'jest');

            expect(jest).toBeDefined();
            expect(jest!.detected).toBe(true);
            expect(jest!.configFile).toBe('jest.config.ts');
        });

        it('detects Playwright from playwright.config.ts', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({
                    name: 'test',
                    devDependencies: {'@playwright/test': '^1.0.0'},
                }),
                'utf-8'
            );
            fs.writeFileSync(path.join(tempDir, 'playwright.config.ts'), 'export default {}', 'utf-8');

            const results = service.detectFrameworks(tempDir);
            const playwright = results.find(r => r.name === 'playwright');

            expect(playwright).toBeDefined();
            expect(playwright!.detected).toBe(true);
        });

        it('detects Pytest from pytest.ini (Python project)', () => {
            fs.writeFileSync(path.join(tempDir, 'pytest.ini'), '[pytest]\n', 'utf-8');

            const results = service.detectFrameworks(tempDir);
            const pytest = results.find(r => r.name === 'pytest');

            expect(pytest).toBeDefined();
            expect(pytest!.detected).toBe(true);
        });

        it('detects Pytest from conftest.py', () => {
            fs.writeFileSync(path.join(tempDir, 'conftest.py'), '# conftest', 'utf-8');

            const results = service.detectFrameworks(tempDir);
            const pytest = results.find(r => r.name === 'pytest');

            expect(pytest).toBeDefined();
            expect(pytest!.detected).toBe(true);
        });

        it('returns empty/default for unknown projects', () => {
            const results = service.detectFrameworks(tempDir);
            // 无 package.json 等标记文件时，不应匹配 Node Provider
            // 可能匹配 Python Provider 如果有 .py 文件，否则返回默认列表
            expect(results).toBeDefined();
            expect(Array.isArray(results)).toBe(true);
        });
    });

    describe('detectProject', () => {
        it('detects Node.js project', () => {
            fs.writeFileSync(
                path.join(tempDir, 'package.json'),
                JSON.stringify({name: 'test'}),
                'utf-8'
            );

            const info = service.detectProject(tempDir);
            expect(info).not.toBeNull();
            expect(info!.type).toBe('node');
            expect(info!.buildTool).toBe('npm');
        });

        it('detects Java Maven project', () => {
            fs.writeFileSync(path.join(tempDir, 'pom.xml'), '<project></project>', 'utf-8');

            const info = service.detectProject(tempDir);
            expect(info).not.toBeNull();
            expect(info!.type).toBe('java');
            expect(info!.buildTool).toBe('maven');
        });

        it('detects Java Gradle project', () => {
            fs.writeFileSync(path.join(tempDir, 'build.gradle'), 'plugins {}', 'utf-8');

            const info = service.detectProject(tempDir);
            expect(info).not.toBeNull();
            expect(info!.type).toBe('java');
            expect(info!.buildTool).toBe('gradle');
        });

        it('detects Python project', () => {
            fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'pytest\n', 'utf-8');

            const info = service.detectProject(tempDir);
            expect(info).not.toBeNull();
            expect(info!.type).toBe('python');
        });

        it('returns null for unknown project', () => {
            const info = service.detectProject(tempDir);
            expect(info).toBeNull();
        });
    });

    describe('runTests', () => {
        it('throws when workspace does not exist', async () => {
            await expect(
                service.runTests({
                    workspacePath: '/nonexistent/path/xyz',
                    framework: 'jest',
                })
            ).rejects.toThrow('does not exist');
        });

        it('runs a simple test command and returns results', async () => {
            const outputs: string[] = [];

            const results = await service.runTests(
                {
                    workspacePath: tempDir,
                    framework: 'jest',
                    command: 'echo "Tests: 3 passed, 1 failed, 4 total"',
                },
                {onOutput: (data) => outputs.push(data)}
            );

            expect(results.framework).toBe('jest');
            expect(results.passed).toBe(3);
            expect(results.failed).toBe(1);
            expect(results.totalTests).toBe(4);
            expect(outputs.length).toBeGreaterThan(0);
        });

        it('streams output via callback', async () => {
            const outputs: string[] = [];

            await service.runTests(
                {
                    workspacePath: tempDir,
                    framework: 'jest',
                    command: 'echo "test output line"',
                },
                {onOutput: (data) => outputs.push(data)}
            );

            expect(outputs.join('')).toContain('test output line');
        });

        it('supports abort signal', async () => {
            const controller = new AbortController();

            const promise = service.runTests(
                {
                    workspacePath: tempDir,
                    framework: 'jest',
                    command: 'sleep 30',
                },
                {signal: controller.signal}
            );

            setTimeout(() => controller.abort(), 100);

            const results = await promise;
            expect(results.framework).toBe('jest');
        });
    });

    describe('isRunning', () => {
        it('returns false when no tests are running', () => {
            expect(service.isRunning()).toBe(false);
        });
    });

    describe('cancelAll', () => {
        it('does nothing when no tests are running', () => {
            expect(() => service.cancelAll()).not.toThrow();
        });
    });
});
