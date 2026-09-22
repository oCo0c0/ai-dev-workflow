/**
 * @module agent-log-parse
 * @description 结构化执行日志行 → LogMessageData[] 的共享解析器（Agent 执行 / 经典执行 / 开发计划页共用）。
 *
 * 日志行格式（与后端 agent-coordinator / utils/tool-log.ts 写入格式一致）：
 * - {type:'user'|'error'|'warning', content}
 * - {type:'thinking', content}                          → Think 折叠行
 * - {type:'tool_use', toolName, toolUseId, toolInput}   → 与配对的 tool_result 合并为分类工具行
 * - {type:'tool_result', toolUseId, isError, content}
 * - {type:'output'|'info'|'system', content}            → 输出气泡
 * - 旧格式兼容：**User:** 前缀 → 用户消息；其余文本 → 输出
 *
 * tool_use + tool_result 配对规则：优先按 toolUseId，退化按「最近一条未闭合的工具行」；
 * 未配对的结果行丢弃（结果全文不上屏）。
 */

import type {LogMessageData} from '../components/LogMessage';
import type {ToolEventInfo} from '../components/ToolEventRow';

/** 日志输入行：纯文本，或带元数据的日志对象（ExecutionLogEntry 兼容） */
export interface LogLineInput {
    content: string;
    timestamp?: string;
    stepIndex?: number;
}

/** 单行解析结果：结构化工具事件附带配对元数据 */
interface ParsedLine {
    kind: 'user' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'warning' | 'output';
    content: string;
    toolName?: string;
    toolInput?: string;
    toolUseId?: string;
    isError?: boolean;
}

/** 解析单行日志文本 */
function parseLine(content: string): ParsedLine {
    try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
        switch (parsed.type) {
            case 'user':
                return {kind: 'user', content: str(parsed.content) || content};
            case 'thinking':
                return {kind: 'thinking', content: str(parsed.content) || ''};
            case 'tool_use':
                return {
                    kind: 'tool_use',
                    content: str(parsed.toolName) || 'Tool',
                    toolName: str(parsed.toolName),
                    toolUseId: str(parsed.toolUseId),
                    toolInput: str(parsed.toolInput),
                };
            case 'tool_result':
                return {
                    kind: 'tool_result',
                    content: str(parsed.content) || '',
                    toolUseId: str(parsed.toolUseId),
                    isError: parsed.isError === true,
                };
            case 'error':
                return {kind: 'error', content: str(parsed.content) || ''};
            case 'warning':
                return {kind: 'warning', content: str(parsed.content) || ''};
            case 'output':
            case 'info':
            case 'system':
                return {kind: 'output', content: str(parsed.content) || ''};
            default:
                break;
        }
        // 其他带 content 字符串字段的 JSON 对象统一归为输出
        if (typeof parsed.content === 'string') return {kind: 'output', content: parsed.content};
    } catch { /* not JSON */ }
    // 旧格式兼容：以 **User:** 开头是用户消息
    if (content.startsWith('**User:**')) return {kind: 'user', content};
    return {kind: 'output', content};
}

/**
 * 日志行数组 → LogMessageData[]（供 LogViewer 渲染；折叠/自动滚动由 LogViewer 内部处理）。
 * thinking 保留为独立 kind（渲染为 Think 折叠行）；
 * tool_use + 配对的 tool_result 合并为一条 'tool' 事件消息（渲染为分类工具行）。
 */
export function toLogMessages(logs: Array<string | LogLineInput>): LogMessageData[] {
    return createLogParser().feed(logs);
}

/**
 * 增量日志解析器：日志为追加式时只解析新增行（O(新增)），并复用既有消息对象
 * （身份稳定 → 下游 React.memo 生效）；检测到非追加式变化（切换执行/清空/重载）
 * 时自动全量重建。tool_use↔tool_result 配对状态跨 feed 保持。
 *
 * 高频追加场景（执行日志流）必须用本解析器替代 toLogMessages——
 * 后者每次全量 JSON.parse，O(n²) 会把 CPU 打满。
 */
