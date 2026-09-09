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
import type { MCPServerConfig } from './mcp-config.js';
import type { AttachmentImageService } from './requirement-sources/index.js';
/**
 * MCP 配置源契约（get/list 即可；增删测由引擎直连 MCPConfigService）
 */
export interface MCPConfigSource {
    get(name: string): MCPServerConfig | undefined;
    list?(): MCPServerConfig[];
}
/** 方法级选项：临时指定目标服务器（不修改服务默认值） */
export interface BridgeCallOptions {
    serverName?: string;
}
/** 服务器工具清单条目（agent 工具面直接消费） */
export interface ServerToolInfo {
    name: string;
    description?: string;
    inputSchema?: unknown;
}
/**
 * MCP 桥接服务类
 * @description 封装与 MCP 服务器的通信逻辑：
 *   - 按服务器维持连接池（切换源不销毁其它源的连接）
 *   - listTools 动态发现工具清单（schema 一并返回，交给 AI 引擎消费）
 *   - 按名调用工具：统一超时、断线重连一次、isError 错误透出
 */
export declare class MCPBridgeService {
    /** MCP 配置源 */
    private mcpConfigSource;
    /** 默认使用的 MCP 服务器名称 */
    private serverName;
    /** 连接池：serverName → 上下文 */
    private pool;
    /** 连接中标志（按 serverName 隔离，防止并发连接竞争） */
    private connecting;
    constructor(mcpConfigSource: MCPConfigSource, serverName?: string);
    /**
     * 解析实际使用的服务器名
     * @description 显式指定时原样使用（未配置由连接层抛出明确错误）；
     *   未指定时用默认名，默认名未配置且配置源支持枚举时取第一个启用的。
     */
    private resolveServerName;
    /** 全部启用的 MCP 服务器配置 */
    listEnabledServers(): MCPServerConfig[];
    /**
     * 获取当前生效的服务器名（含自动解析，不建立连接）
     */
    getResolvedServerName(opts?: BridgeCallOptions): string;
    /**
     * 确保指定服务器的 MCP 连接可用（懒连接 + 按服务器缓存 + 并发去重）
     */
    private ensureConnected;
    /**
     * 断开全部 MCP 连接并释放资源
     */
    disconnect(): Promise<void>;
    /**
     * 列出指定服务器的工具清单（连接 + listTools 动态发现）
     * @returns 工具名 / 描述 / JSON Schema（交给 AI 引擎动态消费）
     */
    listServerTools(serverName: string): Promise<ServerToolInfo[]>;
    /**
     * 调用指定服务器的一个工具
     * @description 断线类错误驱逐死连接重试一次；MCP 协议级错误
     *   （isError）以 {isError: true, text} 透出给 AI 引擎自行换路。
     * @returns 工具输出文本与 isError 标志
     */
    callServerTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<{
        text: string;
        isError: boolean;
    }>;
    /**
     * 获取指定服务器的附件图片下载服务
     * @description 按 server env 检测构建（如 ONES PKCE）；未命中返回 undefined
     */
    getAttachmentImageService(opts?: BridgeCallOptions): AttachmentImageService | undefined;
    /** 获取指定服务器配置（未配置返回 undefined） */
    getServerConfig(serverName: string): MCPServerConfig | undefined;
    /**
     * 判断错误是否为连接断开类（连接池中的子进程/网络死亡后 SDK 抛出）
     */
    private isConnectionError;
}
//# sourceMappingURL=mcp-bridge.d.ts.map