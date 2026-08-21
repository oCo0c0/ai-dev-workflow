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

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {McpError, ErrorCode} from '@modelcontextprotocol/sdk/types.js';
import type {MCPServerConfig} from './mcp-config-service.js';
import {getErrorMessage} from '../utils/error-utils.js';
import {resolveAdapter, getAdapter, listCatalogAdapters} from './requirement-sources/index.js';
import type {
    AttachmentImageService,
    Requirement,
    RequirementDetail,
    RequirementSourceAdapter,
    SourceInstallTemplate,
    ToolCapability,
} from './requirement-sources/index.js';

// 数据模型从 requirement-sources 重导出（保持既有导入路径兼容）
export type {Requirement, RequirementDetail} from './requirement-sources/index.js';

/** 兼容历史默认服务器名（未配置时用于报错提示） */
const DEFAULT_SERVER_NAME = 'ones-api';

/**
 * 从 MCP 工具响应 content 中提取纯文本（isError 错误透出用）
 */
function extractToolErrorText(content: unknown): string {
    if (!Array.isArray(content)) return '';
    return content
        .map((item): string => {
            if (item && typeof item === 'object'
                && typeof (item as {text?: unknown}).text === 'string') {
                return (item as {text: string}).text;
            }
            return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}

/**
 * MCP 配置源契约
 * @description get/list 支撑源目录与路由解析；add/testConnection（可选）
 *   支撑一键安装（MCPRegistryService 全量实现）。
 *   testConnection 兼容两种返回形态：{ok} 或 {status:'connected'|'error'}。
 */
export interface MCPConfigSource {
    get(name: string): MCPServerConfig | undefined;
    list?(): MCPServerConfig[];
    /** 新增 server（一键安装用） */
    add?(config: MCPServerConfig): unknown;
    /** 连接测试（一键安装后验证凭据） */
    testConnection?(name: string, timeoutMs?: number): Promise<{ok?: boolean; status?: string; message: string}>;
}

/** 已连接服务器的上下文（连接 + 动态解析结果 + 命中的适配器） */
interface ServerContext {
    client: Client;
    serverName: string;
    adapter: RequirementSourceAdapter;
    availableTools: Set<string> | null;
    toolByCapability: Partial<Record<ToolCapability, string>>;
}

/** 方法级选项：临时指定目标服务器（不修改服务默认值） */
export interface BridgeCallOptions {
    serverName?: string;
}

/** 需求源目录条目（GET /api/requirements/sources）：适配器视角 */
export interface RequirementSourceEntry {
    /** 适配器 id（ones / github / ...） */
    adapterId: string;
    /** 源显示名 */
    label: string;
    /** 目录描述 */
    description: string;
    /** 已配置的 MCP server 名（可为空 = 未配置，前端引导安装） */
    servers: string[];
    /** 一键安装模板（含凭据清单）；无则该源需手动配置 */
    installTemplate?: SourceInstallTemplate;
}

/**
 * MCP 桥接服务类
 * @description 封装与 MCP 服务器的通信逻辑：
 *   - 按服务器维持连接池（切换源不销毁其它源的连接）
 *   - 连接后 listTools 动态发现工具，按适配器的命名约定解析能力 → 工具名
 *   - 输入规整、参数构建、响应解析全部委托给命中的需求源适配器
 */
export class MCPBridgeService {
    /** MCP 配置源（注册中心或兼容 get/list 的服务） */
    private mcpConfigSource: MCPConfigSource;
    /** 默认使用的 MCP 服务器名称 */
    private serverName: string;
    /** 连接池：serverName → 上下文 */
    private pool = new Map<string, ServerContext>();
    /** 连接中标志（按 serverName 隔离，防止并发连接竞争） */
    private connecting = new Set<string>();

    /**
     * 构造函数
     * @param mcpConfigSource - MCP 配置源（MCPRegistryService / MCPConfigService）
     * @param serverName - 可选的默认 MCP 服务器名称（缺省 'ones-api'，未配置时自动解析）
     */
    constructor(mcpConfigSource: MCPConfigSource, serverName?: string) {
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
    private resolveServerName(explicit?: string): string {
        if (explicit) return explicit;
        if (this.mcpConfigSource.get(this.serverName)) return this.serverName;
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
    getResolvedServerName(opts?: BridgeCallOptions): string {
        return this.resolveServerName(opts?.serverName);
    }

    /**
     * 获取默认配置的 MCP 服务器名称
     */
    getServerName(): string {
        return this.serverName;
    }

    /**
     * 设置默认使用的 MCP 服务器名称
     * @description 连接池按名缓存，切换默认服务器不影响已有连接的复用
     * @param name - 新的服务器名称
     */
    setServerName(name: string): void {
        this.serverName = name;
    }

    /**
     * 获取指定服务器的配置信息
     * @param opts - 可选的目标服务器（缺省用解析后的默认名）
     */
    getServerConfig(opts?: BridgeCallOptions): MCPServerConfig | undefined {
        return this.mcpConfigSource.get(this.resolveServerName(opts?.serverName));
    }

    // === 连接管理 ===

    /**
     * 确保指定服务器的 MCP 连接可用
     * @description 懒连接 + 按服务器缓存。连接后 listTools 动态发现工具，
     *   按适配器的命名约定解析能力 → 工具名（失败不阻塞连接）。
     */
    private async ensureConnected(serverName: string): Promise<ServerContext> {
        const existing = this.pool.get(serverName);
        if (existing) return existing;

        // 有同名的连接正在进行，等待后复查
        if (this.connecting.has(serverName)) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const raced = this.pool.get(serverName);
            if (raced) return raced;
            throw new Error('Connection already in progress');
        }

        this.connecting.add(serverName);
        try {
            const config = this.mcpConfigSource.get(serverName);
            if (!config) {
                throw new Error(
                    `MCP Server "${serverName}" is not configured. Please add it in MCP Management.`
                );
            }

            // 基于标准输入输出的传输层，合并当前进程环境变量与服务器自定义环境变量
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: {...process.env, ...config.env} as Record<string, string>,
            });

            const client = new Client(
                {name: 'ai-dev-workbench', version: '0.1.0'},
                {capabilities: {}}
            );

            await client.connect(transport);

            // 连接意外断开（子进程死亡/网络中断）时驱逐池条目，下次调用自动重连。
            // 守卫条件确保不误删重建后的新连接；disconnect() 主动清理时池已清空，同样安全。
            client.onclose = () => {
                if (this.pool.get(serverName)?.client === client) {
                    this.pool.delete(serverName);
                }
            };

            // 适配器路由：显式绑定 > 自动认领 > generic
            const adapter = resolveAdapter(serverName, config);

            // 动态发现工具（MCP 核心设计）：按适配器命名约定解析能力，失败不阻塞
            let availableTools: Set<string> | null = null;
            const toolByCapability: Partial<Record<ToolCapability, string>> = {};
            try {
                const tools = await client.listTools();
                availableTools = new Set(tools.tools.map(t => t.name));
                for (const capability of Object.keys(adapter.capabilityPatterns) as ToolCapability[]) {
                    const resolved = this.resolveTool(adapter, capability, tools.tools);
                    if (resolved) toolByCapability[capability] = resolved;
                }
            } catch {
                availableTools = null;
            }

            const ctx: ServerContext = {client, serverName, adapter, availableTools, toolByCapability};
            this.pool.set(serverName, ctx);
            return ctx;
        } finally {
            this.connecting.delete(serverName);
        }
    }

    /**
     * 断开全部 MCP 连接并释放资源
     */
    async disconnect(): Promise<void> {
        const contexts = [...this.pool.values()];
        this.pool.clear();
        for (const ctx of contexts) {
            try {
                await ctx.client.close();
            } catch { /* 关闭失败忽略 */ }
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
    async fetchRequirementByInput(
        input: string,
        opts?: BridgeCallOptions,
    ): Promise<{detail: RequirementDetail; serverName: string}> {
        const serverName = this.resolveServerName(opts?.serverName);
        const config = this.mcpConfigSource.get(serverName);
        const adapter = resolveAdapter(serverName, config);

        const normalized = adapter.normalizeInput(input);
        const plainNumber = adapter.extractPlainNumber(normalized);

        let resolvedId = normalized;
        if (plainNumber) {
            // 纯编号：先搜索解析真实 ID（编号可能跨项目重复）。
            // 搜索失败不中断（连接失败/工具报错时回退用编号直拉详情工具）。
            try {
                const results = await this.searchRequirements(plainNumber, {serverName});
                if (results.length > 0) {
                    resolvedId = results[0].id;
                }
            } catch { /* 搜索失败：继续用编号直接调用详情工具 */ }
        }

        const detail = await this.fetchRequirementDetail(resolvedId, {serverName});

        // 输入为编号且源未返回编号时回填（不依赖源返回格式）
        if (plainNumber && !detail.number) {
            detail.number = `#${plainNumber}`;
        }
        return {detail, serverName};
    }

    /**
     * 获取指定需求的详细信息
     * @param id - 需求标识（适配器方言内的可定位 id：uuid / owner-repo#N 等）
     * @param opts - 可选的目标服务器
     * @throws 获取失败时抛出包含需求 ID 和原始错误信息的错误
     */
    async fetchRequirementDetail(id: string, opts?: BridgeCallOptions): Promise<RequirementDetail> {
        const serverName = this.resolveServerName(opts?.serverName);
        try {
            const {ctx, content} = await this.callToolWithReconnect(serverName, 'fetchDetail', adapter => {
                // 适配器规整 + 构建参数（兼容传入原始输入形态）
                const normalized = adapter.normalizeInput(id);
                return adapter.buildDetailArgs(normalized, this.mcpConfigSource.get(serverName)!);
            });
            return ctx.adapter.parseDetail(content);
        } catch (err) {
            throw new Error(
                `Failed to fetch requirement detail for "${id}": ${getErrorMessage(err)}`
            );
        }
    }

    /**
     * 按关键字搜索需求列表
     * @param query - 搜索关键字
     * @param opts - 可选的目标服务器
     * @throws 搜索失败时抛出包含原始错误信息的错误
     */
    async searchRequirements(query: string, opts?: BridgeCallOptions): Promise<Requirement[]> {
        const serverName = this.resolveServerName(opts?.serverName);
        try {
            const {ctx, content} = await this.callToolWithReconnect(serverName, 'search', adapter =>
                adapter.buildSearchArgs(query, this.mcpConfigSource.get(serverName)!)
            );
            return ctx.adapter.parseList(content);
        } catch (err) {
            throw new Error(
                `Failed to search requirements: ${getErrorMessage(err)}`
            );
        }
    }

    // === 源目录与安装 ===

    /**
     * 列出需求源目录（适配器视角，非 MCP server 视角）
     * @description 平台能力目录：每个已注册适配器一个条目，携带其已配置的
     *   MCP server 列表与一键安装模板。前端据此渲染"选择源系统 → 未配置则
     *   引导安装"，工具型 MCP（memory 等）不会出现。generic 兜底不外显。
     */
    listSources(): RequirementSourceEntry[] {
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
    async installSource(
        adapterId: string,
        env: Record<string, string>,
    ): Promise<{serverName: string; connectionTest?: {ok: boolean; message: string}}> {
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
        const cleanEnv: Record<string, string> = {};
        for (const spec of template.envSpecs) {
            const value = (env[spec.key] ?? '').trim();
            if (value) cleanEnv[spec.key] = value;
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
        let connectionTest: {ok: boolean; message: string} | undefined;
        if (this.mcpConfigSource.testConnection) {
            try {
                const result = await this.mcpConfigSource.testConnection(template.serverName, 10000);
                // 兼容 {ok} 与 {status:'connected'|'error'} 两种返回形态
                const ok = result.ok ?? result.status === 'connected';
                connectionTest = {ok, message: result.message};
            } catch (err) {
                connectionTest = {ok: false, message: getErrorMessage(err)};
            }
        }

        return {serverName: template.serverName, connectionTest};
    }

    /**
     * 获取指定服务器的附件图片下载服务
     * @description 由适配器从 MCP server 配置构建（认证策略源特定）；不支持时返回 undefined
     */
    getAttachmentImageService(opts?: BridgeCallOptions): AttachmentImageService | undefined {
        const serverName = this.resolveServerName(opts?.serverName);
        const config = this.mcpConfigSource.get(serverName);
        if (!config) return undefined;
        return resolveAdapter(serverName, config).createImageService(config);
    }

    // === 私有方法 ===

    /**
     * 判断错误是否为 JSON-RPC "工具不存在"（-32602 Invalid params: Tool xxx not found）
     */
    private isToolNotFoundError(err: unknown): boolean {
        if (err instanceof McpError) {
            return err.code === ErrorCode.InvalidParams && /not found/i.test(err.message);
        }
        const msg = getErrorMessage(err);
        return msg.includes('-32602') && /not found/i.test(msg);
    }

    /**
     * 判断错误是否为连接断开类（连接池中的子进程/网络死亡后 SDK 抛出）
     */
    private isConnectionError(err: unknown): boolean {
        return /not connected|connection closed|transport (is )?closed|transport error|disconnected|socket hang up|aborted/i
            .test(getErrorMessage(err));
    }

    /**
     * 执行一次工具调用，遇到连接断开类错误时驱逐死连接并重建重试一次
     * @description 池中连接底层进程可能已死亡（npx 缓存更新/进程崩溃/宿主回收），
     *   此时 SDK 调用抛 "Not connected"；驱逐池条目后 ensureConnected 会重新拉起。
     * @returns 命中的服务器上下文与工具响应 content
     */
    private async callToolWithReconnect(
        serverName: string,
        capability: ToolCapability,
        buildArgs: (adapter: RequirementSourceAdapter) => Record<string, unknown>,
    ): Promise<{ctx: ServerContext; content: unknown}> {
        const invoke = async (): Promise<{ctx: ServerContext; content: unknown}> => {
            const ctx = await this.ensureConnected(serverName);
            const result = await this.callToolByCapability(ctx, capability, buildArgs(ctx.adapter));
            return {ctx, content: result.content};
        };
        try {
            return await invoke();
        } catch (err) {
            if (!this.isConnectionError(err)) throw err;
            this.pool.delete(serverName);
            return invoke();
        }
    }

    /**
     * 调用单个工具并检查 MCP 协议级错误（isError）
     * @description MCP 工具执行失败时返回 {content:[{text:"Error: ..."}], isError:true}
     *   而非 JSON-RPC 错误；忽略该标志会把错误文本当正文解析（产生空需求壳），
     *   故在此显式转换为异常，让错误信息透出到调用方。
     */
    private async invokeTool(
        ctx: ServerContext,
        name: string,
        args: Record<string, unknown>,
    ): Promise<{content: unknown}> {
        const result = (await ctx.client.callTool({name, arguments: args})) as unknown as
            {content: unknown; isError?: boolean};
        if (result.isError) {
            const detail = extractToolErrorText(result.content) || 'unknown tool error';
            throw new Error(`MCP tool "${name}" reported an error: ${detail}`);
        }
        return result;
    }

    /**
     * 从服务端工具清单中按适配器命名约定解析出应调用的工具名
     */
    private resolveTool(
        adapter: RequirementSourceAdapter,
        capability: ToolCapability,
        tools: {name: string; description?: string}[],
    ): string | undefined {
        const patterns = adapter.capabilityPatterns[capability] ?? [];
        for (const pattern of patterns) {
            const hit = tools.find(t => pattern.test(t.name));
            if (hit) return hit.name;
        }
        return undefined;
    }

    /**
     * 按能力调用工具（能力 → 工具动态映射）
     * @description 优先使用 listTools 按适配器命名约定解析出的工具名；
     *   解析失败时回退逐个尝试适配器的候选名并跳过 "工具不存在" 错误；
     *   全部失败时抛出包含服务端实际工具清单的可操作错误。
     */
    private async callToolByCapability(
        ctx: ServerContext,
        capability: ToolCapability,
        args: Record<string, unknown>,
    ): Promise<{content: unknown}> {
        // 1. 已通过 listTools 按命名约定解析到工具名
        const resolved = ctx.toolByCapability[capability];
        if (resolved) {
            return this.invokeTool(ctx, resolved, args);
        }

        // 2. 解析失败（工具清单不可用 / 命名约定未命中）：回退尝试适配器候选名
        const candidates = ctx.adapter.fallbackToolNames[capability] ?? [];
        let lastErr: unknown;
        for (const name of candidates) {
            try {
                return await this.invokeTool(ctx, name, args);
            } catch (err) {
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
        throw lastErr ?? new Error(
            `No tool found on MCP server "${ctx.serverName}" for capability "${capability}" ` +
            `(adapter: ${ctx.adapter.id}).${available}`
        );
    }
}
