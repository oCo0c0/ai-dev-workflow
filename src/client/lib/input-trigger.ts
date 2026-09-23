/**
 * @file input-trigger.ts
 * @description 输入框触发器（纯函数核心）—— 对齐 DeepSeek Harness 的 ui-input-trigger/core。
 *
 * 职责：
 * - `detectSlashTrigger`：从光标向左回溯，判断当前是否处于 `/` 触发词内（含词边界与 URL 豁免）
 * - `parseSlashCommand`：整行是否是 `/name args`（命令判定，参数为整行剩余原文）
 * - `applySlashPick`：菜单选中后写回草稿（把触发区间替换为 `/name `，尾空格由本层补）
 * - `filterCandidates`：按当前查询过滤候选（前缀优先）
 *
 * 设计对齐点（DSH）：
 * - 触发词不跨空白：回溯遇到空白即结束
 * - `/` 的词边界：行首、空白后、标点后；`//` 与 `scheme:/`（如 https:/）两种 URL 场景视为普通字符
 * - 选中后写回**字面文本** `/name `，确定性留在服务端（同名命令优先于同名技能）
 */

/** 触发命中：query 为「触发符到光标」的内容，start/end 为该词在草稿中的区间 */
export interface SlashTriggerHit {
    query: string;
    start: number;
    end: number;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

/** `/` 的词边界判定（行首 / 空白后 / 标点后；URL 两处豁免） */
function boundaryOk(draft: string, index: number): boolean {
    if (index === 0) return true;
    const prev = draft.charAt(index - 1);
    if (WHITESPACE.test(prev)) return true;
    if (WORD_CHAR.test(prev)) return false;
    // 第二个斜杠（//）与协议分隔符（https:/）内的斜杠不触发
    if (prev === '/') return false;
    if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
    return true;
}

/**
 * 检测光标处的 `/` 触发词。
 * @param draft - 草稿全文
 * @param caret - 光标位置（0..draft.length）
 * @returns 命中信息；未处于触发词内返回 null
 */
export function detectSlashTrigger(draft: string, caret: number): SlashTriggerHit | null {
    for (let i = caret - 1; i >= 0; i--) {
        const ch = draft.charAt(i);
        if (WHITESPACE.test(ch)) return null; // 触发词不跨空白
        if (ch !== '/') continue;
        if (!boundaryOk(draft, i)) continue;
        return {query: draft.slice(i + 1, caret), start: i, end: caret};
    }
    return null;
}

/** 菜单选中后写回草稿：替换触发区间为 `/name `（尾空格在此补，保证手打与选中结果一致） */
export function applySlashPick(draft: string, hit: SlashTriggerHit, name: string): {draft: string; caret: number} {
    const inserted = `/${name} `;
    return {
        draft: draft.slice(0, hit.start) + inserted + draft.slice(hit.end),
        caret: hit.start + inserted.length,
    };
}

/** 整行命令解析结果 */
export interface ParsedSlashCommand {
    name: string;
    /** 名称之后的整行剩余原文（含前导空白，由调用方 trim） */
    args: string;
}

/**
 * 判定整行是否为 `/name args`（DSH 同款正则语义：名称小写字母开头，
 * 后跟到行尾；名称与参数之间需为空白或行尾）。
 */
export function parseSlashCommand(line: string): ParsedSlashCommand | null {
    const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])([\s\S]*)$/.exec(line.trim());
    if (!match) return null;
    return {name: match[1], args: match[2].trim()};
}

/** 候选项的最小形状（命令与技能共用） */
export interface TriggerCandidateLike {
    name: string;
    description?: string;
}

/**
 * 按查询过滤候选：前缀匹配优先，其次包含匹配；大小写不敏感。
 */
export function filterCandidates<T extends TriggerCandidateLike>(items: T[], query: string): T[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const prefix: T[] = [];
    const contains: T[] = [];
    for (const item of items) {
        const name = item.name.toLowerCase();
        if (name.startsWith(q)) prefix.push(item);
        else if (name.includes(q) || (item.description ?? '').toLowerCase().includes(q)) contains.push(item);
    }
    return [...prefix, ...contains];
}
