/**
 * @file MCP 桥接服务（纯传输层）
 * @description 与 MCP (Model Context Protocol) 服务器之间的通信桥。
 *
 * 职责（协议通用，零源语义）：
 * - 连接生命周期：懒连接 + 按服务器缓存 + 断线驱逐重连
 * - listTools 动态发现（agent 中介拉取把工具面交给 AI 引擎动态消费）
 * - 按名调用工具（统一超时 / MCP isError 透出）
 *
 * 需求拉取语义（输入方言、工具选择、响应解析）全部由 agent-fetch.ts 的
 * AI 引擎承担——新增需求源（GitLab / Jira / 任意 MCP）零代码。
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { getErrorMessage } from './error-utils.js';
import { createAttachmentImageService } from './ones-image-service.js';
/** Windows 下需要经由 cmd /c 拉起的脚本型命令（spawn 无 shell 时解析不了 .cmd） */
const WINDOWS_SCRIPT_COMMANDS = new Set(['npx', 'npm', 'pnpm', 'yarn', 'bun', 'bunx', 'deno', 'uvx', 'uv', 'node', 'python', 'python3', 'pip']);
/** 单次 MCP 工具调用超时（毫秒） */
const TOOL_CALL_TIMEOUT_MS = 120_000;
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
/**
 * 从 MCP 工具响应 content 中提取纯文本
 */
function extractToolText(content) {
    if (!Array.isArray(content))
        return '';
    return content
        .map((item) => {
        if (item && typeof item === 'object'
            && typeof item.text === 'string') {
            return item.text;
        }
        return '';
    })
        .filter(Boolean)
        .join('\n')
        .trim();
}
/**
 * MCP 桥接服务类
 * @description 封装与 MCP 服务器的通信逻辑：
 *   - 按服务器维持连接池（切换源不销毁其它源的连接）
 *   - listTools 动态发现工具清单（schema 一并返回，交给 AI 引擎消费）
 *   - 按名调用工具：统一超时、断线重连一次、isError 错误透出
 */
export class MCPBridgeService {
    /** MCP 配置源 */
    mcpConfigSource;
    /** 默认使用的 MCP 服务器名称 */
    serverName;
    /** 连接池：serverName → 上下文 */
    pool = new Map();
    /** 连接中标志（按 serverName 隔离，防止并发连接竞争） */
    connecting = new Set();
    constructor(mcpConfigSource, serverName) {
        this.mcpConfigSource = mcpConfigSource;
        this.serverName = serverName ?? 'ones-api';
    }
    // === 服务器解析 ===
    /**
     * 解析实际使用的服务器名
     * @description 显式指定时原样使用（未配置由连接层抛出明确错误）；
     *   未指定时用默认名，默认名未配置且配置源支持枚举时取第一个启用的。
     */
    resolveServerName(explicit) {
        if (explicit)
            return explicit;
        if (this.mcpConfigSource.get(this.serverName))
            return this.serverName;
        const enabled = this.listEnabledServers();
        if (enabled.length > 0)
            return enabled[0].name;
        return this.serverName;
    }
    /** 全部启用的 MCP 服务器配置 */
    listEnabledServers() {
        return (this.mcpConfigSource.list?.() ?? []).filter(s => s.enabled);
    }
    /**
     * 获取当前生效的服务器名（含自动解析，不建立连接）
     */
    getResolvedServerName(opts) {
        return this.resolveServerName(opts?.serverName);
    }
    // === 连接管理 ===
    /**
     * 确保指定服务器的 MCP 连接可用（懒连接 + 按服务器缓存 + 并发去重）
     */
    async ensureConnected(serverName) {
        const existing = this.pool.get(serverName);
        if (existing)
            return existing;
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
            const transport = config.url !== undefined
                ? await buildHttpTransport(config)
                : buildStdioTransport(config);
            const client = new Client({ name: 'ai-dev-workbench', version: '0.1.0' }, { capabilities: {} });
            await client.connect(transport);
            // 连接意外断开（子进程死亡/网络中断）时驱逐池条目，下次调用自动重连
            client.onclose = () => {
                if (this.pool.get(serverName)?.client === client) {
                    this.pool.delete(serverName);
                }
            };
            const ctx = { client, serverName };
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
    // === 业务接口（agent 中介拉取消费） ===
    /**
     * 列出指定服务器的工具清单（连接 + listTools 动态发现）
     * @returns 工具名 / 描述 / JSON Schema（交给 AI 引擎动态消费）
     */
    async listServerTools(serverName) {
        const ctx = await this.ensureConnected(serverName);
        const result = await ctx.client.listTools(undefined, { timeout: 30_000 });
        return result.tools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
        }));
    }
    /**
     * 调用指定服务器的一个工具
     * @description 断线类错误驱逐死连接重试一次；MCP 协议级错误
     *   （isError）以 {isError: true, text} 透出给 AI 引擎自行换路。
     * @returns 工具输出文本与 isError 标志
     */
    async callServerTool(serverName, toolName, args) {
        const invoke = async () => {
            const ctx = await this.ensureConnected(serverName);
            const result = (await ctx.client.callTool({ name: toolName, arguments: args }, undefined, { timeout: TOOL_CALL_TIMEOUT_MS }));
            const text = extractToolText(result.content);
            if (result.isError) {
                return { text: text || 'unknown tool error', isError: true };
            }
            return { text, isError: false };
        };
        try {
            return await invoke();
        }
        catch (err) {
            if (!this.isConnectionError(err))
                throw err;
            this.pool.delete(serverName);
            return invoke();
        }
    }
    /**
     * 获取指定服务器的附件图片下载服务
     * @description 按 server env 检测构建（如 ONES PKCE）；未命中返回 undefined
     */
    getAttachmentImageService(opts) {
        const serverName = this.resolveServerName(opts?.serverName);
        const config = this.mcpConfigSource.get(serverName);
        return createAttachmentImageService(config);
    }
    /** 获取指定服务器配置（未配置返回 undefined） */
    getServerConfig(serverName) {
        return this.mcpConfigSource.get(serverName);
    }
    // === 私有方法 ===
    /**
     * 判断错误是否为连接断开类（连接池中的子进程/网络死亡后 SDK 抛出）
     */
    isConnectionError(err) {
        return /not connected|connection closed|transport (is )?closed|transport error|disconnected|socket hang up|aborted/i
            .test(getErrorMessage(err));
    }
}
//# sourceMappingURL=mcp-bridge.js.map