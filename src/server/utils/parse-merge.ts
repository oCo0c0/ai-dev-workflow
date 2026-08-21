/**
 * @file 解析结果合并工具（与 dsh-adw 插件同语义）
 * @description 把 MinerU 解析出的附件内容幂等合并进需求文档：
 *   - 已有该附件的标记块 → 原位替换（重解析更新不重复）
 *   - 文档中有该附件引用（图片/链接/[Image: x]）→ 引用行后插入（图文相邻）
 *   - 都没有 → 文末「附件解析」小节追加
 *
 * 标记块为 HTML 注释形态，渲染与 agent 侧均不可见。
 */

/** 一份附件的解析结果（与 requirement-store-service 的 ParsedAttachment 同构） */
export interface ParseMergeRecord {
    markdown: string;
    backend: string;
    parsedAt: string;
}

/** 合并标记：按附件名成对出现 */
export function parseMarker(name: string): {open: string; close: string} {
    return {open: `<!--adw-parse:${name}-->`, close: `<!--/adw-parse:${name}-->`};
}

/** 构造一份解析结果的合并块 */
function buildBlock(name: string, record: ParseMergeRecord): string {
    const {open, close} = parseMarker(name);
    return `${open}\n**【${name} 解析结果】**（${record.backend} · ${record.parsedAt.slice(0, 16).replace('T', ' ')}）\n\n${record.markdown.trim()}\n${close}`;
}

/** 在文档中定位附件引用的行号（图片/链接/[Image: x] 三种形态，按名称与 URL 匹配） */
function findReferenceLine(desc: string, name: string): number {
    const stem = name.replace(/\.[^.]+$/, '');
    const lines = desc.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const refMatch = line.match(/!?\[([^\]]*)\]\(([^)]*)\)/g) ?? [];
        for (const ref of refMatch) {
            const m = ref.match(/!?\[([^\]]*)\]\(([^)]*)\)/);
            if (m === null) continue;
            const [, alt, url] = m;
            if (url.includes(name) || url.includes(encodeURIComponent(name)) || alt === name || alt === stem) return i;
        }
        if (new RegExp(`^\\[Image:\\s*${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'i').test(line.trim())) return i;
    }
    return -1;
}

/** 把解析结果合并进文档（幂等） */
export function mergeParsedIntoDescription(
    description: string,
    parsed: Record<string, ParseMergeRecord>,
): string {
    let desc = description;
    const appended: string[] = [];
    for (const [name, record] of Object.entries(parsed)) {
        if (record.markdown.trim() === '') continue;
        const block = buildBlock(name, record);
        const {open, close} = parseMarker(name);
        const openIdx = desc.indexOf(open);
        if (openIdx >= 0) {
            const closeIdx = desc.indexOf(close, openIdx);
            if (closeIdx >= 0) {
                desc = desc.slice(0, openIdx) + block + desc.slice(closeIdx + close.length);
                continue;
            }
        }
        const line = findReferenceLine(desc, name);
        if (line >= 0) {
            const lines = desc.split('\n');
            lines.splice(line + 1, 0, '', block);
            desc = lines.join('\n');
        } else {
            appended.push(block);
        }
    }
    if (appended.length > 0) {
        const heading = desc.includes('### 附件解析') ? '' : '\n\n### 附件解析\n';
        desc = `${desc.replace(/\s+$/, '')}${heading}${appended.join('\n\n')}\n`;
    }
    return desc;
}
