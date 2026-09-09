/**
 * @module requirement-sources
 * @description 需求文档模型与共享解析器（源中立，纯 re-export）
 *
 * 架构演进说明：本目录曾承载 per-source 适配器（ones/github/generic），
 * 已整体退役——需求拉取全面 agent 中介化（requirement-agent-fetch.ts）：
 * AI 引擎动态面对已挂载的 MCP 工具读 schema、自主选择与调用、失败自行换路，
 * 新增需求源（GitLab/Jira/任意 MCP）只需在 MCP 设置页配置 server，零代码。
 *
 * 保留内容：
 * - types.ts：中立数据模型（Requirement/RequirementDetail）与附件图片服务契约
 * - parsers.ts：agent JSON 契约 → 数据模型的共享映射
 */

export type {
    Requirement,
    RequirementDetail,
    Attachment,
    RelatedIssue,
    AttachmentImageService,
} from './types.js';
export {
    mapJsonToRequirement,
    mapJsonToDetailBase,
    parseStringArray,
    parseAttachments,
    parseRelatedIssues,
} from './parsers.js';
