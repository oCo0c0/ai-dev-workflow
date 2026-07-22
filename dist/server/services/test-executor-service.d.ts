/**
 * @file 测试执行服务
 * @description 提供测试框架自动检测、测试命令执行和测试结果解析的完整能力。
 *   基于 Provider 插件化架构，支持 Node.js（Vitest/Jest/Playwright）、Java（Maven/Gradle）、
 *   Python（Pytest/unittest）等多种项目类型。
 *   通过子进程方式执行测试命令，支持实时输出流式传输、超时控制和进程取消。
 */
import type { SandboxService } from './sandbox-service.js';
import type { ProjectInfo, TestTarget, TestResults } from './test-providers/types.js';
export type { TestResults, TestSuite, TestCase } from './test-providers/types.js';
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
/**
 * 测试执行服务类
 * @description 基于 Provider 架构的测试执行器。
 *   自动检测项目类型，选择合适的 Provider 生成命令并解析输出。
 *   支持多任务并发执行和单独取消。
 */
export declare class TestExecutorService {
    /** 活跃的测试子进程映射，key 为 taskId */
    private activeProcesses;
    private sandboxService;
    /** 注入沙箱服务 */
    setSandboxService(sandboxService: SandboxService): void;
    /**
     * 检测指定工作空间的完整项目信息
     * @param workspacePath - 项目工作空间路径
     * @returns 项目信息，包含类型、构建工具和测试框架
     */
    detectProject(workspacePath: string): ProjectInfo | null;
    /**
     * 检测指定工作空间中可用的测试框架
     * @description 向后兼容接口，返回简化的框架信息列表
     * @param workspacePath - 项目工作空间路径
     * @returns 所有框架的检测信息列表
     */
    detectFrameworks(workspacePath: string): TestFrameworkInfoCompat[];
    /**
     * 执行测试
     * @description 自动检测项目类型并选择 Provider，生成执行命令并运行。
     *   支持传入变更文件列表实现定向测试。
     * @param config - 测试运行配置
     * @param options - 测试运行选项
     * @returns 结构化的测试结果
     */
    runTests(config: TestRunConfig, options?: TestRunOptions): Promise<TestResults>;
    /**
     * 根据变更文件列出可运行的测试目标
     * @param workspacePath - 项目工作空间路径
     * @param changedFiles - 变更文件列表
     * @returns 测试目标列表
     */
    listTestTargets(workspacePath: string, changedFiles: string[]): TestTarget[];
    /**
     * 取消指定任务的测试进程
     * @param taskId - 任务 ID
     */
    cancel(taskId: string): void;
    /**
     * 取消所有正在运行的测试进程
     */
    cancelAll(): void;
    /**
     * 检查指定任务是否正在运行
     * @param taskId - 可选任务 ID，不传则检查是否有任何任务在运行
     */
    isRunning(taskId?: string): boolean;
    /**
     * 清除 Provider 检测缓存
     * @param workspacePath - 可选，指定路径则只清除该路径的缓存
     */
    clearCache(workspacePath?: string): void;
    /**
     * 将命令字符串解析为命令和参数数组。
     * 支持简单单/双引号包裹的参数，避免空格分割破坏带空格的参数值。
     */
    private parseCommand;
    /**
     * 执行测试命令并收集输出
     * @description 通过子进程执行，支持超时、中止信号和实时输出回调。
     *   使用 taskId 管理进程，支持多任务并发。
     */
    private executeTestCommand;
}
//# sourceMappingURL=test-executor-service.d.ts.map