"use strict";
/**
 * @module codex-provider
 * @description OpenAI Codex CLI Provider 实现
 *
 * 通过 @openai/codex-sdk 直接调用 Codex CLI，无需子进程桥接。
 * 支持流式输出和会话续接。
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
exports.CodexProvider = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const error_utils_js_1 = require("../../utils/error-utils.js");
/** Codex 配置目录 */
const CODEX_DIR = path_1.default.join(os_1.default.homedir(), '.codex');
/**
 * OpenAI Codex CLI Provider
 * @description 通过 @openai/codex-sdk 直接 Node.js 调用，无需子进程
 */
class CodexProvider {
    id = 'codex';
    label = 'OpenAI Codex';
    /** Codex SDK 客户端实例 */
    client = null;
    /** 会话 ID → Thread ID 映射 */
    sessionIdToThreadId = new Map();
    /** Thread ID → 会话 ID 映射 */
    threadIdToSessionId = new Map();
    async detect() {
        try {
            // 检查 API Key
            if (!process.env.OPENAI_API_KEY) {
                return { available: false, error: 'OPENAI_API_KEY environment variable not set' };
            }
            // 检查 SDK 是否可导入
            let sdkPath;
            try {
                // ESM 动态导入检测
                const sdk = await Promise.resolve().then(() => __importStar(require('@openai/codex-sdk')));
                if (!sdk.Codex) {
                    return { available: false, error: '@openai/codex-sdk: Codex class not exported' };
                }
                sdkPath = '@openai/codex-sdk';
            }
            catch {
                return { available: false, error: '@openai/codex-sdk not installed' };
            }
            // 检查 codex CLI 是否安装
            let cliPath;
            try {
                cliPath = (0, child_process_1.execSync)('which codex 2>/dev/null || where codex 2>/dev/null', { encoding: 'utf-8' }).trim();
            }
            catch {
                // CLI 未安装但 SDK 可用，仍然可以使用
            }
            return {
                available: true,
                version: 'codex-sdk',
                path: cliPath || sdkPath,
            };
        }
        catch (err) {
            return { available: false, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    async initialize() {
        // Codex SDK 不需要预启动，按需创建客户端
        this.client = await this.createClient();
    }
    async run(input, options) {
        const client = await this.ensureClient();
        try {
            // 确定是否续接已有 thread
            let thread;
            if (input.sessionId) {
                const threadId = this.sessionIdToThreadId.get(input.sessionId);
                if (threadId) {
                    thread = client.resumeThread(threadId);
                }
                else {
                    thread = client.startThread({
                        workingDirectory: input.cwd,
                    });
                }
            }
            else {
                thread = client.startThread({
                    workingDirectory: input.cwd,
                });
            }
            // 生成会话 ID
            const sessionId = input.sessionId || `codex-${Date.now()}`;
            let stdout = '';
            // 使用 runStreamed 获取流式输出
            const { events } = await thread.runStreamed(input.prompt, {
                signal: options?.signal,
            });
            for await (const event of events) {
                if (options?.signal?.aborted) {
                    break;
                }
                switch (event.type) {
                    case 'item.completed': {
                        // 提取 agent 消息文本
                        const item = event.item;
                        if (item.type === 'agentMessage' && typeof item.text === 'string') {
                            stdout += item.text;
                            options?.onOutput?.(item.text);
                        }
                        // 提取命令执行输出
                        if (item.type === 'commandExecution' && typeof item.output === 'string') {
                            stdout += item.output;
                            options?.onOutput?.(item.output);
                        }
                        break;
                    }
                    case 'turn.completed':
                        // Turn 完成
                        break;
                }
            }
            // 保存 thread ID 映射
            const threadId = thread.id;
            if (threadId && typeof threadId === 'string') {
                this.sessionIdToThreadId.set(sessionId, threadId);
                this.threadIdToSessionId.set(threadId, sessionId);
            }
            if (options?.signal?.aborted) {
                return { exitCode: null, stdout, stderr: '', sessionId, aborted: true };
            }
            return { exitCode: 0, stdout, stderr: '', sessionId, aborted: false };
        }
        catch (err) {
            const message = (0, error_utils_js_1.getErrorMessage)(err);
            options?.onError?.(message);
            return { exitCode: 1, stdout: '', stderr: message, aborted: false };
        }
    }
    async loadSkills() {
        const skills = [];
        // Codex 的指令/配置存储在 ~/.codex/ 目录
        const instructionsDir = path_1.default.join(CODEX_DIR, 'instructions');
        if (fs_1.default.existsSync(instructionsDir)) {
            try {
                const entries = fs_1.default.readdirSync(instructionsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path_1.default.join(instructionsDir, entry.name);
                        try {
                            const content = fs_1.default.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: entry.name.replace(/\.md$/, ''),
                                description: extractDescription(content),
                                enabled: true,
                                filePath,
                            });
                        }
                        catch { /* skip */ }
                    }
                }
            }
            catch { /* ignore */ }
        }
        return skills;
    }
    async loadMcpServers() {
        // Codex MCP 配置（如有）
        const configFile = path_1.default.join(CODEX_DIR, 'config.json');
        if (!fs_1.default.existsSync(configFile)) {
            return [];
        }
        try {
            const raw = fs_1.default.readFileSync(configFile, 'utf-8');
            const config = JSON.parse(raw);
            const servers = [];
            if (config.mcpServers && typeof config.mcpServers === 'object') {
                for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
                    servers.push({
                        name,
                        type: inferServerType(serverConfig.command),
                        command: serverConfig.command ?? '',
                        enabled: true,
                    });
                }
            }
            return servers;
        }
        catch {
            return [];
        }
    }
    async dispose() {
        this.client = null;
        this.sessionIdToThreadId.clear();
        this.threadIdToSessionId.clear();
    }
    // === 内部方法 ===
    /** 动态导入并创建 Codex 客户端 */
    async createClient() {
        const { Codex } = await Promise.resolve().then(() => __importStar(require('@openai/codex-sdk')));
        return new Codex();
    }
    /** 确保客户端已初始化 */
    async ensureClient() {
        if (!this.client) {
            this.client = await this.createClient();
        }
        return this.client;
    }
}
exports.CodexProvider = CodexProvider;
// === 辅助函数 ===
/** 从 Markdown 内容提取描述 */
function extractDescription(content) {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
        }
        if (trimmed.startsWith('#')) {
            const headerText = trimmed.replace(/^#+\s*/, '');
            return headerText.length > 100 ? headerText.substring(0, 100) + '...' : headerText;
        }
    }
    return '';
}
/** 根据命令推断服务器类型 */
function inferServerType(command) {
    if (!command)
        return 'custom';
    if (command.includes('node') || command.includes('npx'))
        return 'node';
    if (command.includes('python') || command.includes('uvx'))
        return 'python';
    if (command.includes('docker'))
        return 'docker';
    return 'custom';
}
//# sourceMappingURL=codex-provider.js.map