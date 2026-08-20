/**
 * @file MCP 桥接服务（纯传输层）
 * @description 提供与 MCP (Model Context Protocol) 服务器之间的通信桥接能力。
 *
 * 职责分工（热插拔架构）：
 * - 本服务：连接生命周期、listTools 动态发现、按能力调用工具 —— 协议通用
 * - requirement-sources/：输入方言、工具命名约定、响应解析、附件认证 —— 源特定
 *
 * 适配器路由：按 serverName 解析适配器（显式绑定 > matchServer 自动认领 > generic 兜底），
 * 新增需求源只需实现适配器并注册，无需修改本文件。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { getErrorMessage } from './error-utils.js';
import { resolveAdapter, getAdapter, listCatalogAdapters } from './requirement-sources/index.js';
/** Windows 下需要经由 cmd /c 拉起的脚本型命令（spawn 无 shell 时解析不了 .cmd） */
const WINDOWS_SCRIPT_COMMANDS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bun', 'bunx', 'deno', 'uvx', 'uv', 'node', 'python', 'python3', 'pip']);
/**
 * 为 stdio 型配置构建传输层（Windows 归一化：脚本命令包 cmd /c）。
 */
function buildStdioTransport(config) {
    const isWindows = process.platform === 'win32';
    const bare = config.command.toLowerCase();
    const needsShellWrapper = isWindows && (WINDOWS_SCRIPT_COMMANDS.has(bare) || bare.endsWith('.cmd') === false && config.command.includes('/'));
    const command = needsShellWrapper ? 'cmd' : config.command;
    const args = needsShellWrapper ? ['/c', config.command, ...config.args] : config.args;
    return new StdioClientTransport({
        command,
        args,
        env: { ...process.env, ...config.env },
    });
}
/**
 * 为 url 型配置构建传输层：优先 Streamable HTTP，失败回退 SSE（旧服务器）。
 */
async function buildHttpTransport(config) {
    const url = new URL(config.url);
    const headers = { ...config.env };
    try {
        const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
        await transport.start();
        return transport;
    }
    catch {
        return await Promise.resolve(new SSEClientTransport(url, { requestInit: { headers } }));
    }
}
/** 兼容历史默认服务器名（未配置时用于报错提示） */
const DEFAULT_SERVER_NAME = 'ones-api';
/**
 * MCP 桥接服务类
 * @description 封装与 MCP 服务器的通信逻辑：
 *   - 按服务器维持连接池（切换源不销毁其它源的连接）
 *   - 连接后 listTools 动态发现工具，按适配器的命名约定解析能力 → 工具名
 *   - 输入规整、参数构建、响应解析全部委托给命中的需求源适配器
 */
