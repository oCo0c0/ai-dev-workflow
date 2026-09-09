/**
 * @module requirement-sources/parsers
 * @description agent JSON 契约 → 中立数据模型的共享映射器
 *
 * agent 中介拉取的输出是统一 JSON 契约（见 agent-fetch.ts 的 prompt），
 * 这里做兼容驼峰/下划线的宽松映射；无任何源特定分支。
 */
// === JSON 映射 ===
/**
 * 将 JSON 数组的单个条目映射为需求摘要（兼容驼峰/下划线命名）
 */
export function mapJsonToRequirement(item) {
    return {
        id: String(item.id ?? item.number ?? ''),
        number: item.number !== undefined && item.number !== null && String(item.number) !== '' ? String(item.number) : undefined,
        title: String(item.title ?? ''),
        status: String(item.status ?? item.state ?? 'unknown'),
        priority: String(item.priority ?? 'medium'),
        assignee: String(item.assignee ?? ''),
        updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
    };
}
/**
 * 将 JSON 对象映射为需求详情（agent JSON 契约字段；兼容驼峰/下划线命名）
 */
export function mapJsonToDetailBase(data) {
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
export function parseStringArray(raw) {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item) => String(item));
}
/** 将未知类型安全转换为附件数组 */
export function parseAttachments(raw) {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item) => ({
        name: String(item.name ?? ''),
        url: String(item.url ?? ''),
        type: String(item.type ?? 'file'),
    }));
}
/** 将未知类型安全转换为关联问题数组 */
export function parseRelatedIssues(raw) {
    if (!raw || !Array.isArray(raw)) {
        return [];
    }
    return raw.map((item) => ({
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        status: String(item.status ?? 'unknown'),
    }));
}
//# sourceMappingURL=parsers.js.map