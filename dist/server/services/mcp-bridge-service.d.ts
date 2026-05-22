/**
 * @file MCP 桥接服务
 * @description 提供与 MCP (Model Context Protocol) 服务器之间的通信桥接能力。
 *   通过标准化的 MCP 客户端协议，支持从外部需求管理工具（如 ONES、Jira、GitLab 等）
 *   获取需求详情、搜索需求列表等操作。该服务采用懒连接策略，仅在首次调用时建立连接，
 *   并支持动态切换目标 MCP 服务器。
 */
import { MCPConfigService, MCPServerConfig } from './mcp-config-service.js';
/**
 * 需求基本信息接口
 * @description 表示从 MCP 服务器获取的需求摘要信息，用于列表展示和搜索结果
 */
export interface Requirement {
    /** 需求唯一标识符 */
    id: string;
    /** 需求编号（如 #91086），用户可识别的编号 */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态（如 open、in_progress、closed 等） */
    status: string;
    /** 需求优先级（如 high、medium、low） */
    priority: string;
    /** 需求负责人 */
    assignee: string;
    /** 最后更新时间（ISO 8601 格式） */
    updatedAt: string;
}
/**
 * 需求详细信息接口
 * @description 继承 Requirement，包含需求的完整详情，用于详情页面展示
 */
export interface RequirementDetail extends Requirement {
    /** 需求详细描述内容 */
    description: string;
    /** 验收标准列表 */
    acceptanceCriteria: string[];
    /** 附件列表 */
    attachments: Attachment[];
    /** 关联问题列表 */
    relatedIssues: RelatedIssue[];
}
/**
 * 附件信息接口
 * @description 表示需求关联的附件文件
 */
interface Attachment {
    /** 附件文件名 */
    name: string;
    /** 附件访问 URL */
    url: string;
    /** 附件 MIME 类型 */
    type: string;
}
/**
 * 关联问题接口
 * @description 表示与当前需求关联的其他问题/缺陷
 */
export interface RelatedIssue {
    /** 关联问题的唯一标识符 */
    id: string;
    /** 关联问题的标题 */
    title: string;
    /** 关联问题的状态 */
    status: string;
}
/**
 * MCP 桥接服务类
 * @description 封装了与 MCP 服务器的通信逻辑，提供需求获取和搜索的统一接口。
 *   核心特性包括：
 *   - 懒连接：仅在首次调用时建立与 MCP 服务器的连接
 *   - 连接复用：已建立的连接会被缓存，后续调用直接复用
 *   - 并发保护：通过 connecting 标志位防止重复连接
 *   - 动态切换：支持运行时切换目标 MCP 服务器
 *   - 多格式解析：支持 JSON 和 Markdown 两种 MCP 响应格式的解析
 */
