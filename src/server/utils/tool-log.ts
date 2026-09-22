/**
 * @module tool-log
 * @description Bridge 工具调用日志的摘要化处理（纯函数，无副作用）。
 *
 * 把 bridge onOutput(data, meta) 转换成应记录的日志行：
 * - thinking / tool_use / tool_result → 结构化 JSON 行（与 agent-coordinator 同格式），
 *   前端共享解析器（utils/agent-log-parse.ts）渲染为 Think 折叠行 / 分类工具行
 *   （对齐 DeepSeek Harness 的消息流设计）
 * - 普通文本：原样
 *
 * 结构化行做长度截断，避免文件全文 / 长思考刷爆日志。
 * 调用方（plan / execution 路由）负责写入日志存储与广播，本模块只决定"记什么"。
 */

/** 单行截断上限（字符） */
const MAX_LINE = 2000;

/** 截断超长文本并追加省略号 */
function truncate(text: string): string {
    return text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)}…` : text;
}

/** processToolOutput 的返回：silent=true 表示该条不应记录 */
export interface ProcessedLog {
    silent: boolean;
    text: string;
}

/**
 * 把一次 bridge onOutput(data, meta) 转换成应记录的日志行。
 *
 * @param data - bridge 透传的文本（output/thinking 为正文，tool_use 为空串，tool_result 为工具结果全文）
 * @param meta - 事件元信息（type: 'tool_use' | 'tool_result' | 'thinking' | ...）
 * @returns {silent, text}：silent=true 时调用方应跳过该条，否则记录 text
 */
export function processToolOutput(data: string, meta?: Record<string, unknown>): ProcessedLog {
    if (meta?.type === 'tool_use') {
        const toolInput = meta.toolInput as Record<string, unknown> | undefined;
        return {
            silent: false,
            text: JSON.stringify({
                type: 'tool_use',
                toolName: (meta.toolName as string) || 'Tool',
                toolUseId: meta.toolUseId,
                toolInput: toolInput ? truncate(JSON.stringify(toolInput)) : undefined,
            }),
        };
    }
    if (meta?.type === 'tool_result') {
        return {
            silent: false,
            text: JSON.stringify({
                type: 'tool_result',
                toolUseId: meta.toolUseId,
                isError: !!meta.isError,
                content: data ? truncate(data) : '',
            }),
        };
    }
    if (meta?.type === 'thinking') {
        return {silent: false, text: JSON.stringify({type: 'thinking', content: truncate(data)})};
    }
    return {silent: false, text: data};
}
