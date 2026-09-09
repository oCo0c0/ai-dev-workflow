/**
 * @file agent 中介需求拉取/搜索（标准 MCP 消费模式）
 * @description 与 adw 本体（src/server/services/requirement-agent-fetch.ts）
 *   同一架构：AI 引擎动态面对已挂载的 MCP 工具——读 schema → 自主选择与调用
 *   → 失败换工具/换参自愈 → 统一 JSON 契约输出。应用侧零源硬编码，新增需求
 *   源（GitLab / Jira / 任意 MCP）只需配置 MCP server。
 *
 * 引擎无关：通过 AgentLlm 端口抽象模型运行时（dsh-adw 宿主用 ctx.llm 适配），
 * MCP 工具面由 MCPBridgeService 提供（<server>__<tool> 前缀全局唯一）。
 */
import type { MCPBridgeService } from './mcp-bridge.js';
import type { Requirement, RequirementDetail } from './requirement-sources/index.js';
/** 模型内容块（dsh-llm ContentBlock 的结构子集） */
export type AgentContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'tool-call';
    id: string;
    name: string;
    arguments: string;
} | {
    type: 'tool-result';
    toolCallId: string;
    content: AgentContentBlock[];
    isError?: boolean;
};
/** 交给模型的工具定义（参数为标准 JSON Schema） */
export interface AgentToolDef {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
/** 一轮模型输出 */
export interface AgentTurnResult {
    /** 助手内容块（文本 / 工具调用） */
    blocks: AgentContentBlock[];
    /** stop=最终回复；tool-calls=待执行工具；其余视为失败 */
    stopKind: 'stop' | 'tool-calls' | 'max-tokens' | 'error' | 'aborted';
    /** error/aborted 时的失败信息 */
    error?: string;
}
/** 一段多轮 agent 会话（宿主实现：维护模型侧消息历史） */
export interface AgentChat {
    /** 发送一轮用户内容（首轮任务文本 / 后续工具结果），返回助手输出 */
    send(content: AgentContentBlock[]): Promise<AgentTurnResult>;
}
/** AgentLlm 端口：宿主（如 dsh ctx.llm）适配实现 */
export interface AgentLlm {
    createChat(opts: {
        system: string;
        tools: AgentToolDef[];
    }): AgentChat;
}
/** 构建拉取 prompt（与 adw 本体同款契约） */
export declare function buildFetchPrompt(input: string): string;
/** 构建搜索 prompt */
export declare function buildSearchPrompt(query: string): string;
/** 拉取选项 */
export interface AgentFetchOptions {
    /** 目标 MCP server（缺省 = 全部启用的 server，交给 agent 自主分辨） */
    serverName?: string;
}
/** 依赖注入 */
export interface AgentFetchDeps {
    /** MCP 传输桥（工具清单与调用） */
    bridge: MCPBridgeService;
    /** 模型运行时（惰性取值：宿主服务可能后挂载） */
    agentLlm: () => AgentLlm | undefined;
}
/**
 * agent 中介拉取/搜索服务
 * @description 工具面 = <server>__<tool>（全局唯一）；执行时剥前缀路由回
 *   对应 server。模型最终输出 JSON 契约，一次解析失败可纠正重试。
 */
export declare class AgentFetchService {
    private readonly bridge;
    private readonly getLlm;
    constructor(deps: AgentFetchDeps);
    /** 解析白名单：显式 server > 全部启用 server */
    private resolveWhitelist;
    /** 挂载白名单内全部 server 的工具面（带 <server>__ 前缀） */
    private mountTools;
    /** 执行一次工具调用（剥 <server>__ 前缀路由回对应 server） */
    private executeTool;
    /**
     * 运行一次 agent 会话：首轮任务 → 工具循环 → 最终文本
     * @returns 模型最终输出的文本（调用方负责按契约解析）
     */
    private runAgentChat;
    /**
     * agent 中介拉取需求详情
     * @returns 需求详情 + 实际使用的 MCP server 名
     */
    fetchByInput(input: string, opts?: AgentFetchOptions): Promise<RequirementDetail & {
        sourceServer: string;
    }>;
    /**
     * agent 中介源内搜索
     * @returns 需求摘要列表（不落库）
     */
    searchByInput(query: string, opts?: AgentFetchOptions): Promise<Requirement[]>;
}
//# sourceMappingURL=agent-fetch.d.ts.map