import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TestExecutorService } from './test-executor-service.js';

describe('TestExecutorService', () => {
  let tempDir: string;
  let service: TestExecutorService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-executor-test-'));
    service = new TestExecutorService();
  });

  afterEach(() => {
    service.cancel();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('detectFrameworks', () => {
    it('returns all frameworks as not detected for empty directory', () => {
      const results = service.detectFrameworks(tempDir);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.detected === false)).toBe(true);
    });

    it('detects Playwright from playwright.config.ts', () => {
      fs.writeFileSync(path.join(tempDir, 'playwright.config.ts'), 'export default {}', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const playwright = results.find(r => r.name === 'playwright')!;

      expect(playwright.detected).toBe(true);
      expect(playwright.configFile).toBe('playwright.config.ts');
      expect(playwright.command).toBe('npx playwright test');
    });

    it('detects Playwright from playwright.config.js', () => {
      fs.writeFileSync(path.join(tempDir, 'playwright.config.js'), 'module.exports = {}', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const playwright = results.find(r => r.name === 'playwright')!;

      expect(playwright.detected).toBe(true);
      expect(playwright.configFile).toBe('playwright.config.js');
    });

    it('detects Playwright from playwright.config.mjs', () => {
      fs.writeFileSync(path.join(tempDir, 'playwright.config.mjs'), 'export default {}', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const playwright = results.find(r => r.name === 'playwright')!;

      expect(playwright.detected).toBe(true);
      expect(playwright.configFile).toBe('playwright.config.mjs');
    });

    it('detects Jest from jest.config.ts', () => {
      fs.writeFileSync(path.join(tempDir, 'jest.config.ts'), 'export default {}', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const jest = results.find(r => r.name === 'jest')!;

      expect(jest.detected).toBe(true);
      expect(jest.configFile).toBe('jest.config.ts');
      expect(jest.command).toBe('npx jest');
    });

    it('detects Jest from jest.config.js', () => {
      fs.writeFileSync(path.join(tempDir, 'jest.config.js'), 'module.exports = {}', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const jest = results.find(r => r.name === 'jest')!;

      expect(jest.detected).toBe(true);
      expect(jest.configFile).toBe('jest.config.js');
    });

    it('detects Jest from package.json jest field', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', jest: { testEnvironment: 'node' } }),
        'utf-8'
      );

      const results = service.detectFrameworks(tempDir);
      const jest = results.find(r => r.name === 'jest')!;

      expect(jest.detected).toBe(true);
      expect(jest.configFile).toBe('package.json');
    });

    it('does not detect Jest from package.json without jest field', () => {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test', scripts: { test: 'vitest' } }),
        'utf-8'
      );

      const results = service.detectFrameworks(tempDir);
      const jest = results.find(r => r.name === 'jest')!;

      expect(jest.detected).toBe(false);
    });

    it('detects PyTest from pytest.ini', () => {
      fs.writeFileSync(path.join(tempDir, 'pytest.ini'), '[pytest]\n', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const pytest = results.find(r => r.name === 'pytest')!;

      expect(pytest.detected).toBe(true);
      expect(pytest.configFile).toBe('pytest.ini');
      expect(pytest.command).toBe('pytest');
    });

    it('detects PyTest from conftest.py', () => {
      fs.writeFileSync(path.join(tempDir, 'conftest.py'), '# conftest', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const pytest = results.find(r => r.name === 'pytest')!;

      expect(pytest.detected).toBe(true);
      expect(pytest.configFile).toBe('conftest.py');
    });

    it('detects PyTest from pyproject.toml with [tool.pytest]', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pyproject.toml'),
        '[tool.pytest]\ntestpaths = ["tests"]\n',
        'utf-8'
      );

      const results = service.detectFrameworks(tempDir);
      const pytest = results.find(r => r.name === 'pytest')!;

      expect(pytest.detected).toBe(true);
      expect(pytest.configFile).toBe('pyproject.toml');
    });

    it('does not detect PyTest from pyproject.toml without [tool.pytest]', () => {
      fs.writeFileSync(
        path.join(tempDir, 'pyproject.toml'),
        '[tool.poetry]\nname = "myproject"\n',
        'utf-8'
      );

      const results = service.detectFrameworks(tempDir);
      const pytest = results.find(r => r.name === 'pytest')!;

      expect(pytest.detected).toBe(false);
    });

    it('detects multiple frameworks simultaneously', () => {
      fs.writeFileSync(path.join(tempDir, 'playwright.config.ts'), '', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'jest.config.js'), '', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'conftest.py'), '', 'utf-8');

      const results = service.detectFrameworks(tempDir);
      const detected = results.filter(r => r.detected);

      expect(detected).toHaveLength(3);
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
        { onOutput: (data) => outputs.push(data) }
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
        { onOutput: (data) => outputs.push(data) }
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
        { signal: controller.signal }
      );

      setTimeout(() => controller.abort(), 100);

      const results = await promise;
      // When aborted, we get default results
      expect(results.framework).toBe('jest');
    });
  });

  describe('isRunning', () => {
    it('returns false when no tests are running', () => {
      expect(service.isRunning()).toBe(false);
    });
  });

  describe('cancel', () => {
    it('does nothing when no tests are running', () => {
      expect(() => service.cancel()).not.toThrow();
    });
  });
});
