/**
 * @module requirement-sources/generic-adapter
 * @description 通用需求源适配器（兜底）
 *
 * 未被任何专用适配器认领的 MCP server 使用本适配器：
 * - 宽松的工具命名约定（get_xxx / search_xxx 变体）
 * - JSON 优先、Markdown 中性章节表兜底的解析
 * - 不提供附件认证下载
 */
import type { RequirementSourceAdapter, RequirementDetail, Requirement, ToolCapability } from './types.js';
/**
 * 通用需求源适配器
 * @description 永不主动认领 server（matchServer 恒 false），仅作解析兜底。
 *   输入规整为中性规则：链接透传、#number 去前缀、其余原样。
 */
export declare class GenericAdapter implements RequirementSourceAdapter {
    readonly id = "generic";
    readonly label = "\u901A\u7528\uFF08\u81EA\u52A8\u5339\u914D\uFF09";
    /** generic 不出现在源目录中（内部兜底，不主动推荐给用户） */
    readonly description = "";
    readonly capabilityPatterns: Record<ToolCapability, RegExp[]>;
    readonly fallbackToolNames: Record<ToolCapability, string[]>;
    /** 永不认领：仅作兜底 */
    matchServer(): boolean;
    normalizeInput(raw: string): string;
    extractPlainNumber(normalized: string): string | undefined;
    buildDetailArgs(normalizedInput: string): Record<string, unknown>;
    buildSearchArgs(query: string): Record<string, unknown>;
    parseDetail(content: unknown): RequirementDetail;
    parseList(content: unknown): Requirement[];
    /** 通用源无附件认证知识 */
    createImageService(): undefined;
}
//# sourceMappingURL=generic-adapter.d.ts.map