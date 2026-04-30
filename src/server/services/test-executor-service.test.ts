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

  describe('parseTestOutput', () => {
    describe('jest output parsing', () => {
      it('parses jest summary line', () => {
        const output = `
PASS src/utils.test.ts
Tests:  5 passed, 2 failed, 1 skipped, 8 total
Time:   3.45 s
`;
        const results = service.parseTestOutput('jest', output, '', 1);

        expect(results.passed).toBe(5);
        expect(results.failed).toBe(2);
        expect(results.skipped).toBe(1);
        expect(results.totalTests).toBe(8);
        expect(results.duration).toBeCloseTo(3450);
      });

      it('parses jest coverage', () => {
        const output = `
All files |   85.5 |   90.2 |   78.3 |   85.5
Tests:  10 passed, 10 total
Time:   2.1 s
`;
        const results = service.parseTestOutput('jest', output, '', 0);

        expect(results.coverage).toBeCloseTo(85.5);
      });

      it('handles jest output with only passed tests', () => {
        const output = 'Tests:  10 passed, 10 total\nTime:   1.2 s';
        const results = service.parseTestOutput('jest', output, '', 0);

        expect(results.passed).toBe(10);
        expect(results.failed).toBe(0);
        expect(results.totalTests).toBe(10);
      });
    });

    describe('playwright output parsing', () => {
      it('parses playwright summary', () => {
        const output = '  12 passed (5.2s)';
        const results = service.parseTestOutput('playwright', output, '', 0);

        expect(results.passed).toBe(12);
        expect(results.framework).toBe('playwright');
      });

      it('parses playwright with failures', () => {
        const output = '  8 passed, 2 failed (3.1s)';
        const results = service.parseTestOutput('playwright', output, '', 1);

        expect(results.passed).toBe(8);
        expect(results.failed).toBe(2);
        expect(results.totalTests).toBe(10);
      });
    });

    describe('pytest output parsing', () => {
      it('parses pytest summary', () => {
        const output = '====== 15 passed, 3 failed, 2 skipped in 4.56s ======';
        const results = service.parseTestOutput('pytest', output, '', 1);

        expect(results.passed).toBe(15);
        expect(results.failed).toBe(3);
        expect(results.skipped).toBe(2);
        expect(results.totalTests).toBe(20);
        expect(results.duration).toBeCloseTo(4560);
      });

      it('parses pytest coverage', () => {
        const output = `
TOTAL   500   50   90%
====== 10 passed in 2.0s ======
`;
        const results = service.parseTestOutput('pytest', output, '', 0);

        expect(results.coverage).toBe(90);
      });
    });

    describe('generic output parsing', () => {
      it('parses generic passed/failed patterns', () => {
        const output = '5 passing\n2 failing';
        const results = service.parseTestOutput('mocha', output, '', 1);

        expect(results.passed).toBe(5);
        expect(results.failed).toBe(2);
        expect(results.totalTests).toBe(7);
      });

      it('falls back to exit code when no patterns match', () => {
        const results = service.parseTestOutput('unknown', 'no parseable output', '', 0);

        expect(results.totalTests).toBe(1);
        expect(results.passed).toBe(1);
        expect(results.failed).toBe(0);
      });

      it('reports failure from exit code when no patterns match', () => {
        const results = service.parseTestOutput('unknown', 'error occurred', '', 1);

        expect(results.totalTests).toBe(1);
        expect(results.passed).toBe(0);
        expect(results.failed).toBe(1);
      });
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
