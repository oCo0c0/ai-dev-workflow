/**
 * @module markdown-utils
 * @description Markdown 文本提取公共工具
 */
/**
 * 从 Markdown 内容提取描述。
 * 规则：跳过空行和 front matter（---），首行非标题内容直接用；
 * 首行是标题则取标题文本。超 100 字符截断加省略号。
 */
export declare function extractDescription(content: string): string;
/**
 * 根据命令推断 MCP 服务器类型。
 */
export declare function inferServerType(command?: string): string;
//# sourceMappingURL=markdown-utils.d.ts.map