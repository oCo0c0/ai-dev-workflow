/**
 * @module dsh-projector
 * @description dsh 会话事件/通知 -> adw onOutput(data, meta) 契约的投影器
 *
 * adw 展示契约（与 claude-provider 产出的 meta 完全同形，见 claude-provider.ts:548-565）：
 *   {type: 'thinking'}                                      思考正文
 *   {type: 'tool_use', toolName, toolInput, toolUseId}      工具调用（data 为空串）
 *   {type: 'tool_result', toolUseId, isError}               工具结果全文
 *
 * 上游是 dsh SDK 的四种通知（session.event / session.status /
 * subagent.started / subagent.finished）。session.event 的 data 为
 * dsh SessionEventMap 载荷；本模块只消费投影需要的字段，未知事件类型静默忽略
 * （dsh 会话事件可扩展，消费方必须容忍未知类型）。
 */

import type {DshNotification, DshSessionEvent} from './dsh-protocol.js';

/** adw onOutput 回调形状 */
export type AdwOutputHandler = (data: string, meta?: Record<string, unknown>) => void;

/**
 * dsh 工具名 -> Claude 风格名归一化表。
 * 让 tool-log.ts 的 TOOL_ICONS/summarizeToolUse（硬编码 Claude 工具名）
 * 无改动地继续工作；未列出的工具保持原名走默认 🔧 分支。
 * 字段名（file_path/command/pattern/description）两个体系同源，直接透传。
 */
const TOOL_NAME_NORMALIZATION: Record<string, string> = {
    // dsh-tool-fs 家族（read/write/edit）与 str_replace_editor（view/create/str_replace/insert）
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    str_replace: 'Edit',
    insert: 'Write',
    // shell 家族（bash / pwsh 后端的模型面工具名）
    bash: 'Bash',
    pwsh: 'Bash',
    // 搜索
    grep: 'Grep',
    glob: 'Glob',
    // 子 agent（dsh tool-subagent 默认 toolName 即 'subagent'）
    subagent: 'Task',
    subagent_fork: 'Task',
    // 待办
    todo_write: 'TodoWrite',
    // web
    web_fetch: 'WebFetch',
    web_search: 'WebSearch',
};

/** 归一化工具名；未识别的原样返回（MCP 工具 mcp__server__tool 走默认摘要分支） */
export function normalizeToolName(name: string): string {
    return TOOL_NAME_NORMALIZATION[name] ?? name;
}

/** 从 ContentBlock[] 中提取纯文本（text 块拼接；reasoning 块单独走 thinking 通道） */
function blocksToText(blocks: unknown): string {
    if (!Array.isArray(blocks)) return '';
    let out = '';
    for (const block of blocks) {
        if (
            typeof block === 'object' && block !== null &&
            (block as {type?: string}).type === 'text' &&
            typeof (block as {text?: unknown}).text === 'string'
        ) {
            out += (block as {text: string}).text;
        }
    }
    return out;
}

/** 从 ContentBlock[] 中提取 reasoning 文本 */
function blocksToReasoning(blocks: unknown): string {
    if (!Array.isArray(blocks)) return '';
    let out = '';
    for (const block of blocks) {
        if (
            typeof block === 'object' && block !== null &&
            (block as {type?: string}).type === 'reasoning' &&
            typeof (block as {text?: unknown}).text === 'string'
        ) {
            out += (block as {text: string}).text;
        }
    }
    return out;
}

/** 安全解析模型产出的工具参数 JSON 字符串；失败返回 undefined（保持 meta.toolInput 缺省） */
function parseToolArguments(raw: unknown): Record<string, unknown> | undefined {
    if (typeof raw !== 'string' || raw === '') return undefined;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        return undefined;
    } catch {
        return undefined;
    }
}

/** tool/result 事件的 message.content 是单元素 ToolResultBlock 数组 */
function extractToolResultPayload(data: Record<string, unknown>): {callId: string; text: string; isError: boolean} | null {
    const message = data.message as Record<string, unknown> | undefined;
    if (!message || !Array.isArray(message.content) || message.content.length === 0) return null;
    const block = message.content[0] as Record<string, unknown>;
    if (block.type !== 'tool-result') return null;
    const callId = typeof block.toolCallId === 'string' ? block.toolCallId : '';
    const isError = block.isError === true;
    // 结果内容可能是 text 块数组（正文）或 image；文本通道只投影 text
    const text = blocksToText(block.content);
    return {callId, text, isError};
}

