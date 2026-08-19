/**
 * @module requirement-sources/generic-adapter
 * @description 通用需求源适配器（兜底）
 *
 * 未被任何专用适配器认领的 MCP server 使用本适配器：
 * - 宽松的工具命名约定（get_xxx / search_xxx 变体）
 * - JSON 优先、Markdown 中性章节表兜底的解析
 * - 不提供附件认证下载
 */
import { extractContentJson, mapJsonToDetailBase, mapJsonToRequirement, parseMarkdownRequirementDetail, parseMarkdownRequirementList, } from './parsers.js';
/** 通用工具能力 → 工具名匹配模式（宽松命名约定） */
const CAPABILITY_PATTERNS = {
    fetchDetail: [
        /^(get|fetch|read)_(?:issue|item|ticket|requirement|work_item|workitem|detail)s?(?:_by_id)?$/,
    ],
    search: [
        /^search_(?:issues?|items?|tickets?|requirements?|work_items)$/,
    ],
};
/** 候选工具名（兜底） */
const FALLBACK_TOOL_NAMES = {
    fetchDetail: ['get_issue', 'get_work_item', 'get_requirement'],
    search: ['search_issues', 'search_requirements'],
};
/**
 * 通用需求源适配器
 * @description 永不主动认领 server（matchServer 恒 false），仅作解析兜底。
 *   输入规整为中性规则：链接透传、#number 去前缀、其余原样。
 */
export class GenericAdapter {
    id = 'generic';
    label = '通用（自动匹配）';
    /** generic 不出现在源目录中（内部兜底，不主动推荐给用户） */
    description = '';
    capabilityPatterns = CAPABILITY_PATTERNS;
    fallbackToolNames = FALLBACK_TOOL_NAMES;
    /** 永不认领：仅作兜底 */
    matchServer() {
        return false;
    }
    normalizeInput(raw) {
        const s = raw.trim();
        if (/^https?:\/\//i.test(s))
            return s;
        return s.replace(/^#/, '');
    }
    extractPlainNumber(normalized) {
        return normalized.match(/^(\d+)$/)?.[1];
    }
    buildDetailArgs(normalizedInput) {
        return { id: normalizedInput };
    }
    buildSearchArgs(query) {
        return { query };
    }
    parseDetail(content) {
        const raw = extractContentJson(content);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return mapJsonToDetailBase(raw);
        }
        if (typeof raw === 'string') {
            // 中性章节表：常见描述章节名，无源特定知识
            return parseMarkdownRequirementDetail(raw, {
                sectionOrder: ['Description', 'Detail', 'Content', '详情', '描述'],
                isDocSection: (name) => /Description|Detail|详情|描述/i.test(name),
            });
        }
        throw new Error('Invalid requirement detail response');
    }
    parseList(content) {
        const raw = extractContentJson(content);
        if (Array.isArray(raw)) {
            return raw.map((item) => mapJsonToRequirement(item));
        }
        if (typeof raw === 'string') {
            return parseMarkdownRequirementList(raw);
        }
        return [];
    }
    /** 通用源无附件认证知识 */
    createImageService() {
        return undefined;
    }
}
//# sourceMappingURL=generic-adapter.js.map