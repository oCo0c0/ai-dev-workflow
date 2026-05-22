"use strict";
/**
 * @module claude-provider
 * @description Claude Code CLI Provider 实现
 *
 * 封装 Claude Agent SDK 的桥接进程管理，从原有的 BridgeProcess 类迁移而来。
 * 通过持久化子进程（claude-bridge.mjs）+ JSON 行协议实现双向通信。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeProvider = void 0;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const error_utils_js_1 = require("../../utils/error-utils.js");
/** 桥接脚本路径（编译后相对 dist/server/services/） */
const BRIDGE_SCRIPT = path_1.default.resolve(__dirname, '../../../bridge/claude-bridge.mjs');
/** Claude 配置根目录 */
const CLAUDE_DIR = path_1.default.join(os_1.default.homedir(), '.claude');
/** 全局命令目录 */
const COMMANDS_DIR = path_1.default.join(CLAUDE_DIR, 'commands');
/** 技能目录 */
const SKILLS_DIR = path_1.default.join(CLAUDE_DIR, 'skills');
/** Claude 设置文件 */
const SETTINGS_FILE = path_1.default.join(CLAUDE_DIR, 'settings.json');
/**
 * Claude Code CLI Provider
 * @description 通过持久化桥接子进程与 Claude Agent SDK 通信
 */
