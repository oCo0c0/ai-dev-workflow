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
/**
 * 从文本中提取任意 JSON 值（对象 / 数组 / 标量）。
 * 优先 ```json fenced block，再尝试括号配平扫描。
 * @returns 解析出的值；全部失败返回 undefined
 */
export declare function extractJsonValue(raw: string): unknown | undefined;
/** 提取 JSON 对象；不是对象返回 undefined */
export declare function extractJsonObject(raw: string): Record<string, unknown> | undefined;
/** 提取 JSON 数组；不是数组返回 undefined */
export declare function extractJsonArray(raw: string): unknown[] | undefined;
/**
 * 解析 markdown front-matter（`---\nkey: value\n---` 开头）。
 * @returns key → value 映射；无 front-matter 返回空对象
 */
export declare function parseFrontMatter(content: string): Record<string, string>;
//# sourceMappingURL=structured-json.d.ts.map