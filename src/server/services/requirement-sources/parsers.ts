/**
 * @module requirement-sources/parsers
 * @description 需求文档共享解析器（源中立）
 *
 * 将 agent 返回的 JSON 契约对象映射为中立数据模型；兼容驼峰/下划线命名
 * 与字段别名。需求拉取由 agent 中介（requirement-agent-fetch.ts）完成，
 * 本模块只做结构化映射，不含任何源特定知识。
 */

import type {Attachment, Requirement, RequirementDetail, RelatedIssue} from './types.js';

// === JSON 映射 ===

/**
 * 将 JSON 数组的单个条目映射为需求摘要（兼容驼峰/下划线命名）
 */
export function mapJsonToRequirement(item: Record<string, unknown>): Requirement {
    return {
        id: String(item.id ?? item.number ?? ''),
        number: item.number ? String(item.number) : undefined,
        title: String(item.title ?? ''),
        status: String(item.status ?? item.state ?? 'unknown'),
        priority: String(item.priority ?? 'medium'),
        assignee: String(item.assignee ?? ''),
        updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
    };
}

/**
 * 将 JSON 对象映射为需求详情基础字段（兼容驼峰/下划线命名与 body 别名）
 */
export function mapJsonToDetailBase(data: Record<string, unknown>): RequirementDetail {
    return {
        id: String(data.id ?? data.number ?? ''),
        number: data.number ? String(data.number) : undefined,
        title: String(data.title ?? ''),
        status: String(data.status ?? data.state ?? 'unknown'),
        priority: String(data.priority ?? 'medium'),
        assignee: String(data.assignee ?? ''),
        updatedAt: String(data.updatedAt ?? data.updated_at ?? new Date().toISOString()),
        description: String(data.description ?? data.body ?? ''),
        acceptanceCriteria: parseStringArray(data.acceptanceCriteria ?? data.acceptance_criteria),
        attachments: parseAttachments(data.attachments),
        relatedIssues: parseRelatedIssues(data.relatedIssues ?? data.related_issues),
    };
}

// === 类型安全转换 ===

/** 将未知类型安全转换为字符串数组 */
export function parseStringArray(raw: unknown): string[] {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item) => String(item));
}

/** 将未知类型安全转换为附件数组 */
export function parseAttachments(raw: unknown): Attachment[] {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item: Record<string, unknown>) => ({
        name: String(item.name ?? ''),
        url: String(item.url ?? ''),
        type: String(item.type ?? 'file'),
    }));
}

/** 将未知类型安全转换为关联问题数组 */
export function parseRelatedIssues(raw: unknown): RelatedIssue[] {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        status: String(item.status ?? 'unknown'),
    }));
}
