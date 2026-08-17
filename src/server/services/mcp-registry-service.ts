/**
 * @file mcp-registry-service.ts
 * @description MCP 服务器注册中心（adw 自有数据源，provider 无关）
 *
 * 设计背景：MCP 服务器是 adw 的“资源”，不应绑定到某个 provider 的配置文件格式
 * （claude → ~/.claude.json / ~/.claude/settings.json、codex → ~/.codex/config.toml、
 *  pi → 无 MCP 概念）。因此：
 *   - 唯一数据源：~/.ai-dev-workbench/mcp-servers.json，UI / Bridge / 运行时注入统一读取
 *   - 启动导入：importFromProviders() 扫描 claude/codex/pi 本地配置，去重合并进注册中心
 *   - 切换 provider 不影响 MCP 列表（列表来自注册中心，而非激活的 provider）
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import {spawn} from 'child_process';
import {MCP_REGISTRY_FILE} from '../utils/constants.js';
import {getErrorMessage} from '../utils/error-utils.js';
import type {MCPServerConfig} from './mcp-config-service.js';

/** 禁止出现在 MCP 命令/参数中的 shell 元字符，防止命令注入 */
const SHELL_METACHARACTERS = /[;|&$()<>`"']/;

/**
 * 注册中心条目：在 MCPServerConfig 基础上增加来源标记
 */
export interface RegistryServerConfig extends MCPServerConfig {
    /** 来源：claude / codex / pi / manual（用户手动添加） */
    source?: string;
}

/** 注册中心文件内部结构 */
interface RegistryFile {
    version: number;
    servers: RegistryServerConfig[];
}

/**
 * 注册中心构造选项（主要用于测试隔离；默认指向用户真实配置文件）
 */
export interface MCPRegistryOptions {
    /** 注册中心文件路径，默认 ~/.ai-dev-workbench/mcp-servers.json */
    registryFile?: string;
    /** Claude 全局配置 ~/.claude.json */
    claudeGlobalFile?: string;
    /** Claude 项目级配置 ~/.claude/settings.json */
    claudeSettingsFile?: string;
    /** Codex 配置 ~/.codex/config.toml */
    codexConfigFile?: string;
    /** Pi 配置 ~/.pi/agent/settings.json */
    piSettingsFile?: string;
}

/** 导入统计结果 */
export interface McpImportStats {
    /** 本次新导入的服务器数 */
    imported: number;
    /** 按来源统计的新导入数 */
    sources: Record<string, number>;
}

/**
 * MCP 服务器注册中心服务
 */
export class MCPRegistryService {
    private registryFile: string;
    private claudeGlobalFile: string;
    private claudeSettingsFile: string;
    private codexConfigFile: string;
    private piSettingsFile: string;

    constructor(options?: MCPRegistryOptions) {
        this.registryFile = options?.registryFile ?? MCP_REGISTRY_FILE;
        this.claudeGlobalFile = options?.claudeGlobalFile ?? path.join(os.homedir(), '.claude.json');
        this.claudeSettingsFile = options?.claudeSettingsFile ?? path.join(os.homedir(), '.claude', 'settings.json');
        this.codexConfigFile = options?.codexConfigFile ?? path.join(os.homedir(), '.codex', 'config.toml');
        this.piSettingsFile = options?.piSettingsFile ?? path.join(os.homedir(), '.pi', 'agent', 'settings.json');
    }

    // === 公开方法 ===

    /**
     * 列出注册中心所有 MCP 服务器
     */
    list(): MCPServerConfig[] {
        return this.load();
    }

    /**
     * 按名称获取单个 MCP 服务器配置
     */
    get(name: string): MCPServerConfig | undefined {
        return this.load().find(s => s.name === name);
    }

    /**
     * 添加 MCP 服务器到注册中心
     * @throws 名称/命令为空或同名已存在时抛出
     */
    add(config: RegistryServerConfig): MCPServerConfig {
        if (!config.name || config.name.trim() === '') {
            throw new Error('MCP Server name is required');
        }
        validateMcpCommand(config.command);
        const args = validateMcpArgs(config.args);
        const env = validateMcpEnv(config.env);

        const list = this.load();
        if (list.some(s => s.name === config.name)) {
            throw new Error(`MCP Server "${config.name}" already exists`);
        }
        list.push({
            name: config.name,
            type: config.type ?? inferServerType(config.command),
            command: config.command,
            args,
            env,
            enabled: config.enabled ?? true,
            source: config.source ?? 'manual',
        });
        this.save(list);
        return list[list.length - 1];
    }

    /**
     * 更新注册中心中的 MCP 服务器（部分更新）
     * @throws 指定名称不存在时抛出
     */
    update(name: string, config: Partial<Omit<RegistryServerConfig, 'name'>>): MCPServerConfig {
        const list = this.load();
        const idx = list.findIndex(s => s.name === name);
        if (idx < 0) {
            throw new Error(`MCP Server "${name}" not found`);
        }
        const existing = list[idx];
        const updatedCommand = config.command ?? existing.command;
        validateMcpCommand(updatedCommand);
        const args = validateMcpArgs(config.args ?? existing.args);
        const env = validateMcpEnv(config.env ?? existing.env);

        const updated: RegistryServerConfig = {
            ...existing,
            ...config,
            name,
            command: updatedCommand,
            args,
            env,
            type: config.type ?? existing.type ?? inferServerType(updatedCommand),
            enabled: config.enabled ?? existing.enabled ?? true,
        };
        list[idx] = updated;
        this.save(list);
        return updated;
    }

    /**
     * 从注册中心删除 MCP 服务器
     */
    delete(name: string): boolean {
        const list = this.load();
        const next = list.filter(s => s.name !== name);
        if (next.length === list.length) return false;
        this.save(next);
        return true;
    }

    /**
     * 测试 MCP 服务器连接（实际启动进程验证可用性）
     */
    testConnection(name: string, timeoutMs: number = 5000): Promise<{
        status: 'connected' | 'error';
        message: string;
    }> {
        const config = this.get(name);
        if (!config) {
            return Promise.resolve({status: 'error', message: `MCP Server "${name}" not found`});
        }
        return testServerSpawn(config, timeoutMs);
    }

    /**
     * 注册中心文件路径
     */
    getRegistryFile(): string {
        return this.registryFile;
    }

    /**
     * 扫描各 provider 本地配置，把缺失的 MCP 服务器导入注册中心（不覆盖已存在项）
     * @description 来源：claude（~/.claude.json + ~/.claude/settings.json）、
     *   codex（~/.codex/config.toml 的 [mcp_servers.*]）、pi（~/.pi/agent/settings.json）。
     */
    importFromProviders(): McpImportStats {
        const candidates: Array<{
            source: string;
            servers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>
        }> = [];

        // 1. Claude：全局 + 项目级 settings 的 mcpServers
        for (const file of [this.claudeGlobalFile, this.claudeSettingsFile]) {
            const servers = this.readJsonMcpServers(file);
            if (servers.length > 0) candidates.push({source: 'claude', servers});
        }

        // 2. Codex：config.toml 的 [mcp_servers.<name>] 段
        const codexServers = this.readCodexMcpServers(this.codexConfigFile);
        if (codexServers.length > 0) candidates.push({source: 'codex', servers: codexServers});

        // 3. Pi：settings.json 的 mcpServers（pi 官方无 MCP，预留兼容）
        const piServers = this.readJsonMcpServers(this.piSettingsFile);
        if (piServers.length > 0) candidates.push({source: 'pi', servers: piServers});

        const list = this.load();
        let imported = 0;
        const sources: Record<string, number> = {};

        for (const {source, servers} of candidates) {
            for (const s of servers) {
                if (list.some(x => x.name === s.name)) continue; // 已存在不覆盖
                list.push({
                    name: s.name,
                    type: inferServerType(s.command),
                    command: s.command,
                    args: s.args ?? [],
                    env: s.env ?? {},
                    enabled: true,
                    source,
                });
                imported++;
                sources[source] = (sources[source] ?? 0) + 1;
            }
        }

        if (imported > 0) this.save(list);
        return {imported, sources};
    }

    // === 私有方法 ===

    /** 读取注册中心文件 */
    private load(): RegistryServerConfig[] {
        if (!fs.existsSync(this.registryFile)) return [];
        try {
            const raw = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'));
            if (raw && Array.isArray(raw.servers)) return raw.servers as RegistryServerConfig[];
            if (Array.isArray(raw)) return raw as RegistryServerConfig[]; // 兼容纯数组格式
        } catch {
            // 解析失败按空处理
        }
        return [];
    }

    /** 写入注册中心文件 */
    private save(servers: RegistryServerConfig[]): void {
        fs.mkdirSync(path.dirname(this.registryFile), {recursive: true});
        const data: RegistryFile = {version: 1, servers};
        fs.writeFileSync(this.registryFile, JSON.stringify(data, null, 2), 'utf-8');
    }

    /**
     * 读取 JSON 配置文件中的 mcpServers 对象（claude / pi 通用格式）
     * @returns [{name, command, args?, env?}]，文件缺失或格式不对返回空数组
     */
    private readJsonMcpServers(file: string): Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>
    }> {
        if (!fs.existsSync(file)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
            const mcp = parsed?.mcpServers;
            if (!mcp || typeof mcp !== 'object') return [];
            const out: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }> = [];
            for (const [name, cfg] of Object.entries(mcp as Record<string, {
                command?: string;
                args?: string[];
                env?: Record<string, string>;
            }>)) {
                if (typeof cfg?.command === 'string' && cfg.command.trim()) {
                    out.push({
                        name,
                        command: cfg.command,
                        args: Array.isArray(cfg.args) ? cfg.args : [],
                        env: (typeof cfg.env === 'object' && cfg.env !== null) ? cfg.env : {},
                    });
                }
            }
            return out;
        } catch {
            return [];
        }
    }

    /**
     * 读取 codex config.toml 的 [mcp_servers.<name>] 段（最小 TOML 解析，仅表头 + 键值）
     */
    private readCodexMcpServers(file: string): Array<{
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>
    }> {
        if (!fs.existsSync(file)) return [];
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const servers: Array<{
                name: string;
                command?: string;
                args?: string[];
                env?: Record<string, string>
            }> = [];
            let current: {
                name: string;
                command?: string;
                args?: string[];
                env?: Record<string, string>
            } | null = null;

            for (const rawLine of content.split('\n')) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) continue;

                // 表头 [mcp_servers.<name>]
                const tableMatch = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
                if (tableMatch) {
                    current = {name: tableMatch[1].trim()};
                    servers.push(current);
                    continue;
                }
                // 遇到其他表头则退出当前 mcp_servers 段
                const otherTable = line.match(/^\[[^\]]+\]$/);
                if (otherTable) {
                    current = null;
                    continue;
                }
                if (!current) continue;

                // 键值对
                const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
                if (!kv) continue;
                const key = kv[1];
                const val = parseTomlScalar(kv[2].trim());
                if (key === 'command') {
                    current.command = String(val);
                } else if (key === 'args') {
                    current.args = Array.isArray(val) ? val.map(String) : [];
                } else if (key === 'env' && typeof val === 'object' && val !== null) {
                    current.env = Object.fromEntries(
                        Object.entries(val as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
                    );
                }
            }

            return servers.filter((s): s is {
                name: string;
                command: string;
                args?: string[];
                env?: Record<string, string>
            } =>
                typeof s.command === 'string' && s.command.trim() !== '');
        } catch {
            return [];
        }
    }
}

// === 工具函数 ===

/** 校验 MCP 命令是否安全（禁止 shell 元字符） */
function validateMcpCommand(command: string): void {
    if (!command || command.trim() === '') {
        throw new Error('MCP Server command is required');
    }
    if (SHELL_METACHARACTERS.test(command)) {
        throw new Error('MCP Server command contains invalid characters');
    }
}

/** 校验 args 必须为字符串数组 */
function validateMcpArgs(args: unknown): string[] {
    if (args === undefined || args === null) return [];
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
        throw new Error('MCP Server args must be an array of strings');
    }
    return args as string[];
}

/** 校验 env 必须为字符串键值对象 */
function validateMcpEnv(env: unknown): Record<string, string> {
    if (env === undefined || env === null) return {};
    if (typeof env !== 'object' || Array.isArray(env)) {
        throw new Error('MCP Server env must be an object');
    }
    for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
        if (typeof v !== 'string') {
            throw new Error(`MCP Server env value for "${k}" must be a string`);
        }
    }
    return env as Record<string, string>;
}

/** 根据命令推断运行时类型（node/python/docker/custom） */
function inferServerType(command: string): string {
    const all = command.toLowerCase();
    if (all.includes('npx') || all.includes('node') || all.includes('.js')) return 'node';
    if (all.includes('python') || all.includes('.py')) return 'python';
    if (all.includes('docker')) return 'docker';
    return 'custom';
}

/** 解析单个 TOML 标量值（字符串/数字/布尔/内联数组/内联对象） */
function parseTomlScalar(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    const strMatch = raw.match(/^"(.*)"$/);
    if (strMatch) return strMatch[1];
    const strMatch2 = raw.match(/^'(.*)'$/);
    if (strMatch2) return strMatch2[1];
    if (raw.startsWith('[') && raw.endsWith(']')) {
        const inner = raw.slice(1, -1).trim();
        if (!inner) return [];
        return splitTomlArray(inner).map(v => parseTomlScalar(v.trim()));
    }
    if (raw.startsWith('{') && raw.endsWith('}')) {
        const inner = raw.slice(1, -1).trim();
        if (!inner) return {};
        const obj: Record<string, unknown> = {};
        for (const pair of splitTomlArray(inner)) {
            const eq = pair.indexOf('=');
            if (eq > 0) {
                const key = pair.slice(0, eq).trim().replace(/^"(.*)"$/, '$1');
                obj[key] = parseTomlScalar(pair.slice(eq + 1).trim());
            }
        }
        return obj;
    }
    return raw;
}

/** 分割 TOML 数组元素（处理嵌套引号与花括号） */
function splitTomlArray(s: string): string[] {
    const result: string[] = [];
    let current = '';
    let inStr = false;
    let strChar = '';
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            current += c;
            if (c === strChar) inStr = false;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = true;
            strChar = c;
            current += c;
            continue;
        }
        if (c === '[' || c === '{') depth++;
        if (c === ']' || c === '}') depth--;
        if (c === ',' && depth === 0) {
            result.push(current.trim());
            current = '';
            continue;
        }
        current += c;
    }
    if (current.trim()) result.push(current.trim());
    return result;
}

/** 实际启动 MCP 服务器进程验证连接（超时存活即成功） */
function testServerSpawn(config: MCPServerConfig, timeoutMs: number): Promise<{
    status: 'connected' | 'error';
    message: string;
}> {
    return new Promise((resolve) => {
        try {
            validateMcpCommand(config.command);
            const safeArgs = validateMcpArgs(config.args);
            const safeEnv = validateMcpEnv(config.env);

            const child = spawn(config.command, safeArgs, {
                env: {...process.env, ...safeEnv},
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
            });

            let resolved = false;
            const timer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    child.kill();
                    resolve({status: 'connected', message: 'MCP Server started successfully'});
                }
            }, timeoutMs);

            child.on('error', (err) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    resolve({status: 'error', message: `Failed to start: ${err.message}`});
                }
            });

            child.on('exit', (code) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    resolve(code === 0
                        ? {status: 'connected', message: 'MCP Server exited cleanly'}
                        : {status: 'error', message: `Process exited with code ${code}`});
                }
            });
        } catch (err) {
            resolve({status: 'error', message: `Failed to spawn process: ${getErrorMessage(err)}`});
        }
    });
}
