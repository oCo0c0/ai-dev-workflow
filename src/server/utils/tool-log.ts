/**
 * @module tool-log
 * @description Bridge 工具调用日志的摘要化处理（纯函数，无副作用）。
 *
 * Claude Agent SDK 的 tool_result（如 Read）会把整个文件全文作为输出，直接灌入日志会刷屏。
 * 本模块把 bridge onOutput(data, meta) 转换成应记录的精简文本：
 * - tool_use：一行工具摘要（动作 + 目标文件/命令）
 * - tool_result（成功）：静默（文件全文不进日志）
 * - tool_result（失败）：一行截断错误提示
 * - 普通文本/思考：原样
 *
 * 调用方（plan / execution 路由）各自负责写入日志存储与广播，本模块只决定"记什么"。
 */

/** 常见工具的图标映射 */
export const TOOL_ICONS: Record<string, string> = {
    Read: '📖', Write: '📝', Edit: '✏️', MultiEdit: '✏️',
    Bash: '💻', Grep: '🔍', Glob: '🔎', Task: '🤖',
    TodoWrite: '📋', WebFetch: '🌐', WebSearch: '🌐',
};

/** 从路径取最后一段（如 UserService.java），非字符串返回空串 */
export function shortPath(p: unknown): string {
    if (typeof p !== 'string' || !p) return '';
    const parts = p.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p;
}

/**
 * 将一次工具调用（tool_use）摘要成一行人类可读日志。
 * 仅展示动作 + 目标文件/命令，避免把工具结果全文灌入日志。
 */
export function summarizeToolUse(meta: Record<string, unknown>): string {
    const toolName = String(meta.toolName ?? '');
    const input = (meta.toolInput as Record<string, unknown> | undefined) ?? {};
    const icon = TOOL_ICONS[toolName] ?? '🔧';
    switch (toolName) {
        case 'Read':
            return `${icon} 读取 ${shortPath(input.file_path)}`;
        case 'Write':
            return `${icon} 写入 ${shortPath(input.file_path)}`;
        case 'Edit':
        case 'MultiEdit':
            return `${icon} 编辑 ${shortPath(input.file_path)}`;
        case 'Bash':
            return `${icon} 执行: ${String(input.command ?? '').slice(0, 80)}`;
        case 'Grep':
            return `${icon} 搜索 "${String(input.pattern ?? '')}"`;
        case 'Glob':
            return `${icon} 匹配 ${String(input.pattern ?? '')}`;
        case 'Task':
            return `${icon} 子任务: ${String(input.description ?? '').slice(0, 80)}`;
        case 'TodoWrite':
            return `${icon} 更新待办清单`;
        case 'WebFetch':
        case 'WebSearch':
            return `${icon} ${toolName}: ${String(input.url ?? input.query ?? '').slice(0, 80)}`;
        default:
            return `${icon} ${toolName}`;
    }
}

/** processToolOutput 的返回：silent=true 表示该条不应记录 */
export interface ProcessedLog {
    silent: boolean;
    text: string;
}

/**
 * 把一次 bridge onOutput(data, meta) 转换成应记录的日志文本。
 *
 * @param data - bridge 透传的文本（output/thinking 为正文，tool_use 为空串，tool_result 为工具结果全文）
 * @param meta - 事件元信息（type: 'tool_use' | 'tool_result' | 'thinking' | ...）
 * @returns {silent, text}：silent=true 时调用方应跳过该条，否则记录 text
 */
export function processToolOutput(data: string, meta?: Record<string, unknown>): ProcessedLog {
    if (meta?.type === 'tool_use') {
        const summary = summarizeToolUse(meta);
        return summary ? {silent: false, text: summary + '\n'} : {silent: true, text: ''};
    }
    if (meta?.type === 'tool_result') {
        // 成功结果静默（文件全文不进日志）；失败给一行截断提示便于排查
        if (meta.isError && data) return {silent: false, text: `⚠️ 工具执行失败: ${data.slice(0, 200)}\n`};
        return {silent: true, text: ''};
    }
    return {silent: false, text: data};
}