/** 投影器选项 */
export interface DshProjectorOptions {
    /** adw onOutput 回调 */
    onOutput: AdwOutputHandler;
    /** 根会话 id（initialize 后由 run() 注入；用于过滤 session.event 只留本会话） */
    rootSessionId?: string;
}

/**
 * 把 dsh SDK 通知流投影为 adw 的 onOutput(data, meta) 事件。
 *
 * 会话过滤：SDK 运行时会转发进程内全部会话的事件（含子 agent）。
 * 投影器保留所有会话的 tool 事件（子 agent 的工具活动对前端时间线有价值），
 * assistant 正文只投影根会话（避免子 agent 中间文本混入执行日志）。
 */
export class DshEventProjector {
    private readonly onOutput: AdwOutputHandler;
    private rootSessionId: string | undefined;
    /** 根会话最近一次 assistant 文本（run 结束时作为 finalResponse 候选） */
    private lastAssistantText = '';
    /** 轮次计数（maxTurns 软护栏用） */
    private turnCount = 0;

    constructor(options: DshProjectorOptions) {
        this.onOutput = options.onOutput;
        this.rootSessionId = options.rootSessionId;
    }

    /** run() 在拿到会话 id 后补设根会话（新建会话时 id 由我们先生成，早于事件到达） */
    setRootSessionId(sessionId: string): void {
        this.rootSessionId = sessionId;
    }

    /** 根会话最后一条非空 assistant 文本 */
    getFinalResponse(): string {
        return this.lastAssistantText;
    }

    /** 已完成的轮次数（turn/end 计数） */
    getTurnCount(): number {
        return this.turnCount;
    }

    /** 消费一条 dsh 通知 */
    handle(notification: DshNotification): void {
        switch (notification.method) {
            case 'session.event':
                this.handleSessionEvent(notification.params.sessionId, notification.params.event);
                break;
            case 'subagent.started':
                this.onOutput('', {
                    type: 'subagent',
                    phase: 'started',
                    parentSessionId: notification.params.parentSessionId,
                    childSessionId: notification.params.childSessionId,
                });
                break;
            case 'subagent.finished': {
                const p = notification.params;
                this.onOutput('', {
                    type: 'subagent',
                    phase: 'finished',
                    childSessionId: p.childSessionId,
                    status: p.status,
                    lastAssistantMessage: blocksToText(p.lastAssistantMessage),
                });
                break;
            }
            case 'session.status':
                // 状态转换由 run() 的 idle 等待逻辑消费，投影层无需转发
                break;
        }
    }

    private handleSessionEvent(sessionId: string, event: DshSessionEvent): void {
        const isRoot = this.rootSessionId === undefined || sessionId === this.rootSessionId;
        switch (event.type) {
            case 'assistant/message': {
                const data = event.data as Record<string, unknown>;
                const message = data.message as Record<string, unknown> | undefined;
                if (!message || !Array.isArray(message.content)) return;
                // reasoning 块 -> thinking 通道（所有会话；子 agent 思考也有展示价值）
                const reasoning = blocksToReasoning(message.content);
                if (reasoning) {
                    this.onOutput(reasoning, {type: 'thinking', sessionId});
                }
                // text 块 -> 正文（仅根会话）
                if (isRoot) {
                    const text = blocksToText(message.content);
                    if (text) {
                        this.lastAssistantText = text;
                        this.onOutput(text, {type: 'assistant', sessionId});
                    }
                }
                return;
            }
            case 'tool/call': {
                const data = event.data as Record<string, unknown>;
                const rawName = typeof data.name === 'string' ? data.name : '';
                if (!rawName) return;
                const callId = typeof data.callId === 'string' ? data.callId : '';
                this.onOutput('', {
                    type: 'tool_use',
                    toolName: normalizeToolName(rawName),
                    rawToolName: rawName,
                    toolInput: parseToolArguments(data.arguments),
                    toolUseId: callId,
                    sessionId,
                });
                return;
            }
            case 'tool/result': {
                const payload = extractToolResultPayload(event.data as Record<string, unknown>);
                if (!payload) return;
                this.onOutput(payload.text, {
                    type: 'tool_result',
                    toolUseId: payload.callId,
                    isError: payload.isError,
                    sessionId,
                });
                return;
            }
            case 'turn/end':
                if (isRoot) this.turnCount++;
                return;
            default:
                // turn/start、step/*、todo/write、request/*、user/message、compaction/*
                // 等事件不进 adw 展示契约，静默忽略（未知类型必须容忍）
                return;
        }
    }
}
