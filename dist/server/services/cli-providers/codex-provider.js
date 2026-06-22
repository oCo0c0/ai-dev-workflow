"use strict";
/**
 * @module codex-provider
 * @description OpenAI Codex CLI Provider 实现
 *
 * 通过 @openai/codex-sdk 直接调用 Codex CLI，无需子进程桥接。
 * 支持流式输出和会话续接。
 */
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
const markdown_utils_js_1 = require("../../utils/markdown-utils.js");
/** Codex 配置目录 */
const CODEX_DIR = path_1.default.join(os_1.default.homedir(), '.codex');
/** Codex 配置文件路径（TOML 格式） */
const CODEX_CONFIG_FILE = path_1.default.join(CODEX_DIR, 'config.toml');
/**
 * 最小 TOML 解析器 —— 仅处理 `[section]` 表头和 `[[array.section]]` 数组表头，
 * 以及基础值类型（字符串、数字、布尔、内联数组）。
 * 不支持嵌套表、多行字符串、日期等高级特性。
 */
function parseTomlMinimal(content) {
    const result = { tables: {}, arrayTables: {} };
    let currentTarget = null;
    let currentKey = null;
    let isArrayTable = false;
    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        // 跳过空行和注释
        if (!line || line.startsWith('#'))
            continue;
        // 数组表头 [[xxx.yyy]]
        const arrayMatch = line.match(/^\[\[([^\]]+)\]\]$/);
        if (arrayMatch) {
            currentKey = arrayMatch[1].trim();
            isArrayTable = true;
            if (!result.arrayTables[currentKey])
                result.arrayTables[currentKey] = [];
            const entry = {};
            result.arrayTables[currentKey].push(entry);
            currentTarget = entry;
            continue;
        }
        // 普通表头 [xxx.yyy]
        const tableMatch = line.match(/^\[([^\]]+)\]$/);
        if (tableMatch) {
            currentKey = tableMatch[1].trim();
            isArrayTable = false;
            result.tables[currentKey] = {};
            currentTarget = result.tables[currentKey];
            continue;
        }
        // 键值对
        const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (kvMatch && currentTarget) {
            const [, k, rawVal] = kvMatch;
            currentTarget[k] = parseTomlValue(rawVal.trim());
        }
    }
    return result;
}
/** 解析单个 TOML 值 */
function parseTomlValue(raw) {
    // 布尔
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(raw))
        return Number(raw);
    // 字符串（双引号或单引号）
    const strMatch = raw.match(/^"(.*)"$/);
    if (strMatch)
        return strMatch[1];
    const strMatch2 = raw.match(/^'(.*)'$/);
    if (strMatch2)
        return strMatch2[1];
    // 内联数组
    if (raw.startsWith('[') && raw.endsWith(']')) {
        const inner = raw.slice(1, -1).trim();
        if (!inner)
            return [];
        return splitArrayElements(inner).map(v => parseTomlValue(v.trim()));
    }
    return raw;
}
/** 分割 TOML 数组元素（处理嵌套引号） */
function splitArrayElements(s) {
    const result = [];
    let current = '';
    let inStr = false;
    let strChar = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            current += c;
            if (c === strChar && s[i - 1] !== '\\')
                inStr = false;
        }
        else if (c === '"' || c === "'") {
            inStr = true;
            strChar = c;
            current += c;
        }
        else if (c === '[') {
            depth++;
            current += c;
        }
        else if (c === ']') {
            depth--;
            current += c;
        }
        else if (c === ',' && depth === 0) {
            result.push(current);
            current = '';
        }
        else {
            current += c;
        }
    }
    if (current.trim())
        result.push(current);
    return result;
}
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
            // 检查 SDK 是否安装（通过文件系统检测，避免 CJS 环境下 ESM 动态导入失败）
            let sdkPath;
            try {
                const resolved = require.resolve('@openai/codex-sdk/package.json');
                sdkPath = path_1.default.dirname(resolved);
            }
            catch {
                // require.resolve 在 ESM-only 包的 CJS 环境下也可能失败，尝试直接检查路径
                const candidates = [
                    path_1.default.join(process.cwd(), 'node_modules', '@openai', 'codex-sdk'),
                    path_1.default.join(__dirname, '..', '..', '..', '..', 'node_modules', '@openai', 'codex-sdk'),
                ];
                for (const c of candidates) {
                    if (fs_1.default.existsSync(path_1.default.join(c, 'package.json'))) {
                        sdkPath = c;
                        break;
                    }
                }
                if (!sdkPath) {
                    return { available: false, error: '@openai/codex-sdk not installed' };
                }
            }
            // 检查 codex CLI 是否安装（Windows 用 where，Unix 用 which，抑制 stderr 避免 GBK 乱码）
            let cliPath;
            try {
                const cmd = process.platform === 'win32' ? 'where codex' : 'which codex 2>/dev/null';
                cliPath = (0, child_process_1.execSync)(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
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
        // 来源 1：config.toml 中的 [[skills.config]] 数组表
        if (fs_1.default.existsSync(CODEX_CONFIG_FILE)) {
            try {
                const raw = fs_1.default.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
                const parsed = parseTomlMinimal(raw);
                const skillEntries = parsed.arrayTables['skills.config'];
                if (Array.isArray(skillEntries)) {
                    for (const entry of skillEntries) {
                        const skillPath = typeof entry.path === 'string' ? entry.path : '';
                        const enabled = entry.enabled !== false;
                        if (!skillPath)
                            continue;
                        const name = path_1.default.basename(skillPath);
                        let description = '';
                        // 尝试读取 skill 文件获取描述
                        const candidates = [skillPath, path_1.default.join(skillPath, 'SKILL.md'), path_1.default.join(skillPath, 'AGENTS.md')];
                        for (const candidate of candidates) {
                            if (fs_1.default.existsSync(candidate)) {
                                try {
                                    description = (0, markdown_utils_js_1.extractDescription)(fs_1.default.readFileSync(candidate, 'utf-8'));
                                }
                                catch { /* skip */ }
                                break;
                            }
                        }
                        skills.push({ name, description, enabled, filePath: skillPath });
                    }
                }
            }
            catch { /* ignore */ }
        }
        // 来源 2：AGENTS.md 文件（Codex 的另一种 skill 定义方式）
        const agentsFile = path_1.default.join(CODEX_DIR, 'AGENTS.md');
        if (fs_1.default.existsSync(agentsFile) && skills.length === 0) {
            try {
                const content = fs_1.default.readFileSync(agentsFile, 'utf-8');
                skills.push({
                    name: 'AGENTS',
                    description: (0, markdown_utils_js_1.extractDescription)(content),
                    enabled: true,
                    filePath: agentsFile,
                });
            }
            catch { /* skip */ }
        }
        return skills;
    }
    async loadMcpServers() {
        // Codex MCP 配置在 config.toml 的 [mcp_servers.<name>] 段
        if (!fs_1.default.existsSync(CODEX_CONFIG_FILE)) {
            return [];
        }
        try {
            const raw = fs_1.default.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
            const parsed = parseTomlMinimal(raw);
            const servers = [];
            for (const [sectionKey, sectionVal] of Object.entries(parsed.tables)) {
                // 匹配 mcp_servers.<name> 段
                const mcpMatch = sectionKey.match(/^mcp_servers\.(.+)$/);
                if (mcpMatch) {
                    const name = mcpMatch[1];
                    const cmd = typeof sectionVal.command === 'string' ? sectionVal.command : '';
                    servers.push({
                        name,
                        type: (0, markdown_utils_js_1.inferServerType)(cmd),
                        command: cmd,
                        args: Array.isArray(sectionVal.args) ? sectionVal.args : [],
                        env: (typeof sectionVal.env === 'object' && sectionVal.env !== null) ? sectionVal.env : {},
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
    /** 动态导入并创建 Codex 客户端 */
    async createClient() {
        // ESM-only SDK 在 CJS 编译产物中需要特殊处理：
        // 使用 Function 构造器绕过 bundler/tsc 的静态分析，确保运行时动态 import
        const dynamicImport = new Function('modulePath', 'return import(modulePath)');
        const { Codex } = await dynamicImport('@openai/codex-sdk');
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
//# sourceMappingURL=codex-provider.js.map