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
import type { MCPServerConfig } from './mcp-config.js';
import type { AttachmentImageService, Requirement, RequirementDetail, SourceInstallTemplate } from './requirement-sources/index.js';
export type { Requirement, RequirementDetail } from './requirement-sources/index.js';
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
    testConnection?(name: string, timeoutMs?: number): Promise<{
        ok?: boolean;
        status?: string;
        message: string;
    }>;
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
export declare class MCPBridgeService {
    /** MCP 配置源（注册中心或兼容 get/list 的服务） */
    private mcpConfigSource;
    /** 默认使用的 MCP 服务器名称 */
    private serverName;
    /** 连接池：serverName → 上下文 */
    private pool;
    /** 连接中标志（按 serverName 隔离，防止并发连接竞争） */
    private connecting;
    /**
     * 构造函数
     * @param mcpConfigSource - MCP 配置源（MCPRegistryService / MCPConfigService）
     * @param serverName - 可选的默认 MCP 服务器名称（缺省 'ones-api'，未配置时自动解析）
     */
    constructor(mcpConfigSource: MCPConfigSource, serverName?: string);
    /**
     * 解析实际使用的服务器名
     * @description 显式指定时原样使用（未配置由连接层抛出明确错误，绝不静默
     *   切换到其它服务器）；未指定时用默认名，默认名未配置且配置源支持枚举时，
     *   自动选择第一个被专用适配器认领的服务器（否则第一个已配置的）。
     * @returns 实际使用的服务器名
     */
    private resolveServerName;
    /**
     * 获取当前生效的服务器名（含自动解析，不建立连接）
     * @param opts - 可选的目标服务器
     */
    getResolvedServerName(opts?: BridgeCallOptions): string;
    /**
     * 获取默认配置的 MCP 服务器名称
     */
    getServerName(): string;
    /**
     * 设置默认使用的 MCP 服务器名称
     * @description 连接池按名缓存，切换默认服务器不影响已有连接的复用
     * @param name - 新的服务器名称
     */
    setServerName(name: string): void;
    /**
     * 获取指定服务器的配置信息
     * @param opts - 可选的目标服务器（缺省用解析后的默认名）
     */
    getServerConfig(opts?: BridgeCallOptions): MCPServerConfig | undefined;
    /**
     * 确保指定服务器的 MCP 连接可用
     * @description 懒连接 + 按服务器缓存。连接后 listTools 动态发现工具，
     *   按适配器的命名约定解析能力 → 工具名（失败不阻塞连接）。
     */
    private ensureConnected;
    /**
     * 断开全部 MCP 连接并释放资源
     */
    disconnect(): Promise<void>;
    /**
     * 按用户输入获取需求详情（推荐入口）
     * @description 完整链路：适配器规整输入 → 纯编号先搜索解析真实 ID →
     *   拉取详情 → 回填编号。兼容各源输入方言。
     * @param input - 用户原始输入（链接 / 编号 / issue key / owner/repo#N）
     * @param opts - 可选的目标服务器
     * @returns 需求详情与实际使用的服务器名
     */
    fetchRequirementByInput(input: string, opts?: BridgeCallOptions): Promise<{
        detail: RequirementDetail;
        serverName: string;
    }>;
    /**
     * 获取指定需求的详细信息
     * @param id - 需求标识（适配器方言内的可定位 id：uuid / owner-repo#N 等）
     * @param opts - 可选的目标服务器
     * @throws 获取失败时抛出包含需求 ID 和原始错误信息的错误
     */
    fetchRequirementDetail(id: string, opts?: BridgeCallOptions): Promise<RequirementDetail>;
    /**
     * 按关键字搜索需求列表
     * @param query - 搜索关键字
     * @param opts - 可选的目标服务器
     * @throws 搜索失败时抛出包含原始错误信息的错误
     */
    searchRequirements(query: string, opts?: BridgeCallOptions): Promise<Requirement[]>;
    /**
     * 列出需求源目录（适配器视角，非 MCP server 视角）
     * @description 平台能力目录：每个已注册适配器一个条目，携带其已配置的
     *   MCP server 列表与一键安装模板。前端据此渲染"选择源系统 → 未配置则
     *   引导安装"，工具型 MCP（memory 等）不会出现。generic 兜底不外显。
     */
    listSources(): RequirementSourceEntry[];
    /**
     * 按适配器模板一键安装需求源
     * @description 从适配器的 installTemplate 创建 MCP server（Windows 下自动
     *   经 cmd /c 包装），写入配置源后做一次连接测试。
     * @param adapterId - 目标适配器 id
     * @param env - 用户填写的凭据（key 来自模板 envSpecs）
     * @returns 创建的 server 名与连接测试结果
     * @throws 适配器不存在 / 不支持安装 / 必填凭据缺失 / 同名 server 已存在
     */
    installSource(adapterId: string, env: Record<string, string>): Promise<{
        serverName: string;
        connectionTest?: {
            ok: boolean;
            message: string;
        };
    }>;
    /**
     * 获取指定服务器的附件图片下载服务
     * @description 由适配器从 MCP server 配置构建（认证策略源特定）；不支持时返回 undefined
     */
    getAttachmentImageService(opts?: BridgeCallOptions): AttachmentImageService | undefined;
    /**
     * 判断错误是否为 JSON-RPC "工具不存在"（-32602 Invalid params: Tool xxx not found）
     */
    private isToolNotFoundError;
    /**
     * 判断错误是否为连接断开类（连接池中的子进程/网络死亡后 SDK 抛出）
     */
    private isConnectionError;
    /**
     * 执行一次工具调用，遇到连接断开类错误时驱逐死连接并重建重试一次
     * @description 池中连接底层进程可能已死亡（npx 缓存更新/进程崩溃/宿主回收），
     *   此时 SDK 调用抛 "Not connected"；驱逐池条目后 ensureConnected 会重新拉起。
     * @returns 命中的服务器上下文与工具响应 content
     */
    private callToolWithReconnect;
    /**
     * 调用单个工具并检查 MCP 协议级错误（isError）
     * @description MCP 工具执行失败时返回 {content:[{text:"Error: ..."}], isError:true}
     *   而非 JSON-RPC 错误；忽略该标志会把错误文本当正文解析（产生空需求壳），
     *   故在此显式转换为异常，让错误信息透出到调用方。
     */
    private invokeTool;
    /**
     * 从服务端工具清单中按适配器命名约定解析出应调用的工具名
     */
    private resolveTool;
    /**
     * 按能力调用工具（能力 → 工具动态映射）
     * @description 优先使用 listTools 按适配器命名约定解析出的工具名；
     *   解析失败时回退逐个尝试适配器的候选名并跳过 "工具不存在" 错误；
     *   全部失败时抛出包含服务端实际工具清单的可操作错误。
     */
    private callToolByCapability;
}
//# sourceMappingURL=mcp-bridge.d.ts.map