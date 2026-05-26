"use strict";
/**
 * @file 测试执行服务
 * @description 提供测试框架自动检测、测试命令执行和测试结果解析的完整能力。
 *   基于 Provider 插件化架构，支持 Node.js（Vitest/Jest/Playwright）、Java（Maven/Gradle）、
 *   Python（Pytest/unittest）等多种项目类型。
 *   通过子进程方式执行测试命令，支持实时输出流式传输、超时控制和进程取消。
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestExecutorService = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const error_utils_js_1 = require("../utils/error-utils.js");
const index_js_1 = require("./test-providers/index.js");
// === 测试执行服务 ===
/**
 * 测试执行服务类
 * @description 基于 Provider 架构的测试执行器。
 *   自动检测项目类型，选择合适的 Provider 生成命令并解析输出。
 *   支持多任务并发执行和单独取消。
 */
class TestExecutorService {
    /** 活跃的测试子进程映射，key 为 taskId */
    activeProcesses = new Map();
    sandboxService = null;
    /** 注入沙箱服务 */
    setSandboxService(sandboxService) {
        this.sandboxService = sandboxService;
    }
    /**
     * 检测指定工作空间的完整项目信息
     * @param workspacePath - 项目工作空间路径
     * @returns 项目信息，包含类型、构建工具和测试框架
     */
    detectProject(workspacePath) {
        return (0, index_js_1.detectProvider)(workspacePath)?.info ?? null;
    }
    /**
     * 检测指定工作空间中可用的测试框架
     * @description 向后兼容接口，返回简化的框架信息列表
     * @param workspacePath - 项目工作空间路径
     * @returns 所有框架的检测信息列表
     */
    detectFrameworks(workspacePath) {
        const result = (0, index_js_1.detectProvider)(workspacePath);
        if (!result) {
            // 无法检测时返回空框架列表
            return [
                { name: 'playwright', detected: false, command: 'npx playwright test' },
                { name: 'jest', detected: false, command: 'npx jest' },
                { name: 'pytest', detected: false, command: 'pytest' },
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
    async runTests(config, options = {}) {
        const resolvedPath = path_1.default.resolve(config.workspacePath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error(`Workspace directory does not exist: ${resolvedPath}`);
        }
        const taskId = config.taskId ?? `test-${Date.now()}`;
        // 检测 Provider
        const detection = (0, index_js_1.detectProvider)(resolvedPath);
        let provider;
        let projectInfo;
        if (detection) {
            provider = detection.provider;
            projectInfo = detection.info;
        }
        else {
            // 无匹配 Provider，使用通用兜底
            provider = (0, index_js_1.getGenericProvider)();
            projectInfo = (0, index_js_1.getGenericProvider)().createProjectInfo(resolvedPath);
        }
        // 确定要使用的框架
        const framework = config.framework ?? projectInfo.testFrameworks.find(f => f.detected)?.name ?? 'custom';
        // 生成执行命令
        let command;
        if (config.command) {
            // 用户自定义命令优先
            command = config.command;
        }
        else if (config.changedFiles && config.changedFiles.length > 0) {
            // 变更文件定向测试
            const targets = provider.listTestTargets(resolvedPath, config.changedFiles);
            if (targets.length > 0) {
                command = provider.getRunCommand(framework, targets, config.filter);
            }
            else {
                // 无匹配测试目标，跑全量
                command = provider.getRunCommand(framework, undefined, config.filter);
            }
        }
        else {
            // 全量测试
            command = provider.getRunCommand(framework, undefined, config.filter);
        }
        const { cmd, args } = this.parseCommand(command);
        // 沙箱模式：config 中指定了 sandboxId 且 sandboxService 可用时，在远程沙箱执行测试
        if (config.sandboxId && this.sandboxService?.isEnabled()) {
            console.log(`[test] Running tests in sandbox: ${config.sandboxId}`);
            const result = await this.sandboxService.executeCommand(resolvedPath, command, resolvedPath, undefined, config.sandboxId);
            if (result) {
                if (result.stdout && options.onOutput)
                    options.onOutput(result.stdout);
                if (result.stderr && options.onError)
                    options.onError(result.stderr);
                return provider.parseOutput(framework, result.stdout, result.stderr, result.exitCode);
            }
            // 沙箱不可用（找不到/连接失败），抛出错误而非静默回退本地
            throw new Error(`Sandbox "${config.sandboxId}" is not available. Please check the sandbox ID and ensure the sandbox is running.`);
        }
        // 本地模式：通过子进程执行
        const { stdout, stderr, exitCode } = await this.executeTestCommand(cmd, args, resolvedPath, taskId, options);
        // 如果是 Java 项目，尝试解析 Surefire 报告（更可靠）
        if (provider.type === 'java') {
            const { JavaTestProvider } = await Promise.resolve().then(() => __importStar(require('./test-providers/java-provider.js')));
            if (provider instanceof JavaTestProvider) {
                const surefireResult = provider.parseSurefireReports(resolvedPath);
                if (surefireResult)
                    return surefireResult;
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
    listTestTargets(workspacePath, changedFiles) {
        const detection = (0, index_js_1.detectProvider)(workspacePath);
        if (!detection)
            return [];
        return detection.provider.listTestTargets(workspacePath, changedFiles);
    }
    /**
     * 取消指定任务的测试进程
     * @param taskId - 任务 ID
     */
    cancel(taskId) {
        const proc = this.activeProcesses.get(taskId);
        if (proc) {
            proc.kill();
            this.activeProcesses.delete(taskId);
        }
    }
    /**
     * 取消所有正在运行的测试进程
     */
    cancelAll() {
        for (const [id, proc] of this.activeProcesses) {
            proc.kill();
            this.activeProcesses.delete(id);
        }
    }
    /**
     * 检查指定任务是否正在运行
     * @param taskId - 可选任务 ID，不传则检查是否有任何任务在运行
     */
    isRunning(taskId) {
        if (taskId)
            return this.activeProcesses.has(taskId);
        return this.activeProcesses.size > 0;
    }
    /**
     * 清除 Provider 检测缓存
     * @param workspacePath - 可选，指定路径则只清除该路径的缓存
     */
    clearCache(workspacePath) {
        (0, index_js_1.clearDetectCache)(workspacePath);
    }
    // === 私有方法 ===
    /**
     * 将命令字符串解析为命令和参数数组
     */
    parseCommand(command) {
        const parts = command.split(/\s+/);
        const cmd = parts[0];
        const args = parts.slice(1);
        return { cmd, args };
    }
    /**
     * 执行测试命令并收集输出
     * @description 通过子进程执行，支持超时、中止信号和实时输出回调。
     *   使用 taskId 管理进程，支持多任务并发。
     */
    executeTestCommand(cmd, args, cwd, taskId, options) {
        return new Promise((resolve, reject) => {
            let child;
            let stdout = '';
            let stderr = '';
            let resolved = false;
            const timeoutMs = options.timeoutMs ?? 300000; // 默认 5 分钟
            try {
                child = (0, child_process_1.spawn)(cmd, args, {
                    cwd,
                    env: { ...process.env, FORCE_COLOR: '0', CI: 'true' },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    shell: true,
                });
            }
            catch (err) {
                reject(new Error(`Failed to spawn test command "${cmd}": ${(0, error_utils_js_1.getErrorMessage)(err)}`));
                return;
            }
            this.activeProcesses.set(taskId, child);
            // 超时控制
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    child.kill();
                    this.activeProcesses.delete(taskId);
                    resolve({ stdout, stderr, exitCode: null });
                }
            }, timeoutMs);
            // 中止信号
            if (options.signal) {
                if (options.signal.aborted) {
                    child.kill();
                    this.activeProcesses.delete(taskId);
                    resolve({ stdout, stderr, exitCode: null });
                    return;
                }
                options.signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        child.kill();
                        this.activeProcesses.delete(taskId);
                        resolve({ stdout, stderr, exitCode: null });
                    }
                }, { once: true });
            }
            // 收集输出
            child.stdout?.on('data', (data) => {
                const text = data.toString();
                stdout += text;
                options.onOutput?.(text);
            });
            child.stderr?.on('data', (data) => {
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
                    resolve({ stdout, stderr, exitCode: code });
                }
            });
        });
    }
}
exports.TestExecutorService = TestExecutorService;
//# sourceMappingURL=test-executor-service.js.map