export function createLogParser() {
    let parsedCount = 0;
    let firstLine: string | undefined;
    let lastLine: string | undefined;
    /** 累积真值：历史消息对象身份在此保持稳定（配对结果就地写回） */
    let messages: LogMessageData[] = [];
    /** 对外快照：内容变化时换新引用，未变化时保持同一引用（下游 memo/依赖稳定） */
    let publicMessages: LogMessageData[] = [];
    let openById = new Map<string, number>();
    let lastOpenIdx = -1;

    const parseFrom = (contents: string[], metas: Array<LogLineInput | undefined>, from: number): LogMessageData[] => {
        for (let i = from; i < contents.length; i++) {
            const meta = metas[i];
            const parsed = parseLine(contents[i]);
            // 时间戳/步骤号透传（ExecutionLogEntry 携带的展示元数据）
            const base = meta ? {timestamp: meta.timestamp, stepIndex: meta.stepIndex} : {};

            if (parsed.kind === 'tool_use') {
                const tool: ToolEventInfo = {
                    name: parsed.toolName || 'Tool',
                    input: parsed.toolInput,
                    state: 'running',
                };
                messages.push({kind: 'tool', content: tool.name, tool, ...base});
                const key = parsed.toolUseId || `#open_${messages.length - 1}`;
                openById.set(key, messages.length - 1);
                lastOpenIdx = messages.length - 1;
            } else if (parsed.kind === 'tool_result') {
                let idx: number | undefined;
                if (parsed.toolUseId && openById.has(parsed.toolUseId)) {
                    idx = openById.get(parsed.toolUseId);
                    openById.delete(parsed.toolUseId);
                } else if (lastOpenIdx >= 0 && messages[lastOpenIdx]?.tool?.state === 'running') {
                    idx = lastOpenIdx;
                }
                if (idx !== undefined && messages[idx].tool) {
                    messages[idx].tool!.result = parsed.content;
                    messages[idx].tool!.state = parsed.isError ? 'error' : 'ok';
                }
                // 未配对到的结果行丢弃（避免结果全文刷屏）
            } else {
                messages.push({kind: parsed.kind, content: parsed.content, ...base});
            }
        }
        parsedCount = contents.length;
        firstLine = contents[0];
        lastLine = contents[contents.length - 1];
        // 内容变化：换对外引用驱动重渲染（内部对象身份不变）
        publicMessages = [...messages];
        return publicMessages;
    };

    return {
        /** 喂入完整日志数组（通常为追加式）；有新行时返回新引用，否则复用同一引用 */
        feed(logs: Array<string | LogLineInput>): LogMessageData[] {
            const contents = logs.map((l) => (typeof l === 'object' && l !== null ? l.content : String(l)));
            const metas = logs.map((l) => (typeof l === 'object' && l !== null ? l : undefined));

            // 追加式判定：长度不减 且 首行 / 上次解析到的尾行一致
            const appendOnly = contents.length >= parsedCount
                && (parsedCount === 0
                    || (contents[0] === firstLine && contents[parsedCount - 1] === lastLine));

            if (!appendOnly) {
                // 非追加式（切换执行 / 清空 / 中间重载）：全量重建
                messages = [];
                publicMessages = [];
                openById = new Map();
                lastOpenIdx = -1;
                parsedCount = 0;
                return parseFrom(contents, metas, 0);
            }
            if (contents.length === parsedCount) return publicMessages; // 无新行：复用引用
            return parseFrom(contents, metas, parsedCount);
        },
    };
}

// ── 本次产出（deliverables）：从写类工具事件派生变更文件清单 ──

/** 产出文件条目 */
export interface DeliverableFile {
    /** 路径（工具参数原值） */
    path: string;
    /** 文件名（末段） */
    name: string;
    /** 所在目录末段（展示用） */
    dir: string;
}

/** 写类工具（产出文件）；读取/搜索/终端不产文件 */
const MUTATION_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** 从工具参数 JSON 挑路径键（可能被后端截断，解析失败返回 undefined） */
function pickPathArg(inputJson?: string): string | undefined {
    if (!inputJson) return undefined;
    try {
        const args = JSON.parse(inputJson) as Record<string, unknown>;
        if (typeof args !== 'object' || args === null) return undefined;
        for (const key of ['path', 'file_path']) {
            const v = args[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
    } catch { /* not JSON */ }
    return undefined;
}

/**
 * 从解析后的消息流派生「本次产出」文件清单（对齐 DSH turn-deliverables 语义）：
 * 仅统计**成功的**写类工具（Write/Edit/MultiEdit/NotebookEdit）参数中的文件路径；
 * 失败的调用不计入，读取不算产出；首次出现顺序去重（同文件先写后改只算一条）。
 */
export function deliverableFilesFromMessages(messages: LogMessageData[]): DeliverableFile[] {
    const out: DeliverableFile[] = [];
    const seen = new Set<string>();
    for (const m of messages) {
        if (m.kind !== 'tool' || !m.tool || m.tool.state !== 'ok') continue;
        if (!MUTATION_TOOLS.has(m.tool.name)) continue;
        const p = pickPathArg(m.tool.input);
        if (!p || seen.has(p)) continue;
        seen.add(p);
        const at = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        const segments = p.slice(0, at === -1 ? 0 : at).split(/[\\/]/).filter(Boolean);
        out.push({
            path: p,
            name: at === -1 ? p : p.slice(at + 1),
            dir: segments[segments.length - 1] || '',
        });
    }
    return out;
}

/** 便捷重载：从原始日志行派生（内部全量解析，高频场景请用 useParsedLogs + deliverableFilesFromMessages） */
export function deriveDeliverableFiles(logs: Array<string | LogLineInput>): DeliverableFile[] {
    return deliverableFilesFromMessages(toLogMessages(logs));
}
