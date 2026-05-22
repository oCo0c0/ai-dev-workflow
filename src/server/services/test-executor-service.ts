/**
 * @file 测试执行服务
 * @description 提供测试框架自动检测、测试命令执行和测试结果解析的完整能力。
 *   基于 Provider 插件化架构，支持 Node.js（Vitest/Jest/Playwright）、Java（Maven/Gradle）、
 *   Python（Pytest/unittest）等多种项目类型。
 *   通过子进程方式执行测试命令，支持实时输出流式传输、超时控制和进程取消。
 */

import {spawn, ChildProcess} from 'child_process';
import fs from 'fs';
import path from 'path';
import {getErrorMessage} from '../utils/error-utils.js';
import type {SandboxService} from './sandbox-service.js';
import {
    detectProvider,
    getProvider,
    getGenericProvider,
    clearDetectCache,
} from './test-providers/index.js';
import type {
    TestProvider,
    ProjectInfo,
    TestFrameworkDetail,
    TestTarget,
    TestResults,
    TestFrameworkInfo,
} from './test-providers/types.js';

// === 重新导出类型，保持向后兼容 ===

export type {TestResults, TestSuite, TestCase} from './test-providers/types.js';

// === 数据模型定义 ===

/**
 * 测试框架检测信息接口（向后兼容）
 * @deprecated 新代码应使用 TestFrameworkDetail
 */
export interface TestFrameworkInfoCompat {
    name: string;
    detected: boolean;
    configFile?: string;
    command: string;
}

/**
 * 测试运行配置接口
 */
export interface TestRunConfig {
    /** 项目工作空间路径 */
    workspacePath: string;
    /** 测试框架名称 */
    framework?: string;
    /** 自定义测试执行命令（可选，不指定则由 Provider 自动生成） */
    command?: string;
    /** 测试过滤条件（可选，用于按名称筛选测试用例） */
    filter?: string;
    /** 变更文件列表（可选，用于定向测试） */
    changedFiles?: string[];
    /** 任务 ID（可选，用于多任务管理和取消） */
    taskId?: string;
    /** 指定沙箱 ID 时在远程沙箱执行测试，不指定则本地执行 */
    sandboxId?: string;
}

/**
 * 测试运行选项接口
 */
export interface TestRunOptions {
    /** 标准输出回调 */
    onOutput?: (data: string) => void;
    /** 标准错误回调 */
    onError?: (data: string) => void;
    /** 中止信号 */
    signal?: AbortSignal;
    /** 超时时间（毫秒），默认 5 分钟 */
    timeoutMs?: number;
}

// === 测试执行服务 ===

/**
 * 测试执行服务类
 * @description 基于 Provider 架构的测试执行器。
 *   自动检测项目类型，选择合适的 Provider 生成命令并解析输出。
 *   支持多任务并发执行和单独取消。
 */
export class TestExecutorService {
    /** 活跃的测试子进程映射，key 为 taskId */
    private activeProcesses = new Map<string, ChildProcess>();
    private sandboxService: SandboxService | null = null;

    /** 注入沙箱服务 */
    setSandboxService(sandboxService: SandboxService): void {
        this.sandboxService = sandboxService;
    }

    /**
     * 检测指定工作空间的完整项目信息
     * @param workspacePath - 项目工作空间路径
     * @returns 项目信息，包含类型、构建工具和测试框架
     */
    detectProject(workspacePath: string): ProjectInfo | null {
        return detectProvider(workspacePath)?.info ?? null;
    }

    /**
     * 检测指定工作空间中可用的测试框架
     * @description 向后兼容接口，返回简化的框架信息列表
     * @param workspacePath - 项目工作空间路径
     * @returns 所有框架的检测信息列表
     */
    detectFrameworks(workspacePath: string): TestFrameworkInfoCompat[] {
        const result = detectProvider(workspacePath);
        if (!result) {
            // 无法检测时返回空框架列表
            return [
                {name: 'playwright', detected: false, command: 'npx playwright test'},
                {name: 'jest', detected: false, command: 'npx jest'},
                {name: 'pytest', detected: false, command: 'pytest'},
            ];
        }

        return result.info.testFrameworks.map(f => ({
            name: f.name,
            detected: f.detected,
            configFile: f.configFile,
            command: f.command,
        }));
    }

