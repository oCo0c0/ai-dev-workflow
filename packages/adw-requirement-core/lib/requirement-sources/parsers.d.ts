/**
 * @module requirement-sources/parsers
 * @description 需求源共享解析器
 *
 * 从 MCP 工具返回内容（JSON / Markdown）解析为中立数据模型的通用实现。
 * Markdown 详情解析的章节顺序等源特定知识通过 MarkdownDetailOptions
 * 参数注入，各适配器传入自己的配置，避免解析器绑定单一源。
 */
import type { Attachment, Requirement, RequirementDetail, RelatedIssue } from './types.js';
/**
 * 从 MCP 工具调用结果中提取纯文本内容
 * @description MCP 工具返回的内容格式为数组，每个元素为 { type: 'text', text: '...' }。
 */
export declare function extractContentText(content: unknown): string | null;
/**
 * 从 MCP 工具调用结果中提取 JSON 数据
 * @description 先提取纯文本，尝试解析内嵌 JSON；未命中则返回原始文本，
 *   交由适配器走 Markdown 解析。
 */
export declare function extractContentJson(content: unknown): unknown;
/**
 * 将 JSON 数组的单个条目映射为需求摘要（兼容驼峰/下划线命名）
 */
export declare function mapJsonToRequirement(item: Record<string, unknown>): Requirement;
/**
 * 将 JSON 对象映射为需求详情基础字段（不含 description 等详情字段，
 * 供适配器组合使用；兼容驼峰/下划线命名）
 */
export declare function mapJsonToDetailBase(data: Record<string, unknown>): RequirementDetail;
/**
 * 解析 Markdown 格式的需求列表
 * @description 逐行扫描，匹配 "### [STATUS] ID: #NUMBER Title" 结构
 */
export declare function parseMarkdownRequirementList(text: string): Requirement[];
/** Markdown 详情解析的源特定配置 */
export interface MarkdownDetailOptions {
    /**
     * 需求描述章节的候选名称（按优先级排列）
     * @description 源特定的章节名（如 ONES 的 "Requirement Documents"）在此注入
     */
    sectionOrder: string[];
    /** 判断章节是否为"文档类"（内容可含二级子标题，仅在遇到尾部结构章节时停止） */
    isDocSection(sectionName: string): boolean;
    /** 描述开头需要剥离的提示行（如安全声明），无需时传 undefined */
    stripNotice?(description: string): string;
    /** 尾部结构章节（文档类描述在此停止收集），默认 'Attachments' */
    stopSection?: RegExp;
}
/**
 * 解析 Markdown 格式的需求详情（通用骨架 + 源特定配置）
 * @description 元数据字段（ID/Status/Priority/Assignee）、验收标准、附件、
 *   关联任务的结构解析是通用的；描述章节候选与提示行剥离由 options 注入。
 */
export declare function parseMarkdownRequirementDetail(text: string, options: MarkdownDetailOptions): RequirementDetail;
/** 将未知类型安全转换为字符串数组 */
export declare function parseStringArray(raw: unknown): string[];
/** 将未知类型安全转换为附件数组 */
export declare function parseAttachments(raw: unknown): Attachment[];
/** 将未知类型安全转换为关联问题数组 */
export declare function parseRelatedIssues(raw: unknown): RelatedIssue[];
//# sourceMappingURL=parsers.d.ts.map