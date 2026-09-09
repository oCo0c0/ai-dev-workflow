/**
 * @module requirement-sources/types
 * @description 需求源中立数据模型（源零硬编码）
 *
 * 需求拉取已全面 agent 中介化：AI 引擎动态面对已挂载 MCP 工具（读 schema →
 * 自主选择与调用 → JSON 契约输出），应用侧不感知任何具体源（ONES / GitHub /
 * GitLab / Jira / ...）。本文件只保留跨源中立的数据模型与附件图片服务契约。
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

// === 附件/图片下载服务（唯一源特定残留：按 server env 检测构建） ===

/**
 * 附件图片下载服务契约
 * @description 个别需求源的附件认证方式特殊（如 ONES PKCE），按 MCP server
 *   配置的 env 检测构建（createAttachmentImageService）；不支持附件认证下载
 *   的源返回 undefined。RequirementStore 只依赖本接口，不感知具体源。
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
