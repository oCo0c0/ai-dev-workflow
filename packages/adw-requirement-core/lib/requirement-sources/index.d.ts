/**
 * @module requirement-sources
 * @description 纯 re-export（types + parsers）。
 *
 * 原 per-source 适配器（ones/github/generic）已删除：需求拉取全面 agent 中介化
 * （AI 引擎动态面对已挂载 MCP 工具），新增需求源只需配置 MCP server，零代码。
 */
export type { Requirement, RequirementDetail, Attachment, RelatedIssue, AttachmentImageService, } from './types.js';
export { mapJsonToRequirement, mapJsonToDetailBase, parseStringArray, parseAttachments, parseRelatedIssues, } from './parsers.js';
//# sourceMappingURL=index.d.ts.map