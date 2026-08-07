/**
 * @module markdown-utils
 * @description Markdown 文本提取公共工具
 */

/**
 * 从 Markdown 内容提取描述。
 * 规则：
 *   1. 如果存在 YAML frontmatter（--- 包裹），优先读取 `description:` 字段；
 *   2. 无 frontmatter 或字段缺失时，跳过空行，首行非标题内容直接用；
 *   3. 首行是标题则取标题文本。超 100 字符截断加省略号。
 */
export function extractDescription(content: string): string {
    const lines = content.split('\n');
    let inFrontmatter = false;
    let frontmatterSeen = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // YAML frontmatter 定界符
        if (trimmed === '---') {
            if (!frontmatterSeen) {
                frontmatterSeen = true;
                inFrontmatter = true;
                continue;
            } else if (inFrontmatter) {
                inFrontmatter = false;
                continue;
            }
        }

        // 在 frontmatter 内部：查找 description 字段
        if (inFrontmatter) {
            const descMatch = trimmed.match(/^description:\s*(.+)$/);
            if (descMatch) {
                const desc = descMatch[1].trim().replace(/^["']|["']$/g, '');
                return desc.length > 100 ? desc.substring(0, 100) + '...' : desc;
            }
            continue;
        }

        // frontmatter 外部：原有逻辑
        if (!trimmed) continue;
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
export function inferServerType(command?: string): string {
    if (!command) return 'custom';
    if (command.includes('node') || command.includes('npx')) return 'node';
    if (command.includes('python') || command.includes('uvx')) return 'python';
    if (command.includes('docker')) return 'docker';
    return 'custom';
}