class ClaudeProvider {
    id = 'claude';
    label = 'Claude Code';
    process = null;
    ready = false;
    buffer = '';
    pendingRequests = new Map();
    readyCallbacks = [];
    startPromise = null;
    async detect() {
        try {
            // 检查桥接脚本是否存在
            if (!fs_1.default.existsSync(BRIDGE_SCRIPT)) {
                return { available: false, error: `Bridge script not found: ${BRIDGE_SCRIPT}` };
            }
            // 检查 @anthropic-ai/claude-agent-sdk 是否可导入
            let sdkPath;
            try {
                const resolved = require.resolve('@anthropic-ai/claude-agent-sdk');
                sdkPath = resolved;
            }
            catch {
                return { available: false, error: '@anthropic-ai/claude-agent-sdk not installed' };
            }
            return {
                available: true,
                version: 'claude-agent-sdk',
                path: sdkPath,
            };
        }
        catch (err) {
            return { available: false, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    async initialize() {
        await this.ensureStarted();
    }
    async run(input, options) {
        await this.ensureStarted();
        if (!this.process || !this.ready) {
            throw new Error('Bridge process is not ready');
        }
        const requestId = crypto_1.default.randomUUID();
        return new Promise((resolve, reject) => {
            const req = {
                onOutput: options?.onOutput,
                onError: options?.onError,
                resolve,
                reject,
                stdout: '',
                aborted: false,
            };
            if (options?.signal) {
                if (options.signal.aborted) {
                    resolve({ exitCode: null, stdout: '', stderr: '', aborted: true });
                    return;
                }
                const abortHandler = () => {
                    req.aborted = true;
                    this.pendingRequests.delete(requestId);
                    resolve({ exitCode: null, stdout: req.stdout, stderr: '', aborted: true });
                };
                req.abortHandler = abortHandler;
                options.signal.addEventListener('abort', abortHandler, { once: true });
            }
            this.pendingRequests.set(requestId, req);
            const message = JSON.stringify({ requestId, ...input }) + '\n';
            const proc = this.process;
            if (proc && proc.stdin) {
                proc.stdin.write(message);
            }
            else {
                this.pendingRequests.delete(requestId);
                reject(new Error('Bridge process stdin not available'));
            }
        });
    }
    async loadSkills() {
        const skills = [];
        // 扫描 commands/ 目录
        if (fs_1.default.existsSync(COMMANDS_DIR)) {
            try {
                const entries = fs_1.default.readdirSync(COMMANDS_DIR, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path_1.default.join(COMMANDS_DIR, entry.name);
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
        // 扫描 skills/ 目录
        if (fs_1.default.existsSync(SKILLS_DIR)) {
            try {
                const entries = fs_1.default.readdirSync(SKILLS_DIR, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const skillDir = path_1.default.join(SKILLS_DIR, entry.name);
                        const mdFile = findSkillMdFile(skillDir);
                        if (mdFile) {
                            try {
                                const content = fs_1.default.readFileSync(mdFile, 'utf-8');
                                skills.push({
                                    name: entry.name,
                                    description: extractDescription(content),
                                    enabled: true,
                                    filePath: mdFile,
                                });
                            }
                            catch { /* skip */ }
                        }
                    }
                    else if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path_1.default.join(SKILLS_DIR, entry.name);
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
        if (!fs_1.default.existsSync(SETTINGS_FILE)) {
            return [];
        }
        try {
            const raw = fs_1.default.readFileSync(SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(raw);
            const servers = [];
            if (settings.mcpServers && typeof settings.mcpServers === 'object') {
                for (const [name, config] of Object.entries(settings.mcpServers)) {
                    servers.push({
                        name,
                        type: inferServerType(config.command),
                        command: config.command ?? '',
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
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.ready = false;
        }
        this.startPromise = null;
    }
    // === 内部桥接进程管理（从原 BridgeProcess 迁移） ===
    async ensureStarted() {
        if (this.ready && this.process)
            return;
        if (this.startPromise)
            return this.startPromise;
        this.startPromise = this.start();
        return this.startPromise;
    }
    start() {
        return new Promise((resolve, reject) => {
            console.log(`[claude-provider] spawning: node ${BRIDGE_SCRIPT}`);
            // 清除 NODE_OPTIONS 中的 inspector 参数，避免子进程启动 debugger
            const env = { ...process.env };
            if (env.NODE_OPTIONS) {
                env.NODE_OPTIONS = env.NODE_OPTIONS
                    .split(/\s+/)
                    .filter((opt) => !opt.startsWith('--inspect') && !opt.startsWith('--debug'))
                    .join(' ');
            }
            const child = (0, child_process_1.spawn)('node', [BRIDGE_SCRIPT], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
            });
            this.process = child;
            const timeout = setTimeout(() => {
                reject(new Error('Bridge process failed to start within 30 seconds'));
                child.kill();
            }, 30000);
            child.stdout.on('data', (chunk) => {
                this.buffer += chunk.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        this.handleMessage(JSON.parse(line));
                    }
                    catch { /* ignore non-JSON */ }
                }
            });
            child.stderr.on('data', (chunk) => {
                const text = chunk.toString();
                console.error(`[claude-provider] stderr: ${text.trim()}`);
                for (const req of this.pendingRequests.values()) {
                    req.onError?.(text);
                }
            });
            child.on('error', (err) => {
                console.error(`[claude-provider] process error: ${err.message}`);
                clearTimeout(timeout);
                this.ready = false;
                this.process = null;
                this.startPromise = null;
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error(`Bridge process error: ${err.message}`));
                }
                this.pendingRequests.clear();
                reject(err);
            });
            child.on('exit', (code) => {
                console.error(`[claude-provider] process exited with code ${code}`);
                clearTimeout(timeout);
                this.ready = false;
                this.process = null;
                this.startPromise = null;
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error(`Bridge process exited with code ${code}`));
                }
                this.pendingRequests.clear();
            });
            this.readyCallbacks.push(() => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }
    handleMessage(msg) {
        if (msg.type === 'ready') {
            this.ready = true;
            this.startPromise = null;
            for (const cb of this.readyCallbacks)
                cb();
            this.readyCallbacks = [];
            return;
        }
        const requestId = msg.requestId;
        if (!requestId)
            return;
        const req = this.pendingRequests.get(requestId);
        if (!req)
            return;
        switch (msg.type) {
            case 'output':
                if (msg.content) {
                    req.stdout += msg.content;
                    req.onOutput?.(msg.content);
                }
                break;
            case 'session':
                if (msg.sessionId) {
                    req.sessionId = msg.sessionId;
                }
                break;
            case 'error':
                req.onError?.(msg.message || 'Unknown error');
                this.pendingRequests.delete(requestId);
                req.resolve({
                    exitCode: 1,
                    stdout: req.stdout,
                    stderr: msg.message || '',
                    aborted: req.aborted,
                    sessionId: req.sessionId,
                });
                break;
            case 'done':
                this.pendingRequests.delete(requestId);
                req.resolve({
                    exitCode: msg.exitCode ?? 0,
                    stdout: req.stdout,
                    stderr: '',
                    aborted: req.aborted,
                    sessionId: req.sessionId,
                });
                break;
        }
    }
}
exports.ClaudeProvider = ClaudeProvider;
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
/** 在技能子目录中查找主 .md 文件 */
function findSkillMdFile(dirPath) {
    try {
        const files = fs_1.default.readdirSync(dirPath);
        const skillMd = files.find(f => f === 'SKILL.md');
        if (skillMd)
            return path_1.default.join(dirPath, skillMd);
        const indexMd = files.find(f => f === 'index.md');
        if (indexMd)
            return path_1.default.join(dirPath, indexMd);
        const firstMd = files.find(f => f.endsWith('.md'));
        if (firstMd)
            return path_1.default.join(dirPath, firstMd);
        return null;
    }
    catch {
        return null;
    }
}
/** 根据命令推断 MCP 服务器类型 */
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
//# sourceMappingURL=claude-provider.js.map