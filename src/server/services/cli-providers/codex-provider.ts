/**
 * @module codex-provider
 * @description OpenAI Codex CLI Provider 实现
 *
 * 通过 @openai/codex-sdk 直接调用 Codex CLI，无需子进程桥接。
 * 支持流式输出和会话续接。
 */

import {execSync} from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {getErrorMessage} from '../../utils/error-utils.js';
import {extractDescription, inferServerType} from '../../utils/markdown-utils.js';
import {ModelProviderStore} from '../model-provider-store.js';
import type {
    CLIProvider,
    CLIProviderStatus,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    SkillInfo,
    McpServerInfo,
} from './types.js';

/** Codex 配置目录 */
const CODEX_DIR = path.join(os.homedir(), '.codex');
/** Codex 配置文件路径（TOML 格式） */
const CODEX_CONFIG_FILE = path.join(CODEX_DIR, 'config.toml');

/**
 * 免 CLI 依赖：从自有模型供应商配置（models.json）读取 codex 的 API Key / Base URL，
 * 在环境变量未设置时注入到 process.env，供 @openai/codex-sdk 使用。
 *
 * 仅回填空缺（process.env 已设置时不动），避免覆盖外部配置。
 */
function applyOwnCodexEnv(): void {
    try {
        const store = new ModelProviderStore();
        const rec = store.get('codex');
        if (!rec || !rec.enabled) return;
        if (rec.apiKey && process.env.OPENAI_API_KEY === undefined) {
            process.env.OPENAI_API_KEY = rec.apiKey;
        }
        if (rec.baseUrl && process.env.OPENAI_BASE_URL === undefined) {
            process.env.OPENAI_BASE_URL = rec.baseUrl;
        }
        if (rec.env && typeof rec.env === 'object') {
            for (const [key, value] of Object.entries(rec.env)) {
                if (value && process.env[key] === undefined) process.env[key] = value;
            }
        }
    } catch {
        // 读取失败静默降级
    }
}

/** 解析结果：顶层 table + 数组表 */
interface TomlParseResult {
    tables: Record<string, Record<string, unknown>>;
    arrayTables: Record<string, Record<string, unknown>[]>;
}

/**
 * 最小 TOML 解析器 —— 仅处理 `[section]` 表头和 `[[array.section]]` 数组表头，
 * 以及基础值类型（字符串、数字、布尔、内联数组）。
 * 不支持嵌套表、多行字符串、日期等高级特性。
 */
function parseTomlMinimal(content: string): TomlParseResult {
    const result: TomlParseResult = {tables: {}, arrayTables: {}};
    let currentTarget: Record<string, unknown> | null = null;
    let currentKey: string | null = null;
    let isArrayTable = false;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        // 跳过空行和注释
        if (!line || line.startsWith('#')) continue;

        // 数组表头 [[xxx.yyy]]
        const arrayMatch = line.match(/^\[\[([^\]]+)\]\]$/);
        if (arrayMatch) {
            currentKey = arrayMatch[1].trim();
            isArrayTable = true;
            if (!result.arrayTables[currentKey]) result.arrayTables[currentKey] = [];
            const entry: Record<string, unknown> = {};
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
function parseTomlValue(raw: string): unknown {
    // 布尔
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // 数字
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    // 字符串（双引号或单引号）
    const strMatch = raw.match(/^"(.*)"$/);
    if (strMatch) return strMatch[1];
    const strMatch2 = raw.match(/^'(.*)'$/);
    if (strMatch2) return strMatch2[1];
    // 内联数组
    if (raw.startsWith('[') && raw.endsWith(']')) {
        const inner = raw.slice(1, -1).trim();
        if (!inner) return [];
        return splitArrayElements(inner).map(v => parseTomlValue(v.trim()));
    }
    return raw;
}

/** 分割 TOML 数组元素（处理嵌套引号） */
function splitArrayElements(s: string): string[] {
    const result: string[] = [];
    let current = '';
    let inStr = false;
    let strChar = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            current += c;
            if (c === strChar && s[i - 1] !== '\\') inStr = false;
        } else if (c === '"' || c === "'") {
            inStr = true;
            strChar = c;
            current += c;
        } else if (c === '[') {
            depth++;
            current += c;
        } else if (c === ']') {
            depth--;
            current += c;
        } else if (c === ',' && depth === 0) {
            result.push(current);
            current = '';
        } else {
            current += c;
        }
    }
    if (current.trim()) result.push(current);
    return result;
}

/**
 * OpenAI Codex CLI Provider
 * @description 通过 @openai/codex-sdk 直接 Node.js 调用，无需子进程
 */
export class CodexProvider implements CLIProvider {
    readonly id = 'codex' as const;
    readonly label = 'OpenAI Codex';

