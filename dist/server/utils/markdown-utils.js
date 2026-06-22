"use strict";
/**
 * @module markdown-utils
 * @description Markdown 文本提取公共工具
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDescription = extractDescription;
exports.inferServerType = inferServerType;
/**
 * 从 Markdown 内容提取描述。
 * 规则：跳过空行和 front matter（---），首行非标题内容直接用；
 * 首行是标题则取标题文本。超 100 字符截断加省略号。
 */
function extractDescription(content) {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('---'))
            continue;
        if (trimmed.startsWith('#')) {
            const headerText = trimmed.replace(/^#+\s*/, '');
            return headerText.length > 100 ? headerText.substring(0, 100) + '...' : headerText;
        }
        return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
    }
    return '';
}
/**
 * 根据命令推断 MCP 服务器类型。
 */
function inferServerType(command) {
    if (!command)
        return 'custom';
    if (command.includes('node') || command.includes('npx'))
        return 'node';
    if (command.includes('python') || command.includes('uvx'))
        return 'python';
    if (command.includes('docker'))
        return 'docker';
    return 'custom';
}
//# sourceMappingURL=markdown-utils.js.map