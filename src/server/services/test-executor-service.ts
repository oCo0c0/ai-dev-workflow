import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

// === Data Models ===

export interface TestFrameworkInfo {
  name: 'playwright' | 'jest' | 'pytest';
  detected: boolean;
  configFile?: string;
  command: string;
}

export interface TestResults {
  framework: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: number;
  suites: TestSuite[];
}

export interface TestSuite {
  name: string;
  tests: TestCase[];
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  screenshot?: string;
}

export interface TestRunConfig {
  workspacePath: string;
  framework: string;
  command?: string;
  filter?: string;
}

export interface TestRunOptions {
  onOutput?: (data: string) => void;
  onError?: (data: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// === Framework Detection Config ===

interface FrameworkDetectionRule {
  name: 'playwright' | 'jest' | 'pytest';
  configFiles: string[];
  packageJsonKey?: string;
  defaultCommand: string;
}

const FRAMEWORK_RULES: FrameworkDetectionRule[] = [
  {
    name: 'playwright',
    configFiles: [
      'playwright.config.ts',
      'playwright.config.js',
      'playwright.config.mjs',
    ],
    defaultCommand: 'npx playwright test',
  },
  {
    name: 'jest',
    configFiles: [
      'jest.config.ts',
      'jest.config.js',
      'jest.config.mjs',
    ],
    packageJsonKey: 'jest',
    defaultCommand: 'npx jest',
  },
  {
    name: 'pytest',
    configFiles: [
      'pytest.ini',
      'conftest.py',
    ],
    defaultCommand: 'pytest',
  },
];

// === Test Executor Service ===

export class TestExecutorService {
  private activeProcess: ChildProcess | null = null;

  /**
   * Detect available test frameworks in the given workspace.
   */
  detectFrameworks(workspacePath: string): TestFrameworkInfo[] {
    const resolvedPath = path.resolve(workspacePath);
    const results: TestFrameworkInfo[] = [];

    for (const rule of FRAMEWORK_RULES) {
      const detection = this.detectSingleFramework(resolvedPath, rule);
      results.push(detection);
    }

    return results;
  }

  /**
   * Run tests using the specified configuration.
   * Streams output via callbacks and returns structured results.
   */
  async runTests(
    config: TestRunConfig,
    options: TestRunOptions = {}
  ): Promise<TestResults> {
    const resolvedPath = path.resolve(config.workspacePath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Workspace directory does not exist: ${resolvedPath}`);
    }

    const command = config.command ?? this.getDefaultCommand(config.framework, config.filter);
    const { cmd, args } = this.parseCommand(command);

    const { stdout, stderr, exitCode } = await this.executeTestCommand(
      cmd,
      args,
      resolvedPath,
      options
    );

    return this.parseTestOutput(config.framework, stdout, stderr, exitCode);
  }

  /**
   * Cancel the currently running test process.
   */
  cancel(): void {
    if (this.activeProcess) {
      this.activeProcess.kill();
      this.activeProcess = null;
    }
  }

  /**
   * Check if tests are currently running.
   */
  isRunning(): boolean {
    return this.activeProcess !== null;
  }

  // === Private Methods ===

  /**
   * Detect a single framework based on its detection rules.
   */
  private detectSingleFramework(
    workspacePath: string,
    rule: FrameworkDetectionRule
  ): TestFrameworkInfo {
    // Check config files
    for (const configFile of rule.configFiles) {
      const fullPath = path.join(workspacePath, configFile);
      if (fs.existsSync(fullPath)) {
        return {
          name: rule.name,
          detected: true,
          configFile,
          command: rule.defaultCommand,
        };
      }
    }

    // Check pyproject.toml for pytest
    if (rule.name === 'pytest') {
      const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
      if (fs.existsSync(pyprojectPath)) {
        try {
          const content = fs.readFileSync(pyprojectPath, 'utf-8');
          if (content.includes('[tool.pytest]')) {
            return {
              name: rule.name,
              detected: true,
              configFile: 'pyproject.toml',
              command: rule.defaultCommand,
            };
          }
        } catch {
          // Ignore read errors
        }
      }
    }

    // Check package.json for jest
    if (rule.packageJsonKey) {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          const content = fs.readFileSync(packageJsonPath, 'utf-8');
          const pkg = JSON.parse(content);
          if (pkg[rule.packageJsonKey]) {
            return {
              name: rule.name,
              detected: true,
              configFile: 'package.json',
              command: rule.defaultCommand,
            };
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    return {
      name: rule.name,
      detected: false,
      command: rule.defaultCommand,
    };
  }

  /**
   * Get the default command for a framework, optionally with a filter.
   */
  private getDefaultCommand(framework: string, filter?: string): string {
    const rule = FRAMEWORK_RULES.find(r => r.name === framework);
    let command = rule?.defaultCommand ?? framework;

    if (filter) {
      switch (framework) {
        case 'playwright':
          command += ` --grep "${filter}"`;
          break;
        case 'jest':
          command += ` --testNamePattern="${filter}"`;
          break;
        case 'pytest':
          command += ` -k "${filter}"`;
          break;
        default:
          command += ` ${filter}`;
      }
    }

    return command;
  }

  /**
   * Parse a command string into command and arguments.
   */
  private parseCommand(command: string): { cmd: string; args: string[] } {
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);
    return { cmd, args };
  }

  /**
   * Execute a test command and collect output.
   */
  private executeTestCommand(
    cmd: string,
    args: string[],
    cwd: string,
    options: TestRunOptions
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      let stdout = '';
      let stderr = '';
      let resolved = false;
      const timeoutMs = options.timeoutMs ?? 300000; // 5 minutes default

      try {
        child = spawn(cmd, args, {
          cwd,
          env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        });
      } catch (err) {
        reject(new Error(`Failed to spawn test command "${cmd}": ${(err as Error).message}`));
        return;
      }

      this.activeProcess = child;

      // Handle timeout
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          this.activeProcess = null;
          resolve({ stdout, stderr, exitCode: null });
        }
      }, timeoutMs);

      // Handle abort signal
      if (options.signal) {
        if (options.signal.aborted) {
          child.kill();
          this.activeProcess = null;
          resolve({ stdout, stderr, exitCode: null });
          return;
        }

        options.signal.addEventListener('abort', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            child.kill();
            this.activeProcess = null;
            resolve({ stdout, stderr, exitCode: null });
          }
        }, { once: true });
      }

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        options.onOutput?.(text);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        options.onError?.(text);
      });

      child.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.activeProcess = null;
          reject(new Error(`Test command error: ${err.message}`));
        }
      });

      child.on('exit', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.activeProcess = null;
          resolve({ stdout, stderr, exitCode: code });
        }
      });
    });
  }

  /**
   * Parse test output into structured TestResults.
   * Attempts to extract meaningful data from the raw output.
   */
  private parseTestOutput(
    framework: string,
    stdout: string,
    stderr: string,
    exitCode: number | null
  ): TestResults {
    const combined = stdout + '\n' + stderr;

    switch (framework) {
      case 'jest':
        return this.parseJestOutput(combined, exitCode);
      case 'playwright':
        return this.parsePlaywrightOutput(combined, exitCode);
      case 'pytest':
        return this.parsePytestOutput(combined, exitCode);
      default:
        return this.parseGenericOutput(framework, combined, exitCode);
    }
  }

  /**
   * Parse Jest test output.
   */
  private parseJestOutput(output: string, exitCode: number | null): TestResults {
    const results: TestResults = {
      framework: 'jest',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      suites: [],
    };

    // Parse summary line: Tests: X passed, Y failed, Z total
    const testsMatch = output.match(/Tests:\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?[,\s]*(\d+)\s+total/);
    if (testsMatch) {
      results.passed = parseInt(testsMatch[1] ?? '0', 10);
      results.failed = parseInt(testsMatch[2] ?? '0', 10);
      results.skipped = parseInt(testsMatch[3] ?? '0', 10);
      results.totalTests = parseInt(testsMatch[4] ?? '0', 10);
    }

    // Parse time
    const timeMatch = output.match(/Time:\s+([\d.]+)\s*s/);
    if (timeMatch) {
      results.duration = parseFloat(timeMatch[1]) * 1000;
    }

    // Parse coverage
    const coverageMatch = output.match(/All files\s*\|\s*([\d.]+)/);
    if (coverageMatch) {
      results.coverage = parseFloat(coverageMatch[1]);
    }

    // Parse test suites from output
    results.suites = this.parseTestSuitesFromOutput(output);

    // If we couldn't parse anything, use exit code
    if (results.totalTests === 0 && exitCode !== null) {
      results.totalTests = exitCode === 0 ? 1 : 1;
      results.passed = exitCode === 0 ? 1 : 0;
      results.failed = exitCode === 0 ? 0 : 1;
    }

    return results;
  }

  /**
   * Parse Playwright test output.
   */
  private parsePlaywrightOutput(output: string, exitCode: number | null): TestResults {
    const results: TestResults = {
      framework: 'playwright',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      suites: [],
    };

    // Parse summary: X passed, Y failed, Z skipped
    const summaryMatch = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/);
    if (summaryMatch) {
      results.passed = parseInt(summaryMatch[1] ?? '0', 10);
      results.failed = parseInt(summaryMatch[2] ?? '0', 10);
      results.skipped = parseInt(summaryMatch[3] ?? '0', 10);
      results.totalTests = results.passed + results.failed + results.skipped;
    }

    // Parse duration
    const durationMatch = output.match(/(\d+(?:\.\d+)?)\s*(?:ms|s)/);
    if (durationMatch) {
      const value = parseFloat(durationMatch[1]);
      results.duration = durationMatch[0].includes('s') && !durationMatch[0].includes('ms')
        ? value * 1000
        : value;
    }

    results.suites = this.parseTestSuitesFromOutput(output);

    if (results.totalTests === 0 && exitCode !== null) {
      results.totalTests = exitCode === 0 ? 1 : 1;
      results.passed = exitCode === 0 ? 1 : 0;
      results.failed = exitCode === 0 ? 0 : 1;
    }

    return results;
  }

  /**
   * Parse PyTest test output.
   */
  private parsePytestOutput(output: string, exitCode: number | null): TestResults {
    const results: TestResults = {
      framework: 'pytest',
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      suites: [],
    };

    // Parse summary: X passed, Y failed, Z skipped in Ns
    const summaryMatch = output.match(/=+\s+(?:(\d+)\s+passed)?[,\s]*(?:(\d+)\s+failed)?[,\s]*(?:(\d+)\s+skipped)?.*?in\s+([\d.]+)s/);
    if (summaryMatch) {
      results.passed = parseInt(summaryMatch[1] ?? '0', 10);
      results.failed = parseInt(summaryMatch[2] ?? '0', 10);
      results.skipped = parseInt(summaryMatch[3] ?? '0', 10);
      results.totalTests = results.passed + results.failed + results.skipped;
      results.duration = parseFloat(summaryMatch[4] ?? '0') * 1000;
    }

    // Parse coverage
    const coverageMatch = output.match(/TOTAL\s+\d+\s+\d+\s+(\d+)%/);
    if (coverageMatch) {
      results.coverage = parseInt(coverageMatch[1], 10);
    }

    results.suites = this.parseTestSuitesFromOutput(output);

    if (results.totalTests === 0 && exitCode !== null) {
      results.totalTests = exitCode === 0 ? 1 : 1;
      results.passed = exitCode === 0 ? 1 : 0;
      results.failed = exitCode === 0 ? 0 : 1;
    }

    return results;
  }

  /**
   * Parse generic test output when framework is unknown.
   */
  private parseGenericOutput(framework: string, output: string, exitCode: number | null): TestResults {
    const results: TestResults = {
      framework,
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      suites: [],
    };

    // Try to find common patterns
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
   * Attempt to parse individual test cases from output.
   * This is a best-effort parser for common test output formats.
   */
  private parseTestSuitesFromOutput(output: string): TestSuite[] {
    const suites: TestSuite[] = [];
    const lines = output.split('\n');
    let currentSuite: TestSuite | null = null;

    for (const line of lines) {
      // Detect suite headers (common patterns)
      const suiteMatch = line.match(/^\s*(PASS|FAIL|RUNS?)\s+(.+)/);
      if (suiteMatch) {
        if (currentSuite && currentSuite.tests.length > 0) {
          suites.push(currentSuite);
        }
        currentSuite = { name: suiteMatch[2].trim(), tests: [] };
        continue;
      }

      // Detect individual test cases
      const passMatch = line.match(/^\s*[✓✔√●]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
      if (passMatch && currentSuite) {
        currentSuite.tests.push({
          name: passMatch[1].trim(),
          status: 'passed',
          duration: parseInt(passMatch[2] ?? '0', 10),
        });
        continue;
      }

      const failMatch = line.match(/^\s*[✗✘×●]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
      if (failMatch && currentSuite) {
        currentSuite.tests.push({
          name: failMatch[1].trim(),
          status: 'failed',
          duration: parseInt(failMatch[2] ?? '0', 10),
        });
        continue;
      }

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
