/**
 * @module structured-json
 * @description 从 LLM 自由文本输出中稳健提取 JSON（纯函数，无副作用）。
 *
 * 替代旧的贪婪正则（如 /\[[\s\S]*\]/）：对「叙述文字 + JSON + 后续解释」的输出鲁棒，
 * 配平括号避免吞掉上下文。优先级：
 *   1. ```json fenced block
 *   2. 首个 { / [ 起，括号配平截取（跳过字符串内的括号）
 *   3. 全部失败 → undefined
 */

function parseBalanced(raw: string): unknown | undefined {
    const start = raw.search(/[\[{]/);
    if (start < 0) return undefined;

    const openChar = raw[start];
    const closeChar = openChar === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < raw.length; i++) {
        const ch = raw[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) {
                const candidate = raw.slice(start, i + 1);
                try {
                    return JSON.parse(candidate);
                } catch {
                    return undefined;
                }
            }
        }
    }
    return undefined;
}

/**
 * 从文本中提取任意 JSON 值（对象 / 数组 / 标量）。
 * 优先 ```json fenced block，再尝试括号配平扫描。
 * @returns 解析出的值；全部失败返回 undefined
 */
export function extractJsonValue(raw: string): unknown | undefined {
    if (typeof raw !== 'string' || !raw) return undefined;

    // 1. fenced block：```json ... ```
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
        try {
            return JSON.parse(fence[1].trim());
        } catch {
            // 落到括号扫描
        }
    }

    // 2. 括号配平扫描（首个 { 或 [）
    return parseBalanced(raw);
}

/** 提取 JSON 对象；不是对象返回 undefined */
export function extractJsonObject(raw: string): Record<string, unknown> | undefined {
    const value = extractJsonValue(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** 提取 JSON 数组；不是数组返回 undefined */
export function extractJsonArray(raw: string): unknown[] | undefined {
    const value = extractJsonValue(raw);
    return Array.isArray(value) ? (value as unknown[]) : undefined;
}

/**
 * 解析 markdown front-matter（`---\nkey: value\n---` 开头）。
 * @returns key → value 映射；无 front-matter 返回空对象
 */
export function parseFrontMatter(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (typeof content !== 'string') return result;

    const match = content.match(/^﻿?---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    if (!match) return result;

    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key) result[key] = value;
    }
    return result;
}
