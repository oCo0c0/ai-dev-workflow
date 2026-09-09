/**
 * @module requirement-sources/parsers
 * @description agent JSON 契约 → 中立数据模型的共享映射器
 *
 * agent 中介拉取的输出是统一 JSON 契约（见 agent-fetch.ts 的 prompt），
 * 这里做兼容驼峰/下划线的宽松映射；无任何源特定分支。
 */
import type { Attachment, Requirement, RequirementDetail, RelatedIssue } from './types.js';
/**
 * 将 JSON 数组的单个条目映射为需求摘要（兼容驼峰/下划线命名）
 */
export declare function mapJsonToRequirement(item: Record<string, unknown>): Requirement;
/**
 * 将 JSON 对象映射为需求详情（agent JSON 契约字段；兼容驼峰/下划线命名）
 */
export declare function mapJsonToDetailBase(data: Record<string, unknown>): RequirementDetail;
/** 将未知类型安全转换为字符串数组 */
export declare function parseStringArray(raw: unknown): string[];
/** 将未知类型安全转换为附件数组 */
export declare function parseAttachments(raw: unknown): Attachment[];
/** 将未知类型安全转换为关联问题数组 */
export declare function parseRelatedIssues(raw: unknown): RelatedIssue[];
//# sourceMappingURL=parsers.d.ts.map