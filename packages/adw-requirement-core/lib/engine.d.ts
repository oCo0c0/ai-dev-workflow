/**
 * @file 需求引擎（Facade）
 * @description 组合 MCP 配置、纯传输桥、agent 中介拉取与本地存储，对 dsh-adw
 *   宿主半暴露「拉取 / 搜索 / 列表 / 刷新 / 执行链接」一体的高层 API。
 *   路由与 agent 工具都只依赖本引擎，不感知 MCP 细节。
 *
 *   拉取/搜索全面 agent 中介化（AgentFetchService）：AI 引擎动态面对已挂载
 *   MCP 工具（读 schema → 自主调用 → JSON 契约），零源硬编码。
 */
import { type AgentLlm } from './agent-fetch.js';
import type { Requirement, RequirementDetail } from './requirement-sources/index.js';
import { type ExecutionLink, type ParsedAttachment, type SavedRequirement } from './store.js';
/** 拉取选项 */
export interface FetchOptions {
    /** 目标 MCP server（缺省自动解析） */
    serverName?: string;
}
/** 引擎构造选项 */
export interface EngineOptions {
    /** 数据目录（需求存储与自管 MCP 配置所在，如 ~/.dsh/dsh-adw） */
    dataDir: string;
    /** 默认 MCP server 名 */
    defaultServerName?: string;
    /** 本地图片 URL 前缀（默认 /api/dsh-adw/requirements，宿主路由据此服务图片） */
    imageUrlBasePrefix?: string;
    /**
     * agent 模型运行时（惰性取值：宿主 llm 服务可能后挂载/热切换）
     * 缺省时 fetch/search 抛出明确错误（AGENT_UNAVAILABLE 语义）
     */
    agentLlm?: () => AgentLlm | undefined;
}
/**
 * 需求引擎
 * @description 生命周期：构造即就绪；dispose 断开全部 MCP 连接。
 */
export declare class RequirementEngine {
    private readonly mcpConfig;
    private readonly bridge;
    private readonly agentFetch;
    private readonly store;
    private readonly imageUrlBasePrefix;
    constructor(opts: EngineOptions);
    /** 连接测试 */
    testServer(serverName: string): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** 删除一个 MCP server 配置（源卸载；返回是否存在） */
    removeServer(serverName: string): boolean;
    /** 列出自管文件中的全部 MCP 服务器（含 url 型自定义服务器） */
    listServers(): Array<import('./mcp-config.js').MCPServerConfig>;
    /** 添加自定义 MCP 服务器（stdio command/args 或 http url），返回添加结果 */
    addServer(config: {
        name: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
    }): import('./mcp-config.js').MCPServerConfig;
    /**
     * 拉取需求并保存（agent 中介：AI 引擎动态消费 MCP 工具）
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner-repo#N）
     * @returns 保存后的完整需求（含溯源 + 既有执行历史）
     */
    fetchAndSave(input: string, opts?: FetchOptions): Promise<SavedRequirement>;
    /** 本地图片文件路径（宿主静态路由用；不存在/不安全返回 undefined） */
    getImagePath(id: string, filename: string): string | undefined;
    /** 源内搜索（agent 中介，不落库） */
    search(query: string, opts?: FetchOptions): Promise<Requirement[]>;
    /** 已保存需求列表（最近拉取在前） */
    list(): SavedRequirement[];
    /** 已保存需求详情 */
    get(id: string): SavedRequirement | undefined;
    /** 删除 */
    delete(id: string): boolean;
    /** 按原始输入重拉并覆盖（保留执行历史） */
    refresh(id: string): Promise<SavedRequirement | undefined>;
    /** 记录一条执行链接（生成 executionId） */
    addExecution(id: string, link: Omit<ExecutionLink, 'executionId' | 'startedAt'> & {
        startedAt?: string;
    }): {
        executionId: string;
        requirement: SavedRequirement;
    } | undefined;
    /** 回写执行结局 */
    settleExecution(id: string, executionId: string, outcome: ExecutionLink['outcome'], error?: string): SavedRequirement | undefined;
    /** 写入一份附件解析结果 */
    setParsedAttachment(id: string, name: string, record: ParsedAttachment): SavedRequirement | undefined;
    /** 保存文档工作副本 */
    setWorkingDescription(id: string, description: string): SavedRequirement | undefined;
    /** 放弃文档工作副本（回到源描述） */
    clearWorkingDescription(id: string): SavedRequirement | undefined;
    /** 删除一份附件（移出列表 + 清解析结果 + 剥工作副本合并标记块） */
    removeAttachment(id: string, name: string): SavedRequirement | undefined;
    /** 断开全部 MCP 连接（插件卸载时调用） */
    dispose(): Promise<void>;
}
/** 渲染开发 prompt（占位符替换，纯函数；模板来自插件设置）
 *  {{description}} 优先用工作副本（编辑 + 解析合并的成果），未设置时用源描述 */
export declare function renderDevPrompt(template: string, req: RequirementDetail & {
    workingDescription?: string;
}): string;
//# sourceMappingURL=engine.d.ts.map