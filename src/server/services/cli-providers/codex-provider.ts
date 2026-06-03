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

// === 最小 TOML 解析器（仅覆盖 config.toml 用到的结构） ===

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

    /** Codex SDK 客户端实例 */
    private client: InstanceType<typeof import('@openai/codex-sdk').Codex> | null = null;
    /** 会话 ID → Thread ID 映射 */
    private sessionIdToThreadId = new Map<string, string>();
    /** Thread ID → 会话 ID 映射 */
    private threadIdToSessionId = new Map<string, string>();

    async detect(): Promise<CLIProviderStatus> {
        try {
            // 检查 API Key
            if (!process.env.OPENAI_API_KEY) {
                return {available: false, error: 'OPENAI_API_KEY environment variable not set'};
            }

            // 检查 SDK 是否安装（通过文件系统检测，避免 CJS 环境下 ESM 动态导入失败）
            let sdkPath: string | undefined;
            try {
                const resolved = require.resolve('@openai/codex-sdk/package.json');
                sdkPath = path.dirname(resolved);
            } catch {
                // require.resolve 在 ESM-only 包的 CJS 环境下也可能失败，尝试直接检查路径
                const candidates = [
                    path.join(process.cwd(), 'node_modules', '@openai', 'codex-sdk'),
                    path.join(__dirname, '..', '..', '..', '..', 'node_modules', '@openai', 'codex-sdk'),
                ];
                for (const c of candidates) {
                    if (fs.existsSync(path.join(c, 'package.json'))) {
                        sdkPath = c;
                        break;
                    }
                }
                if (!sdkPath) {
                    return {available: false, error: '@openai/codex-sdk not installed'};
                }
            }

            // 检查 codex CLI 是否安装
            let cliPath: string | undefined;
            try {
                cliPath = execSync('which codex 2>/dev/null || where codex 2>/dev/null', {encoding: 'utf-8'}).trim();
            } catch {
                // CLI 未安装但 SDK 可用，仍然可以使用
            }

            return {
                available: true,
                version: 'codex-sdk',
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
            });

            for await (const event of events) {
                if (options?.signal?.aborted) {
                    break;
                }

                switch (event.type) {
                    case 'item.completed': {
                        // 提取 agent 消息文本
                        const item = event.item as Record<string, unknown>;
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
                                } catch { /* skip */ }
                                break;
                            }
                        }
                        skills.push({name, description, enabled, filePath: skillPath});
                    }
                }
            } catch { /* ignore */ }
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
            } catch { /* skip */ }
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

    // === 内部方法 ===

    /** 动态导入并创建 Codex 客户端 */
    private async createClient(): Promise<InstanceType<typeof import('@openai/codex-sdk').Codex>> {
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

// === 辅助函数 ===

/** 从 Markdown 内容提取描述 */
function extractDescription(content: string): string {
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
function inferServerType(command?: string): string {
    if (!command) return 'custom';
    if (command.includes('node') || command.includes('npx')) return 'node';
    if (command.includes('python') || command.includes('uvx')) return 'python';
    if (command.includes('docker')) return 'docker';
    return 'custom';
}
