/**
 * @module requirement-sources/parsers
 * @description 需求源共享解析器
 *
 * 从 MCP 工具返回内容（JSON / Markdown）解析为中立数据模型的通用实现。
 * Markdown 详情解析的章节顺序等源特定知识通过 MarkdownDetailOptions
 * 参数注入，各适配器传入自己的配置，避免解析器绑定单一源。
 */

import {extractJsonValue} from '../../utils/structured-json.js';
import type {Attachment, Requirement, RequirementDetail, RelatedIssue} from './types.js';

// === MCP content 提取 ===

/**
 * 从 MCP 工具调用结果中提取纯文本内容
 * @description MCP 工具返回的内容格式为数组，每个元素为 { type: 'text', text: '...' }。
 */
export function extractContentText(content: unknown): string | null {
    if (!content || !Array.isArray(content) || content.length === 0) {
        return null;
    }
    const textItem = content.find(
        (item: Record<string, unknown>) => item.type === 'text' && typeof item.text === 'string'
    );
    return textItem ? (textItem as { text: string }).text : null;
}

/**
 * 从 MCP 工具调用结果中提取 JSON 数据
 * @description 先提取纯文本，尝试解析内嵌 JSON；未命中则返回原始文本，
 *   交由适配器走 Markdown 解析。
 */
export function extractContentJson(content: unknown): unknown {
    const text = extractContentText(content);
    if (!text) return null;
    const json = extractJsonValue(text);
    if (json !== undefined) return json;
    return text;
}

// === JSON 映射 ===

/**
 * 将 JSON 数组的单个条目映射为需求摘要（兼容驼峰/下划线命名）
 */
export function mapJsonToRequirement(item: Record<string, unknown>): Requirement {
    return {
        id: String(item.id ?? item.number ?? ''),
        title: String(item.title ?? ''),
        status: String(item.status ?? item.state ?? 'unknown'),
        priority: String(item.priority ?? 'medium'),
        assignee: String(item.assignee ?? ''),
        updatedAt: String(item.updatedAt ?? item.updated_at ?? new Date().toISOString()),
    };
}

/**
 * 将 JSON 对象映射为需求详情基础字段（不含 description 等详情字段，
 * 供适配器组合使用；兼容驼峰/下划线命名）
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

// === Markdown 列表解析（通用结构） ===

/**
 * 解析 Markdown 格式的需求列表
 * @description 逐行扫描，匹配 "### [STATUS] ID: #NUMBER Title" 结构
 */