export declare class MCPBridgeService {
    /** MCP 配置服务实例，用于获取服务器连接配置 */
    private mcpConfigService;
    /** 当前使用的 MCP 服务器名称，默认为 'ones-api' */
    private serverName;
    /** MCP 客户端实例，为 null 表示尚未连接 */
    private client;
    /** 连接中标志位，防止并发连接请求导致的竞争条件 */
    private connecting;
    /**
     * 构造函数
     * @param mcpConfigService - MCP 配置服务实例，提供服务器配置信息
     * @param serverName - 可选的 MCP 服务器名称，默认为 'ones-api'
     */
    constructor(mcpConfigService: MCPConfigService, serverName?: string);
    /**
     * 确保 MCP 客户端连接可用
     * @description 采用懒连接策略，仅在首次调用时建立连接。如果已有活跃连接则直接返回。
     *   当检测到有其他调用正在进行连接时，等待 1 秒后再次检查连接状态。
     * @returns 已连接的 MCP 客户端实例
     * @throws 当服务器未配置或连接失败时抛出错误
     */
    private ensureConnected;
    /**
     * 断开与 MCP 服务器的连接并释放资源
     */
    disconnect(): Promise<void>;
    /**
     * 获取指定需求的详细信息
     * @param id - 需求的唯一标识符
     * @returns 需求详细信息对象
     * @throws 当获取失败时抛出包含需求 ID 和原始错误信息的错误
     */
    fetchRequirementDetail(id: string): Promise<RequirementDetail>;
    /**
     * 按关键字搜索需求列表
     * @param query - 搜索关键字
     * @returns 匹配的需求列表
     * @throws 当搜索失败时抛出包含原始错误信息的错误
     */
    searchRequirements(query: string): Promise<Requirement[]>;
    /**
     * 获取当前配置的 MCP 服务器名称
     * @returns 当前 MCP 服务器名称
     */
    getServerName(): string;
    /**
     * 设置要使用的 MCP 服务器名称
     * @description 设置新名称后会自动断开当前连接，确保下次调用时重新连接到新服务器
     * @param name - 新的 MCP 服务器名称
     */
    setServerName(name: string): void;
    /**
     * 获取当前 MCP 服务器的配置信息（公开方法，供路由层读取认证参数等）
     * @returns 服务器配置对象，如果未配置则返回 undefined
     */
    getServerConfig(): MCPServerConfig | undefined;
    /**
     * 从 MCP 工具调用结果中提取纯文本内容
     * @description MCP 工具返回的内容格式为数组，每个元素为 { type: 'text', text: '...' } 结构。
     *   该方法遍历数组找到第一个文本类型的元素并返回其文本值。
     * @param content - MCP 工具调用的原始返回内容
     * @returns 提取到的文本字符串，如果没有找到则返回 null
     */
    private extractContentText;
    /**
     * 从 MCP 工具调用结果中提取 JSON 数据
     * @description 先提取纯文本，然后尝试解析为 JSON。如果解析失败则返回原始文本。
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的 JSON 对象、原始文本字符串或 null
     */
    private extractContentJson;
    /**
     * 将 MCP 原始响应内容解析为需求列表
     * @description 支持两种响应格式：
     *   1. JSON 数组格式：直接映射每个对象的字段
     *   2. Markdown 文本格式：通过正则表达式逐行解析 Markdown 结构
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的需求列表，无法解析时返回空数组
     */
    private parseRequirementList;
    /**
     * 解析 Markdown 格式的需求列表
     * @description 逐行扫描 Markdown 文本，匹配格式为 "### [STATUS] ID: #NUMBER Title" 的行，
     *   并从后续行中提取优先级和负责人等元数据信息。
     * @param text - Markdown 格式的需求列表文本
     * @returns 解析后的需求列表
     */
    private parseMarkdownRequirementList;
    /**
     * 将 MCP 原始响应内容解析为需求详情
     * @description 支持两种响应格式：
     *   1. JSON 对象格式：直接映射所有字段，包括嵌套的验收标准、附件和关联问题
     *   2. Markdown 文本格式：通过正则表达式解析 Markdown 结构化的需求详情
     * @param content - MCP 工具调用的原始返回内容
     * @returns 解析后的需求详情对象
     * @throws 当响应内容无法解析为有效格式时抛出错误
     */
    private parseRequirementDetail;
    /**
     * 解析 Markdown 格式的需求详情
     * @description ones-api MCP 返回的 Markdown 格式示例如下：
     *   ```
     *   # #130770 Title
     *   - **ID**: RbSvp3zzkJyHJ47Y
     *   - **Status**: open
     *   ...
     *   ---
     *   ## Requirement Detail
     *   actual description content here
     *   ```
     *   该方法按优先级依次尝试多个章节名称来提取描述内容，
     *   并支持中英文的验收标准章节名称。
     * @param text - Markdown 格式的需求详情文本
     * @returns 解析后的需求详情对象
     */
    private parseMarkdownRequirementDetail;
    /**
     * 将未知类型的安全转换为字符串数组
     * @param raw - 待转换的原始值
     * @returns 字符串数组，如果输入无效则返回空数组
     */
    private parseStringArray;
    /**
     * 将未知类型的安全转换为附件数组
     * @param raw - 待转换的原始值
     * @returns 附件对象数组，如果输入无效则返回空数组
     */
    private parseAttachments;
    /**
     * 将未知类型的安全转换为关联问题数组
     * @param raw - 待转换的原始值
     * @returns 关联问题对象数组，如果输入无效则返回空数组
     */
    private parseRelatedIssues;
}
export {};
//# sourceMappingURL=mcp-bridge-service.d.ts.map