export class MCPBridgeService {
    /** MCP 配置源（注册中心或兼容 get/list 的服务） */
    mcpConfigSource;
    /** 默认使用的 MCP 服务器名称 */
    serverName;
    /** 连接池：serverName → 上下文 */
    pool = new Map();
    /** 连接中标志（按 serverName 隔离，防止并发连接竞争） */
    connecting = new Set();
    /**
     * 构造函数
     * @param mcpConfigSource - MCP 配置源（MCPRegistryService / MCPConfigService）
     * @param serverName - 可选的默认 MCP 服务器名称（缺省 'ones-api'，未配置时自动解析）
     */
    constructor(mcpConfigSource, serverName) {
        this.mcpConfigSource = mcpConfigSource;
        this.serverName = serverName ?? DEFAULT_SERVER_NAME;
    }
    // === 服务器解析 ===
    /**
     * 解析实际使用的服务器名
     * @description 显式指定时原样使用（未配置由连接层抛出明确错误，绝不静默
     *   切换到其它服务器）；未指定时用默认名，默认名未配置且配置源支持枚举时，
     *   自动选择第一个被专用适配器认领的服务器（否则第一个已配置的）。
     * @returns 实际使用的服务器名
     */
    resolveServerName(explicit) {
        if (explicit)
            return explicit;
        if (this.mcpConfigSource.get(this.serverName))
            return this.serverName;
        // 默认名未配置：枚举配置源自动选择
        const all = this.mcpConfigSource.list?.() ?? [];
        if (all.length > 0) {
            // 优先被专用适配器认领的服务器
            const claimed = all.find(s => resolveAdapter(s.name, s).id !== 'generic');
            return (claimed ?? all[0]).name;
        }
        return this.serverName;
    }
    /**
     * 获取当前生效的服务器名（含自动解析，不建立连接）
     * @param opts - 可选的目标服务器
     */
    getResolvedServerName(opts) {
        return this.resolveServerName(opts?.serverName);
    }
    /**
     * 获取默认配置的 MCP 服务器名称
     */
    getServerName() {
        return this.serverName;
    }
    /**
     * 设置默认使用的 MCP 服务器名称
     * @description 连接池按名缓存，切换默认服务器不影响已有连接的复用
     * @param name - 新的服务器名称
     */
    setServerName(name) {
        this.serverName = name;
    }
    /**
     * 获取指定服务器的配置信息
     * @param opts - 可选的目标服务器（缺省用解析后的默认名）
     */
    getServerConfig(opts) {
        return this.mcpConfigSource.get(this.resolveServerName(opts?.serverName));
    }
    // === 连接管理 ===
    /**
     * 确保指定服务器的 MCP 连接可用
     * @description 懒连接 + 按服务器缓存。连接后 listTools 动态发现工具，
     *   按适配器的命名约定解析能力 → 工具名（失败不阻塞连接）。
     */
    async ensureConnected(serverName) {
        const existing = this.pool.get(serverName);
        if (existing)
            return existing;
        // 有同名的连接正在进行，等待后复查
        if (this.connecting.has(serverName)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const raced = this.pool.get(serverName);
            if (raced)
                return raced;
            throw new Error('Connection already in progress');
        }
        this.connecting.add(serverName);
        try {
            const config = this.mcpConfigSource.get(serverName);
            if (!config) {
                throw new Error(`MCP Server "${serverName}" is not configured. Please add it in MCP Management.`);
            }
            // 传输层：url 型走 Streamable HTTP（SSE 兜底）；stdio 型走进程拉起
            const transport = config.url !== undefined
                ? await buildHttpTransport(config)
                : buildStdioTransport(config);
            const client = new Client({ name: 'ai-dev-workbench', version: '0.1.0' }, { capabilities: {} });
            await client.connect(transport);
            // 适配器路由：显式绑定 > 自动认领 > generic
            const adapter = resolveAdapter(serverName, config);
            // 动态发现工具（MCP 核心设计）：按适配器命名约定解析能力，失败不阻塞
            let availableTools = null;
            const toolByCapability = {};
            try {
                const tools = await client.listTools();
                availableTools = new Set(tools.tools.map(t => t.name));
                for (const capability of Object.keys(adapter.capabilityPatterns)) {
                    const resolved = this.resolveTool(adapter, capability, tools.tools);
                    if (resolved)
                        toolByCapability[capability] = resolved;
                }
            }
            catch {
                availableTools = null;
            }
            const ctx = { client, serverName, adapter, availableTools, toolByCapability };
            this.pool.set(serverName, ctx);
            return ctx;
        }
        finally {
            this.connecting.delete(serverName);
        }
    }
    /**
     * 断开全部 MCP 连接并释放资源
     */
    async disconnect() {
        const contexts = [...this.pool.values()];
        this.pool.clear();
        for (const ctx of contexts) {
            try {
                await ctx.client.close();
            }
            catch { /* 关闭失败忽略 */ }
        }
    }
    // === 业务接口 ===
    /**
     * 按用户输入获取需求详情（推荐入口）
     * @description 完整链路：适配器规整输入 → 纯编号先搜索解析真实 ID →
     *   拉取详情 → 回填编号。兼容各源输入方言。
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner/repo#N）
     * @param opts - 可选的目标服务器
     * @returns 需求详情与实际使用的服务器名
     */
    async fetchRequirementByInput(input, opts) {
        const serverName = this.resolveServerName(opts?.serverName);
        const config = this.mcpConfigSource.get(serverName);
        const adapter = resolveAdapter(serverName, config);
        const normalized = adapter.normalizeInput(input);
        const plainNumber = adapter.extractPlainNumber(normalized);
        let resolvedId = normalized;
        if (plainNumber) {
            // 纯编号：先搜索解析真实 ID（编号可能跨项目重复）
            const results = await this.searchRequirements(plainNumber, { serverName });
            if (results.length > 0) {
                resolvedId = results[0].id;
            }
            // 搜索无结果时不中断，继续用编号直接调用详情工具
        }
        const detail = await this.fetchRequirementDetail(resolvedId, { serverName });
        // 输入为编号且源未返回编号时回填（不依赖源返回格式）
        if (plainNumber && !detail.number) {
            detail.number = `#${plainNumber}`;
        }
        return { detail, serverName };
    }
    /**
     * 获取指定需求的详细信息
     * @param id - 需求标识（适配器方言内的可定位 id：uuid / owner-repo#N 等）
     * @param opts - 可选的目标服务器
     * @throws 获取失败时抛出包含需求 ID 和原始错误信息的错误
     */
    async fetchRequirementDetail(id, opts) {
        const serverName = this.resolveServerName(opts?.serverName);
        try {
            const ctx = await this.ensureConnected(serverName);
            // 适配器规整 + 构建参数（兼容传入原始输入形态）
            const normalized = ctx.adapter.normalizeInput(id);
            const args = ctx.adapter.buildDetailArgs(normalized, this.mcpConfigSource.get(serverName));
            const result = await this.callToolByCapability(ctx, 'fetchDetail', args);
            return ctx.adapter.parseDetail(result.content);
        }
        catch (err) {
            throw new Error(`Failed to fetch requirement detail for "${id}": ${getErrorMessage(err)}`);
        }
    }
    /**
     * 按关键字搜索需求列表
     * @param query - 搜索关键字
     * @param opts - 可选的目标服务器
     * @throws 搜索失败时抛出包含原始错误信息的错误
     */
    async searchRequirements(query, opts) {
        const serverName = this.resolveServerName(opts?.serverName);
        try {
            const ctx = await this.ensureConnected(serverName);
            const args = ctx.adapter.buildSearchArgs(query, this.mcpConfigSource.get(serverName));
            const result = await this.callToolByCapability(ctx, 'search', args);
            return ctx.adapter.parseList(result.content);
        }
        catch (err) {
            throw new Error(`Failed to search requirements: ${getErrorMessage(err)}`);
        }
    }
    // === 源目录与安装 ===
    /**
     * 列出需求源目录（适配器视角，非 MCP server 视角）
     * @description 平台能力目录：每个已注册适配器一个条目，携带其已配置的
     *   MCP server 列表与一键安装模板。前端据此渲染"选择源系统 → 未配置则
     *   引导安装"，工具型 MCP（memory 等）不会出现。generic 兜底不外显。
     */
    listSources() {
        const all = this.mcpConfigSource.list?.() ?? [];
        return listCatalogAdapters().map(adapter => ({
            adapterId: adapter.id,
            label: adapter.label,
            description: adapter.description,
            servers: all
                .filter(server => resolveAdapter(server.name, server).id === adapter.id)
                .map(server => server.name),
            installTemplate: adapter.installTemplate,
        }));
    }
    /**
     * 按适配器模板一键安装需求源
     * @description 从适配器的 installTemplate 创建 MCP server（Windows 下自动
     *   经 cmd /c 包装），写入配置源后做一次连接测试。
     * @param adapterId - 目标适配器 id
     * @param env - 用户填写的凭据（key 来自模板 envSpecs）
     * @returns 创建的 server 名与连接测试结果
     * @throws 适配器不存在 / 不支持安装 / 必填凭据缺失 / 同名 server 已存在
     */
    async installSource(adapterId, env) {
        const adapter = getAdapter(adapterId);
        if (!adapter || adapter.id === 'generic') {
            throw new Error(`Unknown requirement source: ${adapterId}`);
        }
        const template = adapter.installTemplate;
        if (!template) {
            throw new Error(`Requirement source "${adapter.label}" does not support one-click install`);
        }
        if (!this.mcpConfigSource.add) {
            throw new Error('MCP config source does not support adding servers');
        }
        // 校验必填凭据
        const missing = template.envSpecs
            .filter(spec => spec.required && !(env[spec.key] ?? '').trim())
            .map(spec => spec.label);
        if (missing.length > 0) {
            throw new Error(`Missing required credentials: ${missing.join(', ')}`);
        }
        // 同名冲突：模板 server 名已被占用（可能已配置过该源）
        if (this.mcpConfigSource.get(template.serverName)) {
            throw new Error(`MCP server "${template.serverName}" already exists — source may already be configured`);
        }
        // Windows 下 npx 需经 cmd /c 启动（与现有注册条目一致）
        const isWindows = process.platform === 'win32';
        const command = isWindows ? 'cmd' : template.command;
        const args = isWindows ? ['/c', template.command, ...template.args] : template.args;
        // 只写入用户实际填写的凭据（空值不落盘）
        const cleanEnv = {};
        for (const spec of template.envSpecs) {
            const value = (env[spec.key] ?? '').trim();
            if (value)
                cleanEnv[spec.key] = value;
        }
        this.mcpConfigSource.add({
            name: template.serverName,
            type: 'custom',
            command,
            args,
            env: cleanEnv,
            enabled: true,
        });
        // 安装后连接测试（失败不回滚：配置已落盘，用户可修凭据后重试）
        let connectionTest;
        if (this.mcpConfigSource.testConnection) {
            try {
                const result = await this.mcpConfigSource.testConnection(template.serverName, 10000);
                // 兼容 {ok} 与 {status:'connected'|'error'} 两种返回形态
                const ok = result.ok ?? result.status === 'connected';
                connectionTest = { ok, message: result.message };
            }
            catch (err) {
                connectionTest = { ok: false, message: getErrorMessage(err) };
            }
        }
        return { serverName: template.serverName, connectionTest };
    }
    /**
     * 获取指定服务器的附件图片下载服务
     * @description 由适配器从 MCP server 配置构建（认证策略源特定）；不支持时返回 undefined
     */
    getAttachmentImageService(opts) {
        const serverName = this.resolveServerName(opts?.serverName);
        const config = this.mcpConfigSource.get(serverName);
        if (!config)
            return undefined;
        return resolveAdapter(serverName, config).createImageService(config);
    }
    // === 私有方法 ===
    /**
     * 判断错误是否为 JSON-RPC "工具不存在"（-32602 Invalid params: Tool xxx not found）
     */
    isToolNotFoundError(err) {
        if (err instanceof McpError) {
            return err.code === ErrorCode.InvalidParams && /not found/i.test(err.message);
        }
        const msg = getErrorMessage(err);
        return msg.includes('-32602') && /not found/i.test(msg);
    }
    /**
     * 从服务端工具清单中按适配器命名约定解析出应调用的工具名
     */
    resolveTool(adapter, capability, tools) {
        const patterns = adapter.capabilityPatterns[capability] ?? [];
        for (const pattern of patterns) {
            const hit = tools.find(t => pattern.test(t.name));
            if (hit)
                return hit.name;
        }
        return undefined;
    }
    /**
     * 按能力调用工具（能力 → 工具动态映射）
     * @description 优先使用 listTools 按适配器命名约定解析出的工具名；
     *   解析失败时回退逐个尝试适配器的候选名并跳过 "工具不存在" 错误；
     *   全部失败时抛出包含服务端实际工具清单的可操作错误。
     */
    async callToolByCapability(ctx, capability, args) {
        // 1. 已通过 listTools 按命名约定解析到工具名
        const resolved = ctx.toolByCapability[capability];
        if (resolved) {
            return (await ctx.client.callTool({ name: resolved, arguments: args }));
        }
        // 2. 解析失败（工具清单不可用 / 命名约定未命中）：回退尝试适配器候选名
        const candidates = ctx.adapter.fallbackToolNames[capability] ?? [];
        let lastErr;
        for (const name of candidates) {
            try {
                return (await ctx.client.callTool({ name, arguments: args }));
            }
            catch (err) {
                if (this.isToolNotFoundError(err)) {
                    lastErr = err;
                    continue;
                }
                throw err;
            }
        }
        // 3. 全部失败：抛出可操作错误，列出服务端实际提供的工具与适配器信息
        const available = ctx.availableTools && ctx.availableTools.size > 0
            ? ` Available tools: [${[...ctx.availableTools].join(', ')}]`
            : '';
        throw lastErr ?? new Error(`No tool found on MCP server "${ctx.serverName}" for capability "${capability}" ` +
            `(adapter: ${ctx.adapter.id}).${available}`);
    }
}
//# sourceMappingURL=mcp-bridge.js.map