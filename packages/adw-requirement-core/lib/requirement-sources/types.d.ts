/**
 * @module requirement-sources/types
 * @description 需求源适配器抽象接口（热插拔）
 *
 * 每个外部需求管理系统（ONES / GitHub Issues / Jira / ...）实现一个适配器，
 * 声明自己的输入方言、MCP 工具解析规则、响应格式解析和附件认证策略。
 * MCP 传输层（MCPBridgeService）只负责连接与调用，所有语义由适配器提供。
 *
 * 扩展方式：实现本接口 + 在 index.ts 注册一行工厂，无需修改任何调用方。
 */
import type { MCPServerConfig } from '../mcp-config.js';
/**
 * 需求基本信息接口
 * @description 表示从需求源获取的需求摘要信息，用于列表展示和搜索结果
 */
export interface Requirement {
    /** 需求唯一标识符（源内可定位：ONES uuid / GitHub issue number） */
    id: string;
    /** 需求编号（如 #91086），用户可识别的编号 */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态（源各自的原始值，如 open / closed / 进行中） */
    status: string;
    /** 需求优先级 */
    priority: string;
    /** 需求负责人 */
    assignee: string;
    /** 最后更新时间（ISO 8601 格式） */
    updatedAt: string;
}
/**
 * 需求详细信息接口
 * @description 继承 Requirement，包含需求的完整详情
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
 */
export interface Attachment {
    /** 附件文件名 */
    name: string;
    /** 附件访问 URL */
    url: string;
    /** 附件 MIME 类型 */
    type: string;
}
/**
 * 关联问题接口
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
 * 附件图片下载服务契约
 * @description 各需求源的附件认证方式不同（ONES PKCE / GitHub token / 无认证），
 *   适配器从 MCP server 配置构建实现此接口的服务；不支持附件下载的源返回 undefined。
 *   RequirementStoreService 只依赖本接口，不感知具体源。
 */
export interface AttachmentImageService {
    /** 批量下载 wiki/文档类图片（策略 1） */
    downloadWikiImages(taskUuid: string, resources: Array<{
        name: string;
        url?: string;
    }>, imgDir: string): Promise<number>;
    /** 下载富文本描述内嵌图片（策略 2） */
    downloadTaskImages(taskUuid: string, imgDir: string): Promise<Array<{
        uuid: string;
        filename: string;
        localPath: string;
    }>>;
    /** 兜底：按资源 hash 下载单个图片 */
    downloadImage(resourceUuid: string, destPath: string): Promise<boolean>;
}
/**
 * 凭据规格：安装一个需求源需要用户提供的环境变量
 */
export interface EnvKeySpec {
    /** 环境变量名（写入 MCP server 配置的 env） */
    key: string;
    /** 给用户看的字段名 */
    label: string;
    /** 是否必填 */
    required: boolean;
    /** 获取该凭据的指引（如申请地址） */
    hint?: string;
    /** 敏感凭据（密码/token）输入时掩码显示 */
    secret?: boolean;
}
/**
 * 一键配置模板：按模板自动创建对应的 MCP server
 * @description 用户在源目录里选择适配器后，若尚未配置，前端根据本模板
 *   渲染凭据表单并调用安装接口，无需用户了解 MCP 命令行细节。
 */
export interface SourceInstallTemplate {
    /** 推荐的 MCP server 名称 */
    serverName: string;
    /** 启动命令（跨平台，Windows 下自动经 cmd /c 包装） */
    command: string;
    /** 命令参数 */
    args: string[];
    /** 需要用户填写的凭据清单 */
    envSpecs: EnvKeySpec[];
    /** 安装说明（对话框中展示的补充信息） */
    instructions?: string;
}
/**
 * 需求桥接所需的能力标识
 * @description 业务侧只声明"要做什么"（能力），具体工具名由 listTools 动态解析
 */
export type ToolCapability = 'fetchDetail' | 'search';
/**
 * 需求源适配器统一接口
 * @description 所有需求源必须实现的抽象契约。MCPBridgeService 按
 *   "适配器提供语义、桥接提供传输" 的分工调用。
 */
export interface RequirementSourceAdapter {
    /** 适配器唯一标识（开放字符串） */
    readonly id: string;
    /** 显示名称 */
    readonly label: string;
    /** 目录展示用：一句话说明该源是什么 */
    readonly description: string;
    /**
     * 一键配置模板（目录能力）
     * @description 提供则该源支持在 UI 中一键安装（自动创建 MCP server）；
     *   无法自动安装的源可留空，前端展示手动配置指引。
     */
    readonly installTemplate?: SourceInstallTemplate;
    /**
     * 能力 → 工具名匹配模式（按优先级排列）
     * @description 遵循 MCP 动态发现（listTools）设计：连接后按命名约定
     *   从服务端工具清单解析工具，上游改名后只要仍符合约定即可自动适配。
     */
    readonly capabilityPatterns: Record<ToolCapability, RegExp[]>;
    /**
     * 已知版本的候选工具名（兜底用，仅当 listTools 不可用或解析失败时尝试）
     */
    readonly fallbackToolNames: Record<ToolCapability, string[]>;
    /**
     * 声明是否拥有此 MCP server 配置（自动路由依据）
     * @description 桥接层解析适配器时，按注册顺序询问各适配器；
     *   都不认领时落到 generic 适配器。
     */
    matchServer(config: MCPServerConfig): boolean;
    /**
     * 规整用户输入为该源可处理的形态
     * @description 各源输入方言不同：ONES 链接 / issue key、GitHub 的
     *   owner/repo#123、Jira 的 PROJ-123。返回值传给 buildDetailArgs。
     */
    normalizeInput(raw: string): string;
    /**
     * 从规整后的输入提取"纯编号"（如 '302'）。
     * 纯编号无法唯一定位时（跨项目重复），桥接层先搜索再取首个匹配；
     * 非编号形态返回 undefined 跳过搜索。
     */
    extractPlainNumber(normalized: string): string | undefined;
    /**
     * 构建详情工具的调用参数
     * @param normalizedInput - normalizeInput 的返回值
     * @param config - 当前 MCP server 配置（可读取源所需的环境变量）
     */
    buildDetailArgs(normalizedInput: string, config: MCPServerConfig): Record<string, unknown>;
    /**
     * 构建搜索工具的调用参数
     * @param query - 用户搜索关键字
     * @param config - 当前 MCP server 配置
     */
    buildSearchArgs(query: string, config: MCPServerConfig): Record<string, unknown>;
    /**
     * 将 MCP 工具返回内容解析为需求详情
     * @throws 无法解析时抛出明确错误
     */
    parseDetail(content: unknown): RequirementDetail;
    /**
     * 将 MCP 工具返回内容解析为需求列表
     * @returns 解析后的需求列表，无法解析时返回空数组
     */
    parseList(content: unknown): Requirement[];
    /**
     * 从 MCP server 配置构建附件/图片下载服务
     * @returns 支持附件下载的源返回服务实例，否则 undefined
     */
    createImageService(config: MCPServerConfig): AttachmentImageService | undefined;
}
//# sourceMappingURL=types.d.ts.map