    readonly capabilities = {
        supportsPermission: false,
        supportsRuntimeSkills: false,
        supportsRuntimeMcp: false,
        supportsMaxTurns: false,
        supportsReasoningEffort: false,
        supportsExtendedThinking: false,
    } as const;

    /** Codex SDK 客户端实例 */
    private client: InstanceType<typeof import('@openai/codex-sdk').Codex> | null = null;
    /** 会话 ID → Thread ID 映射 */
    private sessionIdToThreadId = new Map<string, string>();
    /** Thread ID → 会话 ID 映射 */
    private threadIdToSessionId = new Map<string, string>();

    async detect(): Promise<CLIProviderStatus> {
        try {
            // 优先检查 codex CLI 是否安装（Windows 用 where，Unix 用 which，抑制 stderr 避免 GBK 乱码）
            let cliPath: string | undefined;
            try {
                const cmd = process.platform === 'win32' ? 'where codex' : 'which codex 2>/dev/null';
                cliPath = execSync(cmd, {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']}).trim();
            } catch {
                // CLI 未安装，继续检查 SDK
            }

            // 检查 SDK 是否安装（优先用 require.resolve，会自动在应用依赖中查找）
            let sdkPath: string | undefined;
            try {
                const resolved = require.resolve('@openai/codex-sdk/package.json');
                sdkPath = path.dirname(resolved);
            } catch {
                // require.resolve 失败，尝试从执行文件位置查找
                // 找到 __dirname 的真实位置（处理全局安装的符号链接）
                const realDir = fs.realpathSync(__dirname);

                // 从当前文件向上查找，最多尝试 6 级
                let current = realDir;
                for (let i = 0; i < 6; i++) {
                    const candidate = path.join(current, 'node_modules', '@openai', 'codex-sdk');
                    if (fs.existsSync(path.join(candidate, 'package.json'))) {
                        sdkPath = candidate;
                        break;
                    }
                    current = path.dirname(current);
                }
            }

            // CLI 或 SDK 至少一个可用即可
            if (!cliPath && !sdkPath) {
                return {
                    available: false,
                    error: 'Neither codex CLI nor @openai/codex-sdk installed. Run: npm install -g @openai/codex'
                };
            }

            return {
                available: true,
                version: cliPath ? 'codex-cli' : 'codex-sdk',
                path: cliPath || sdkPath,
            };
        } catch (err) {
            return {available: false, error: getErrorMessage(err)};
        }
    }

    async initialize(): Promise<void> {
        // Codex SDK 不需要预启动，按需创建客户端
        this.client = await this.createClient();
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        const client = await this.ensureClient();

        try {
            // 确定是否续接已有 thread
            let thread: InstanceType<typeof import('@openai/codex-sdk').Thread>;

            if (input.sessionId) {
                const threadId = this.sessionIdToThreadId.get(input.sessionId);
                if (threadId) {
                    thread = client.resumeThread(threadId);
                } else {
                    thread = client.startThread({
                        workingDirectory: input.cwd,
                    });
                }
            } else {
                thread = client.startThread({
                    workingDirectory: input.cwd,
                });
            }

            // 生成会话 ID
            const sessionId = input.sessionId || `codex-${Date.now()}`;

            let stdout = '';

            // 使用 runStreamed 获取流式输出
            const {events} = await thread.runStreamed(input.prompt, {
                signal: options?.signal,
                ...(options?.model ? {model: options.model} : {}),
            });

            for await (const event of events) {
                if (options?.signal?.aborted) {
                    break;
                }

                switch (event.type) {
                    case 'item.completed': {
                        const item = event.item as Record<string, unknown>;
                        // 提取 agent 消息文本
                        if (item.type === 'agentMessage' && typeof item.text === 'string') {
                            stdout += item.text;
                            options?.onOutput?.(item.text);
                        }
                        // 提取命令执行输出
                        if (item.type === 'commandExecution' && typeof item.output === 'string') {
                            stdout += item.output;
                            options?.onOutput?.(item.output);
                        }
                        // 提取思考/推理过程（Codex SDK reasoning item）
                        if (item.type === 'reasoning' && typeof item.text === 'string') {
                            options?.onOutput?.(item.text, {type: 'thinking'});
                        }
                        // tool 调用开始 + 完成
                        if (item.type === 'toolCall' || item.type === 'tool_use') {
                            const toolUseId = (item.id as string) || (item.callId as string) || '';
                            // 先广播 tool_use（running）
                            const funcInfo = (item.function as Record<string, unknown>) || {};
                            options?.onOutput?.('', {
                                type: 'tool_use',
                                toolName: (item.name as string) || (funcInfo.name as string) || 'Tool',
                                toolInput: (item.input as Record<string, unknown>) || (funcInfo.arguments as Record<string, unknown>) || {},
                                toolUseId,
                            });
                            // 再广播 tool_result（completed）
                            const isError = item.isError === true || item.error != null;
                            options?.onOutput?.(typeof item.output === 'string' ? item.output : '', {
                                type: 'tool_result',
                                toolUseId,
                                isError,
                            });
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
                return {exitCode: null, stdout, stderr: '', sessionId, aborted: true};
            }

            return {exitCode: 0, stdout, stderr: '', sessionId, aborted: false};
        } catch (err) {
            const message = getErrorMessage(err);
            options?.onError?.(message);
            return {exitCode: 1, stdout: '', stderr: message, aborted: false};
        }
    }

    async loadSkills(): Promise<SkillInfo[]> {
        const skills: SkillInfo[] = [];

        // 来源 1：config.toml 中的 [[skills.config]] 数组表
        if (fs.existsSync(CODEX_CONFIG_FILE)) {
            try {
                const raw = fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
                const parsed = parseTomlMinimal(raw);
                const skillEntries = parsed.arrayTables['skills.config'];
                if (Array.isArray(skillEntries)) {
                    for (const entry of skillEntries) {
                        const skillPath = typeof entry.path === 'string' ? entry.path : '';
                        const enabled = entry.enabled !== false;
                        if (!skillPath) continue;
                        const name = path.basename(skillPath);
                        let description = '';
                        // 尝试读取 skill 文件获取描述
                        const candidates = [skillPath, path.join(skillPath, 'SKILL.md'), path.join(skillPath, 'AGENTS.md')];
                        for (const candidate of candidates) {
                            if (fs.existsSync(candidate)) {
                                try {
                                    description = extractDescription(fs.readFileSync(candidate, 'utf-8'));
                                } catch { /* skip */
                                }
                                break;
                            }
                        }
                        skills.push({name, description, enabled, filePath: skillPath});
                    }
                }
            } catch { /* ignore */
            }
        }

        // 来源 2：AGENTS.md 文件（Codex 的另一种 skill 定义方式）
        const agentsFile = path.join(CODEX_DIR, 'AGENTS.md');
        if (fs.existsSync(agentsFile) && skills.length === 0) {
            try {
                const content = fs.readFileSync(agentsFile, 'utf-8');
                skills.push({
                    name: 'AGENTS',
                    description: extractDescription(content),
                    enabled: true,
                    filePath: agentsFile,
                });
            } catch { /* skip */
            }
        }

        return skills;
    }

    async loadMcpServers(): Promise<McpServerInfo[]> {
        // Codex MCP 配置在 config.toml 的 [mcp_servers.<name>] 段
        if (!fs.existsSync(CODEX_CONFIG_FILE)) {
            return [];
        }

        try {
            const raw = fs.readFileSync(CODEX_CONFIG_FILE, 'utf-8');
            const parsed = parseTomlMinimal(raw);
            const servers: McpServerInfo[] = [];

            for (const [sectionKey, sectionVal] of Object.entries(parsed.tables)) {
                // 匹配 mcp_servers.<name> 段
                const mcpMatch = sectionKey.match(/^mcp_servers\.(.+)$/);
                if (mcpMatch) {
                    const name = mcpMatch[1];
                    const cmd = typeof sectionVal.command === 'string' ? sectionVal.command : '';
                    servers.push({
                        name,
                        type: inferServerType(cmd),
                        command: cmd,
                        args: Array.isArray(sectionVal.args) ? sectionVal.args as string[] : [],
                        env: (typeof sectionVal.env === 'object' && sectionVal.env !== null) ? sectionVal.env as Record<string, string> : {},
                        enabled: true,
                    });
                }
            }

            return servers;
        } catch {
            return [];
        }
    }

    async dispose(): Promise<void> {
        this.client = null;
        this.sessionIdToThreadId.clear();
        this.threadIdToSessionId.clear();
    }

    /** 工具权限确认（Codex 暂不支持，空实现以满足接口） */
    confirmPermission(_permissionRequestId: string, _decision: 'allow' | 'deny', _message?: string, _modifiedInput?: Record<string, unknown>): void {
        // no-op: Codex 走自有 SDK，无 canUseTool 机制
    }

    /** 动态导入并创建 Codex 客户端 */
    private async createClient(): Promise<InstanceType<typeof import('@openai/codex-sdk').Codex>> {
        // 免 CLI 依赖：优先从自有配置注入 OPENAI_API_KEY / OPENAI_BASE_URL
        applyOwnCodexEnv();
        // ESM-only SDK 在 CJS 编译产物中需要特殊处理：
        // 使用 Function 构造器绕过 bundler/tsc 的静态分析，确保运行时动态 import
        const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (m: string) => Promise<typeof import('@openai/codex-sdk')>;
        const {Codex} = await dynamicImport('@openai/codex-sdk');
        return new Codex();
    }

    /** 确保客户端已初始化 */
    private async ensureClient(): Promise<InstanceType<typeof import('@openai/codex-sdk').Codex>> {
        if (!this.client) {
            this.client = await this.createClient();
        }
        return this.client;
    }
}
