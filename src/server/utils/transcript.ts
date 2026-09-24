/**
 * @module transcript
 * @description 执行日志 → 纯文本会话（跨会话/跨引擎延续上下文的材料）。
 *
 * 为什么需要它：会话实体由各引擎自己托管（claude 的项目目录、pi 的会话文件、
 * codex 的 thread），换个引擎就无法直接续接。此时用应用自己保存的对话日志
 * 生成摘要交给新引擎，能让工作上下文延续下去，而不是「从头再来」。
 */

/** 默认保留的最大字符数（超出只保留最近的片段） */
export const DEFAULT_TRANSCRIPT_CHARS = 40_000;

/**
 * 执行日志 → 纯文本会话。
 * 输出/助手文本保留，thinking 与工具结果正文剔除（体积大且非结论），
 * 只保留工具调用名；最后按上限截取最近的片段。
 *
 * @param logs - 执行日志行（结构化 JSON 行或纯文本）
 * @param maxChars - 保留的最大字符数（默认 40k，/compact 的摘要材料用；注入 prompt 时宜更小）
 */
export function buildTranscript(logs: string[], maxChars: number = DEFAULT_TRANSCRIPT_CHARS): string {
    const lines: string[] = [];
    for (const log of logs) {
        let text = log;
        try {
            const parsed = JSON.parse(log) as {type?: string; content?: string; toolName?: string};
            switch (parsed.type) {
                case 'user':
                    text = `用户：${parsed.content ?? ''}`;
                    break;
                case 'tool_use':
                    text = `（工具调用：${parsed.toolName ?? 'Tool'}）`;
                    break;
                case 'tool_result':
                case 'thinking':
                    text = '';
                    break;
                case 'output':
                case 'info':
                case 'system':
                    text = `助手：${parsed.content ?? ''}`;
                    break;
                default:
                    text = typeof parsed.content === 'string' ? `助手：${parsed.content}` : '';
            }
        } catch {
            text = `助手：${log}`;
        }
        if (text.trim()) lines.push(text.trim());
    }
    const joined = lines.join('\n\n');
    return joined.length > maxChars
        ? `…（更早内容已省略）\n\n${joined.slice(-maxChars)}`
        : joined;
}
