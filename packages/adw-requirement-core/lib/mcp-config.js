/**
 * @module mcp-config-service
 * @description MCP（Model Context Protocol）服务器配置管理服务模块
 *
 * 该模块负责管理 MCP 服务器配置。MCP 是一种协议，允许 agent 通过
 * 外部工具服务器扩展其能力（ONES / GitHub 需求源等）。
 * 配置存储完全自管：由调用方指定配置文件路径（dsh-adw 插件使用
 * `~/.dsh/dsh-adw/mcp-servers.json`），不读写任何其他工具的配置文件。
 *
 * 主要功能：
 * - MCP 服务器配置的增删改查（CRUD）操作
 * - 连接测试：通过启动进程验证 MCP 服务器是否可用
 * - 服务器类型自动推断（根据命令和参数判断运行时类型）
 *
 * @example
 * ```typescript
 * const mcpService = new MCPConfigService('~/.dsh/dsh-adw/mcp-servers.json');
 * const servers = mcpService.list();
 * const result = await mcpService.testConnection('my-server');
 * ```
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { getErrorMessage } from './error-utils.js';
/** 禁止出现在 MCP 命令/参数中的 shell 元字符，防止命令注入 */
const SHELL_METACHARACTERS = /[;|&$()<>\`\"']/;
/**
 * 校验 MCP 命令字符串是否安全。
 * 允许普通可执行文件路径和名称，禁止 shell 元字符。
 */
function validateMcpCommand(command) {
    if (!command || command.trim() === '') {
        throw new Error('MCP Server command is required');
    }
    if (SHELL_METACHARACTERS.test(command)) {
        throw new Error('MCP Server command contains invalid characters');
    }
}
/**
 * 校验 MCP 参数数组是否安全。
 * 要求必须是字符串数组，且每个参数不包含 shell 元字符。
 */
function validateMcpArgs(args) {
    if (args === undefined || args === null) {
        return [];
    }
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
        throw new Error('MCP Server args must be an array of strings');
    }
    for (const arg of args) {
        if (SHELL_METACHARACTERS.test(arg)) {
            throw new Error('MCP Server args contain invalid characters');
        }
    }
    return args;
}
/**
 * 校验 MCP 环境变量对象是否安全。
 * 要求键值均为字符串。
 */
function validateMcpEnv(env) {
    if (env === undefined || env === null) {
        return {};
    }
    if (typeof env !== 'object' || Array.isArray(env)) {
        throw new Error('MCP Server env must be an object');
    }
    for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') {
            throw new Error(`MCP Server env value for "${k}" must be a string`);
        }
    }
    return env;
}
/**
 * 校验远程 MCP 服务器地址：仅允许 http/https 绝对地址。
 */
function validateMcpUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error('MCP Server url must be an absolute http(s) URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('MCP Server url must be an absolute http(s) URL');
    }
}
/** 归一化并校验：url 型不校验 command；stdio 型 command 必填。 */
function toStored(name, config) {
    const env = validateMcpEnv(config.env);
    if (config.url !== undefined && config.url.trim() !== '') {
        validateMcpUrl(config.url.trim());
        const stored = { url: config.url.trim() };
        if (Object.keys(env).length > 0)
            stored.env = env;
        return stored;
    }
    if (config.command === undefined || config.command.trim() === '') {
        throw new Error(`MCP Server "${name}" needs either command (stdio) or url (http/sse)`);
    }
    validateMcpCommand(config.command);
    const args = validateMcpArgs(config.args);
    const stored = { command: config.command };
    if (args.length > 0)
        stored.args = args;
    if (Object.keys(env).length > 0)
        stored.env = env;
    return stored;
}
/** 存储形态 → 完整配置（含类型推断）。 */
function fromStored(name, stored) {
    if (stored.url !== undefined && stored.url.trim() !== '') {
        return { name, type: 'http', command: '', args: [], env: stored.env ?? {}, url: stored.url.trim(), enabled: true, status: 'disconnected' };
    }
    const command = stored.command ?? '';
    const args = stored.args ?? [];
    return { name, type: inferType(command, args), command, args, env: stored.env ?? {}, enabled: true, status: 'disconnected' };
}
/**
 * MCP 配置服务类
 *
 * 管理自管文件中的 MCP 服务器配置（单文件，含 mcpServers 字段）。
 * 提供服务器配置的完整生命周期管理：列出、查询、添加、更新、删除和连接测试。
 * 不读取、不写入任何其他工具（Claude CLI 等）的配置。
 *
 * @example
 * ```typescript
 * const mcpService = new MCPConfigService('~/.dsh/dsh-adw/mcp-servers.json');
 * ```
 */
export class MCPConfigService {
    /** 配置文件的绝对路径 */
    settingsFile;
    /** 配置目录的绝对路径 */
    configDir;
    /**
     * 构造 MCP 配置服务
     * @param settingsFile - 配置文件路径（如 ~/.dsh/dsh-adw/mcp-servers.json）
     */
    constructor(settingsFile) {
        this.settingsFile = settingsFile;
        this.configDir = path.dirname(this.settingsFile);
    }
    /**
     * 确保配置目录存在
     * 如果目录不存在，则递归创建所有必要的父目录。
     */
    ensureConfigDir() {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, { recursive: true });
        }
    }
    /**
     * 从磁盘加载配置文件
     *
     * 容错策略：
     * - 文件不存在时返回空对象
     * - JSON 解析失败或内容不是对象时返回空对象
     *
     * @returns McpServersFile 解析后的配置对象
     */
    loadSettings() {
        if (!fs.existsSync(this.settingsFile)) {
            return {};
        }
        try {
            const raw = fs.readFileSync(this.settingsFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (typeof parsed !== 'object' || parsed === null) {
                return {};
            }
            return parsed;
        }
        catch {
            // 解析失败时返回空对象，避免因配置文件损坏导致服务不可用
            return {};
        }
    }
    /**
     * 保存配置文件到磁盘
     * 保存前确保目录存在。写入格式化的 JSON。
     *
     * @param settings - 要保存的完整配置对象
     */
    saveSettings(settings) {
        this.ensureConfigDir();
        const tmp = this.settingsFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
        fs.renameSync(tmp, this.settingsFile);
    }
    /**
     * 列出所有已配置的 MCP 服务器
     *
     * @returns MCPServerConfig[] 服务器配置数组
     */
    list() {
        const servers = this.loadSettings().mcpServers ?? {};
        return Object.entries(servers).map(([name, stored]) => fromStored(name, stored));
    }
    /**
     * 根据名称获取单个 MCP 服务器配置
     *
     * @param name - 服务器名称
     * @returns MCPServerConfig | undefined 找到则返回配置，未找到返回 undefined
     */
    get(name) {
        const stored = (this.loadSettings().mcpServers ?? {})[name];
        if (!stored) {
            return undefined;
        }
        return fromStored(name, stored);
    }
    /**
     * 添加新的 MCP 服务器配置
     *
     * 验证名称和命令不为空，检查是否已存在同名服务器，通过验证后写入配置文件。
     *
     * @param config - 要添加的服务器配置（必须包含 name 和 command）
     * @returns MCPServerConfig 添加后的服务器配置（含自动推断的类型）
     * @throws {Error} 名称或命令为空、或同名服务器已存在时抛出
     */
    add(config) {
        // 验证必填字段
        if (!config.name || config.name.trim() === '') {
            throw new Error('MCP Server name is required');
        }
        const stored = toStored(config.name, config);
        const settings = this.loadSettings();
        if (!settings.mcpServers) {
            settings.mcpServers = {};
        }
        // 检查同名服务器是否已存在，防止意外覆盖
        if (settings.mcpServers[config.name]) {
            throw new Error(`MCP Server "${config.name}" already exists`);
        }
        settings.mcpServers[config.name] = stored;
        this.saveSettings(settings);
        return fromStored(config.name, stored);
    }
    /**
     * 更新已有的 MCP 服务器配置
     *
     * 支持部分更新（Partial），未指定的字段保持原值。
     * 更新后的配置会写入磁盘。
     *
     * @param name - 要更新的服务器名称
     * @param config - 要更新的配置字段（部分更新）
     * @returns MCPServerConfig 更新后的完整服务器配置
     * @throws {Error} 指定名称的服务器不存在时抛出
     */
    update(name, config) {
        const settings = this.loadSettings();
        if (!settings.mcpServers) {
            settings.mcpServers = {};
        }
        if (!settings.mcpServers[name]) {
            throw new Error(`MCP Server "${name}" not found`);
        }
        const existing = settings.mcpServers[name];
        // 合并更新：未指定的字段使用已有值（url 与 command 二选一，切换时以新值为准）
        const merged = { command: existing.command, args: existing.args, env: existing.env, url: existing.url, ...config };
        const stored = toStored(name, merged);
        settings.mcpServers[name] = stored;
        this.saveSettings(settings);
        return fromStored(name, stored);
    }
    /**
     * 删除 MCP 服务器配置
     *
     * @param name - 要删除的服务器名称
     * @returns boolean 删除成功返回 true，服务器不存在返回 false
     */
    delete(name) {
        const settings = this.loadSettings();
        if (!settings.mcpServers || !settings.mcpServers[name]) {
            return false;
        }
        delete settings.mcpServers[name];
        this.saveSettings(settings);
        return true;
    }
    /**
     * 测试 MCP 服务器连接
     *
     * 通过实际启动 MCP 服务器的命令来验证其是否可用。测试逻辑如下：
     * - 在指定超时时间内进程仍在运行 → 判定为连接成功
     * - 进程正常退出（退出码 0）→ 判定为连接成功
     * - 进程异常退出（非零退出码）→ 判定为连接失败
     * - 进程启动失败（spawn 错误）→ 判定为连接失败
     *
     * 注意：测试完成后会自动终止启动的进程，不会留下残留进程。
     *
     * @param name - 要测试的服务器名称
     * @param timeoutMs - 超时时间（毫秒），默认 5000ms
     * @returns Promise<{ status: 'connected' | 'error'; message: string }> 测试结果
     */
    testConnection(name, timeoutMs = 5000) {
        const config = this.get(name);
        if (!config) {
            return Promise.resolve({ status: 'error', message: `MCP Server "${name}" not found` });
        }
        // url 型（http/sse）：HTTP 可达性探测（任何非网络错误的响应都算可达，
        // 端点对 GET 返回 4xx/405 是正常的——真正的协议握手发生在桥接层连接时）
        if (config.url !== undefined) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            return fetch(config.url, { method: 'GET', signal: controller.signal, headers: config.env })
                .then(() => {
                clearTimeout(timer);
                return { status: 'connected', message: 'URL reachable' };
            })
                .catch((err) => {
                clearTimeout(timer);
                return { status: 'error', message: `URL unreachable: ${getErrorMessage(err)}` };
            });
        }
        return new Promise((resolve) => {
            try {
                // 再次校验，确保从文件读取的配置也符合安全要求
                validateMcpCommand(config.command);
                const safeArgs = validateMcpArgs(config.args);
                const safeEnv = validateMcpEnv(config.env);
                // 启动 MCP 服务器进程，合并当前环境变量和服务器自定义环境变量
                const child = spawn(config.command, safeArgs, {
                    env: { ...process.env, ...safeEnv },
                    stdio: ['pipe', 'pipe', 'pipe'],
                    // Windows 平台需要通过 shell 启动以正确解析命令路径（.cmd/.bat）。
                    // 命令和参数已在上层校验不含 shell 元字符，降低注入风险。
                    shell: process.platform === 'win32',
                });
                // 防止多次 resolve 的标志位
                let resolved = false;
                // 超时计时器：如果在超时时间内进程仍在运行，认为启动成功
                const timer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        // 进程在超时后仍存活，视为连接成功，然后终止测试进程
                        child.kill();
                        resolve({ status: 'connected', message: 'MCP Server started successfully' });
                    }
                }, timeoutMs);
                // 进程启动错误处理（命令不存在、权限不足等）
                child.on('error', (err) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        resolve({ status: 'error', message: `Failed to start: ${err.message}` });
                    }
                });
                // 进程退出处理
                child.on('exit', (code) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        if (code === 0) {
                            // 正常退出（某些 MCP 服务器可能快速完成初始化后退出）
                            resolve({ status: 'connected', message: 'MCP Server exited cleanly' });
                        }
                        else {
                            // 异常退出
                            resolve({ status: 'error', message: `Process exited with code ${code}` });
                        }
                    }
                });
            }
            catch (err) {
                // spawn 调用本身抛出异常（如参数无效）
                resolve({ status: 'error', message: `Failed to spawn process: ${getErrorMessage(err)}` });
            }
        });
    }
    /**
     * 获取配置文件路径
     * @returns string 配置文件的绝对路径
     */
    getSettingsFile() {
        return this.settingsFile;
    }
}
/**
 * 根据命令和参数推断 MCP 服务器的运行时类型（stdio 型）。
 * npx/node/.js → node；python/.py → python；docker → docker；其他 → custom。
 */
function inferType(command, args) {
    const allParts = [command, ...(args ?? [])].join(' ').toLowerCase();
    if (allParts.includes('npx') || allParts.includes('node') || allParts.includes('.js')) {
        return 'node';
    }
    if (allParts.includes('python') || allParts.includes('.py')) {
        return 'python';
    }
    if (allParts.includes('docker')) {
        return 'docker';
    }
    return 'custom';
}
//# sourceMappingURL=mcp-config.js.map