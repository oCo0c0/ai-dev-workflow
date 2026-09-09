/**
 * @module requirement-sources/types
 * @description 需求文档中立数据模型（源中立）
 *
 * 需求拉取已全面 agent 中介化（requirement-agent-fetch.ts）：AI 引擎动态面对
 * 已挂载的 MCP 工具（读 schema → 自主选择与调用），按 JSON 契约返回本模块
 * 定义的数据结构。不再存在 per-source 适配器——新增需求源只需在 MCP 设置页
 * 配置对应 server，零代码。
 *
 * 唯一的源特定残留是附件图片认证：AttachmentImageService 由 env 检测工厂
 * （ones-image-service.ts createAttachmentImageService）按 server 配置构建。
 */

// === 数据模型（需求源中立） ===

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

// === 附件/图片下载服务（认证插件） ===

/**
 * 附件图片下载服务契约
 * @description 部分需求源的附件需要认证才能下载（如 ONES PKCE）。
 *   createAttachmentImageService（ones-image-service.ts）按 MCP server 的
 *   env 检测构建实现；不匹配任何认证形态时返回 null（跳过认证下载）。
 *   RequirementStoreService 只依赖本接口，不感知具体源。
 */
export interface AttachmentImageService {
    /** 批量下载 wiki/文档类图片（策略 1） */
    downloadWikiImages(
        taskUuid: string,
        resources: Array<{ name: string; url?: string }>,
        imgDir: string,
    ): Promise<number>;
    /** 下载富文本描述内嵌图片（策略 2） */
    downloadTaskImages(
        taskUuid: string,
        imgDir: string,
    ): Promise<Array<{ uuid: string; filename: string; localPath: string }>>;
    /** 兜底：按资源 hash 下载单个图片 */
    downloadImage(resourceUuid: string, destPath: string): Promise<boolean>;
}