    /**
     * 执行测试
     * @description 自动检测项目类型并选择 Provider，生成执行命令并运行。
     *   支持传入变更文件列表实现定向测试。
     * @param config - 测试运行配置
     * @param options - 测试运行选项
     * @returns 结构化的测试结果
     */
    async runTests(
        config: TestRunConfig,
        options: TestRunOptions = {}
    ): Promise<TestResults> {
        const resolvedPath = path.resolve(config.workspacePath);

        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Workspace directory does not exist: ${resolvedPath}`);
        }

        const taskId = config.taskId ?? `test-${Date.now()}`;

        // 检测 Provider
        const detection = detectProvider(resolvedPath);
        let provider: TestProvider;
        let projectInfo: ProjectInfo;

        if (detection) {
            provider = detection.provider;
            projectInfo = detection.info;
        } else {
            // 无匹配 Provider，使用通用兜底
            provider = getGenericProvider();
            projectInfo = getGenericProvider().createProjectInfo(resolvedPath);
        }

        // 确定要使用的框架
        const framework = config.framework ?? projectInfo.testFrameworks.find(f => f.detected)?.name ?? 'custom';

        // 生成执行命令
        let command: string;
        if (config.command) {
            // 用户自定义命令优先
            command = config.command;
        } else if (config.changedFiles && config.changedFiles.length > 0) {
            // 变更文件定向测试
            const targets = provider.listTestTargets(resolvedPath, config.changedFiles);
            if (targets.length > 0) {
                command = provider.getRunCommand(framework, targets, config.filter);
            } else {
                // 无匹配测试目标，跑全量
                command = provider.getRunCommand(framework, undefined, config.filter);
            }
        } else {
            // 全量测试
            command = provider.getRunCommand(framework, undefined, config.filter);
        }

        const {cmd, args} = this.parseCommand(command);

        // 沙箱模式：config 中指定了 sandboxId 且 sandboxService 可用时，在远程沙箱执行测试
        if (config.sandboxId && this.sandboxService?.isEnabled()) {
            console.log(`[test] Running tests in sandbox: ${config.sandboxId}`);
            const result = await this.sandboxService.executeCommand(
                resolvedPath,
                command,
                resolvedPath,
                undefined,
                config.sandboxId,
            );
            if (result) {
                if (result.stdout && options.onOutput) options.onOutput(result.stdout);
                if (result.stderr && options.onError) options.onError(result.stderr);
                return provider.parseOutput(framework, result.stdout, result.stderr, result.exitCode);
            }
            // 沙箱不可用（找不到/连接失败），抛出错误而非静默回退本地
            throw new Error(`Sandbox "${config.sandboxId}" is not available. Please check the sandbox ID and ensure the sandbox is running.`);
        }

        // 本地模式：通过子进程执行
        const {stdout, stderr, exitCode} = await this.executeTestCommand(
            cmd,
            args,
            resolvedPath,
            taskId,
            options
        );

        // 如果是 Java 项目，尝试解析 Surefire 报告（更可靠）
        if (provider.type === 'java') {
            const {JavaTestProvider} = await import('./test-providers/java-provider.js');
            if (provider instanceof JavaTestProvider) {
                const surefireResult = provider.parseSurefireReports(resolvedPath);
                if (surefireResult) return surefireResult;
            }
        }

        // 使用 Provider 解析输出
        return provider.parseOutput(framework, stdout, stderr, exitCode);
    }

    /**
     * 根据变更文件列出可运行的测试目标
     * @param workspacePath - 项目工作空间路径
     * @param changedFiles - 变更文件列表
     * @returns 测试目标列表
     */
    listTestTargets(workspacePath: string, changedFiles: string[]): TestTarget[] {
        const detection = detectProvider(workspacePath);
        if (!detection) return [];

        return detection.provider.listTestTargets(workspacePath, changedFiles);
    }

    /**
     * 取消指定任务的测试进程
     * @param taskId - 任务 ID
     */
    cancel(taskId: string): void {
        const proc = this.activeProcesses.get(taskId);
        if (proc) {
            proc.kill();
            this.activeProcesses.delete(taskId);
        }
    }

    /**
     * 取消所有正在运行的测试进程
     */
    cancelAll(): void {
        for (const [id, proc] of this.activeProcesses) {
            proc.kill();
            this.activeProcesses.delete(id);
        }
    }

    /**
     * 检查指定任务是否正在运行
     * @param taskId - 可选任务 ID，不传则检查是否有任何任务在运行
     */
    isRunning(taskId?: string): boolean {
        if (taskId) return this.activeProcesses.has(taskId);
        return this.activeProcesses.size > 0;
    }

    /**
     * 清除 Provider 检测缓存
     * @param workspacePath - 可选，指定路径则只清除该路径的缓存
     */
    clearCache(workspacePath?: string): void {
        clearDetectCache(workspacePath);
    }

    // === 私有方法 ===

    /**
     * 将命令字符串解析为命令和参数数组
     */
    private parseCommand(command: string): { cmd: string; args: string[] } {
        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        return {cmd, args};
    }

    /**
     * 执行测试命令并收集输出
     * @description 通过子进程执行，支持超时、中止信号和实时输出回调。
     *   使用 taskId 管理进程，支持多任务并发。
     */
    private executeTestCommand(
        cmd: string,
        args: string[],
        cwd: string,
        taskId: string,
        options: TestRunOptions
    ): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
        return new Promise((resolve, reject) => {
            let child: ChildProcess;
            let stdout = '';
            let stderr = '';
            let resolved = false;
            const timeoutMs = options.timeoutMs ?? 300000; // 默认 5 分钟

            try {
                child = spawn(cmd, args, {
                    cwd,
                    env: {...process.env, FORCE_COLOR: '0', CI: 'true'},
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true,
                });
            } catch (err) {
                reject(new Error(`Failed to spawn test command "${cmd}": ${getErrorMessage(err)}`));
                return;
            }

            this.activeProcesses.set(taskId, child);

            // 超时控制
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    child.kill();
                    this.activeProcesses.delete(taskId);
                    resolve({stdout, stderr, exitCode: null});
                }
            }, timeoutMs);

            // 中止信号
            if (options.signal) {
                if (options.signal.aborted) {
                    child.kill();
                    this.activeProcesses.delete(taskId);
                    resolve({stdout, stderr, exitCode: null});
                    return;
                }

                options.signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        child.kill();
                        this.activeProcesses.delete(taskId);
                        resolve({stdout, stderr, exitCode: null});
                    }
                }, {once: true});
            }

            // 收集输出
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
                    this.activeProcesses.delete(taskId);
                    reject(new Error(`Test command error: ${err.message}`));
                }
            });

            child.on('exit', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    this.activeProcesses.delete(taskId);
                    resolve({stdout, stderr, exitCode: code});
                }
            });
        });
    }
}