export function parseMarkdownRequirementList(text: string): Requirement[] {
    const results: Requirement[] = [];
    const lines = text.split('\n');

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const match = line.match(/^###\s+\[([^\]]+)\]\s+(\S+):\s+(.+)$/);
        if (!match) continue;

        const [, status, id, titlePart] = match;
        const numberMatch = titlePart.match(/^#(\d+)/);
        const titleMatch = titlePart.match(/^#\d+\s+(.+)$/) ?? titlePart.match(/^(.+)$/);
        const title = titleMatch ? titleMatch[1].trim() : titlePart.trim();

        let priority = 'medium';
        let assignee = '';
        for (let i = lineIdx + 1; i < Math.min(lineIdx + 6, lines.length); i++) {
            const meta = lines[i];
            const p = meta.match(/Priority:\s*(\w+)/i);
            if (p) priority = p[1].toLowerCase();
            const a = meta.match(/Assignee:\s*(.+)/i);
            if (a) assignee = a[1].trim();
            if (lines[i].startsWith('###')) break;
        }

        results.push({
            id,
            number: numberMatch ? `#${numberMatch[1]}` : undefined,
            title,
            status: status.toLowerCase(),
            priority,
            assignee,
            updatedAt: new Date().toISOString(),
        });
    }

    return results;
}

// === Markdown 详情解析（参数化） ===

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
export function parseMarkdownRequirementDetail(text: string, options: MarkdownDetailOptions): RequirementDetail {
    const lines = text.split('\n');
    const stopSection = options.stopSection ?? /^##\s+Attachments/i;

    let id = '';
    let title = '';
    let number: string | undefined;
    let status = 'unknown';
    let priority = 'medium';
    let assignee = '';
    const acceptanceCriteria: string[] = [];

    // 从第一个一级标题中解析需求标题和编号
    const titleLine = lines.find(l => l.startsWith('# '));
    if (titleLine) {
        const numberMatch = titleLine.match(/^#\s+#(\d+)/);
        if (numberMatch) number = `#${numberMatch[1]}`;
        const cleaned = titleLine.replace(/^#\s+/, '').replace(/^#\d+\s+/, '').trim();
        title = cleaned;
    }

    // 从无序列表项 (- **Key**: Value) 中解析元数据字段
    for (const line of lines) {
        const idMatch = line.match(/\*\*(?:ID|UUID)\*\*:\s*(\S+)/);
        if (idMatch) id = idMatch[1];

        const statusMatch = line.match(/\*\*Status\*\*:\s*(.+)/i);
        if (statusMatch) status = statusMatch[1].trim();

        const priorityMatch = line.match(/\*\*Priority\*\*:\s*(.+)/i);
        if (priorityMatch) priority = priorityMatch[1].trim().toLowerCase();

        const assigneeMatch = line.match(/\*\*Assignee\*\*:\s*(.+)/i);
        if (assigneeMatch) assignee = assigneeMatch[1].trim();
    }

    // 按优先级顺序尝试查找需求描述章节
    let description = '';
    for (const sectionName of options.sectionOrder) {
        const pattern = new RegExp(`^##\\s+${sectionName}`, 'i');
        const idx = lines.findIndex(l => pattern.test(l));
        if (idx < 0) continue;

        const descLines: string[] = [];
        const isDoc = options.isDocSection(sectionName);
        for (let i = idx + 1; i < lines.length; i++) {
            if (isDoc) {
                // 文档章节：仅在遇到尾部结构章节时停止
                if (stopSection.test(lines[i])) break;
            } else {
                // 元数据章节：遇到同级 ## 标题时停止
                if (lines[i].startsWith('## ')) break;
            }
            descLines.push(lines[i]);
        }
        const candidate = descLines.join('\n').trim();
        if (!candidate) continue;
        // 内容看起来像元数据时继续查找更好的章节
        const looksLikeMetadata = candidate.includes('**Type**:') || candidate.includes('**UUID**:');
        if (!looksLikeMetadata || sectionName === options.sectionOrder[options.sectionOrder.length - 1]) {
            description = candidate;
            break;
        }
    }

    // 兜底策略：取最后一个 --- 分隔符之后的所有内容作为描述
    if (!description) {
        const lastSepIdx = lines.lastIndexOf('---');
        if (lastSepIdx >= 0) {
            description = lines.slice(lastSepIdx + 1).join('\n').trim();
        }
    }

    if (options.stripNotice) {
        description = options.stripNotice(description);
    }

    // 解析验收标准章节（通用中英文标题）
    const acIdx = lines.findIndex(l => /^##\s+(Acceptance Criteria|验收标准)/i.test(l));
    if (acIdx >= 0) {
        for (let i = acIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) break;
            const acMatch = lines[i].match(/^[-*]\s+(.+)/);
            if (acMatch) acceptanceCriteria.push(acMatch[1].trim());
        }
    }

    // 解析附件章节：- [filename](url) (type, size) 与省略 URL 两种格式
    const parsedAttachments: Attachment[] = [];
    const attIdx = lines.findIndex(l => stopSection.test(l));
    if (attIdx >= 0) {
        for (let i = attIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) break;
            const attMatch = lines[i].match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:\(([^)]+)\))?/);
            if (attMatch) {
                parsedAttachments.push({
                    name: attMatch[1],
                    url: attMatch[2],
                    type: attMatch[3]?.split(',')[0]?.trim() || 'file',
                });
                continue;
            }
            // 兼容 URL 省略格式：- name (mimeType, size bytes; URL omitted)
            const attNoUrlMatch = lines[i].match(/^[-*]\s+([^(]+?)\s*\(([^)]+)\)\s*$/);
            if (attNoUrlMatch) {
                parsedAttachments.push({
                    name: attNoUrlMatch[1].trim(),
                    url: '',
                    type: attNoUrlMatch[2].split(',')[0]?.trim() || 'file',
                });
            }
        }
    }

    // 解析关联任务章节：- #id title [type] (status) — assignee
    const parsedRelated: RelatedIssue[] = [];
    const relIdx = lines.findIndex(l => /^##\s+Related Tasks/i.test(l));
    if (relIdx >= 0) {
        for (let i = relIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) break;
            const relMatch = lines[i].match(/^[-*]\s+#?(\d+)\s+(.+?)\s+\[([^\]]+)\]\s+\(([^)]+)\)/);
            if (relMatch) {
                parsedRelated.push({
                    id: relMatch[1],
                    title: relMatch[2].trim(),
                    status: relMatch[4].trim(),
                });
            }
        }
    }

    return {
        id,
        number,
        title,
        status,
        priority,
        assignee,
        updatedAt: new Date().toISOString(),
        description,
        acceptanceCriteria,
        attachments: parsedAttachments,
        relatedIssues: parsedRelated,
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
