/**
 * @file DshEventProjector 单元测试
 * @description 验证 dsh 通知 -> adw onOutput(data, meta) 契约的投影：
 * thinking / tool_use / tool_result / subagent 事件、工具名归一化、
 * 会话过滤（assistant 正文仅根会话）、finalResponse / turnCount 累计。
 */

import {describe, it, expect} from 'vitest';
import {DshEventProjector, normalizeToolName} from './dsh-projector.js';
import type {AdwOutputHandler} from './dsh-projector.js';
import type {DshNotification, DshSessionEvent} from './dsh-protocol.js';

/** 收集 (data, meta) 对的处理器工厂 */
function collector(): {handler: AdwOutputHandler; events: Array<{data: string; meta?: Record<string, unknown>}>} {
    const events: Array<{data: string; meta?: Record<string, unknown>}> = [];
    return {handler: (data, meta) => events.push({data, meta}), events};
}

const ROOT = 'root-session-1';
const CHILD = 'child-session-1';

/** 构造一条 session.event 通知 */
function ev(sessionId: string, event: Partial<DshSessionEvent> & {type: string}): DshNotification {
    return {
        method: 'session.event',
        params: {sessionId, event: {seq: 1, time: 0, data: {}, ...event}},
    };
}

describe('normalizeToolName', () => {
    it('归一化 dsh 工具名到 Claude 风格', () => {
        expect(normalizeToolName('read')).toBe('Read');
        expect(normalizeToolName('write')).toBe('Write');
        expect(normalizeToolName('str_replace')).toBe('Edit');
        expect(normalizeToolName('bash')).toBe('Bash');
        expect(normalizeToolName('pwsh')).toBe('Bash');
        expect(normalizeToolName('grep')).toBe('Grep');
        expect(normalizeToolName('subagent')).toBe('Task');
        expect(normalizeToolName('todo_write')).toBe('TodoWrite');
    });

    it('未识别的工具名原样返回（MCP 工具走默认摘要分支）', () => {
        expect(normalizeToolName('mcp__adw__pull_requirement')).toBe('mcp__adw__pull_requirement');
        expect(normalizeToolName('some_future_tool')).toBe('some_future_tool');
    });
});

describe('DshEventProjector', () => {
    it('assistant/message 的 reasoning 块投影为 thinking', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(ROOT, {
            type: 'assistant/message',
            data: {
                message: {
                    role: 'assistant',
                    content: [
                        {type: 'reasoning', text: '让我想想...'},
                        {type: 'text', text: '答案是 42'},
                    ],
                },
            },
        }));
        const thinking = events.find((e) => e.meta?.type === 'thinking');
        expect(thinking?.data).toBe('让我想想...');
        const text = events.find((e) => e.meta?.type === 'assistant');
        expect(text?.data).toBe('答案是 42');
        expect(p.getFinalResponse()).toBe('答案是 42');
    });

    it('tool/call -> tool_use（工具名归一化 + 参数解析 + callId）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle(ev(ROOT, {
            type: 'tool/call',
            data: {callId: 'call-1', name: 'read', arguments: '{"file_path":"src/a.ts"}'},
        }));
        const e = events.find((x) => x.meta?.type === 'tool_use');
        expect(e?.data).toBe('');
        expect(e?.meta?.toolName).toBe('Read');
        expect(e?.meta?.rawToolName).toBe('read');
        expect(e?.meta?.toolUseId).toBe('call-1');
        expect((e?.meta?.toolInput as Record<string, unknown>)?.file_path).toBe('src/a.ts');
    });

    it('tool/call 非法 JSON 参数时 toolInput 缺省（不抛错）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle(ev(ROOT, {type: 'tool/call', data: {callId: 'c2', name: 'bash', arguments: '{oops'}}));
        const e = events.find((x) => x.meta?.type === 'tool_use');
        expect(e?.meta?.toolName).toBe('Bash');
        expect(e?.meta?.toolInput).toBeUndefined();
    });

    it('tool/result -> tool_result（正文 + isError + 配对 id）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle(ev(ROOT, {
            type: 'tool/result',
            data: {
                message: {
                    role: 'user',
                    content: [
                        {type: 'tool-result', toolCallId: 'call-1', content: [{type: 'text', text: '文件内容...'}], isError: false},
                    ],
                },
            },
        }));
        const e = events.find((x) => x.meta?.type === 'tool_result');
        expect(e?.data).toBe('文件内容...');
        expect(e?.meta?.toolUseId).toBe('call-1');
        expect(e?.meta?.isError).toBe(false);
    });

    it('tool/result 的 isError=true 时保留错误标记', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle(ev(ROOT, {
            type: 'tool/result',
            data: {
                message: {
                    role: 'user',
                    content: [
                        {type: 'tool-result', toolCallId: 'call-9', content: [{type: 'text', text: 'boom'}], isError: true},
                    ],
                },
            },
        }));
        const e = events.find((x) => x.meta?.type === 'tool_result');
        expect(e?.meta?.isError).toBe(true);
    });

    it('assistant 正文仅根会话进入（子 agent 文本不混入）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(CHILD, {
            type: 'assistant/message',
            data: {message: {role: 'assistant', content: [{type: 'text', text: '子 agent 中间输出'}]}},
        }));
        expect(events.find((e) => e.meta?.type === 'assistant')).toBeUndefined();
        expect(p.getFinalResponse()).toBe('');

        p.handle(ev(ROOT, {
            type: 'assistant/message',
            data: {message: {role: 'assistant', content: [{type: 'text', text: '根会话回复'}]}},
        }));
        expect(events.find((e) => e.meta?.type === 'assistant')?.data).toBe('根会话回复');
    });

    it('子 agent 的 tool 事件保留（时间线有展示价值）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(CHILD, {type: 'tool/call', data: {callId: 'cc', name: 'grep', arguments: '{"pattern":"foo"}'}}));
        expect(events.find((e) => e.meta?.type === 'tool_use')?.meta?.sessionId).toBe(CHILD);
    });

    it('turn/end 仅根会话计数', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(CHILD, {type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}}));
        expect(p.getTurnCount()).toBe(0);
        p.handle(ev(ROOT, {type: 'turn/end', data: {turn: 1, reason: {kind: 'completed'}}}));
        p.handle(ev(ROOT, {type: 'turn/end', data: {turn: 2, reason: {kind: 'completed'}}}));
        expect(p.getTurnCount()).toBe(2);
    });

    it('turn/end 的 error reason 被提取为 lastError（LLM 失败可见）', () => {
        const {handler} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(ROOT, {
            type: 'turn/end',
            data: {turn: 1, reason: {kind: 'error', error: {message: 'llm-deepseek: no API key', code: 'MISSING_CREDENTIAL'}}},
        }));
        expect(p.getLastError()).toContain('no API key');
        expect(p.getTurnCount()).toBe(1);
    });

    it('clearError 复位错误；错误按轮隔离', () => {
        const {handler} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.setRootSessionId(ROOT);
        p.handle(ev(ROOT, {type: 'turn/end', data: {turn: 1, reason: {kind: 'error', error: {message: 'boom'}}}}));
        expect(p.getLastError()).toBe('boom');
        p.clearError();
        expect(p.getLastError()).toBeUndefined();
    });

    it('subagent.started / finished 投影为 subagent 事件', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle({method: 'subagent.started', params: {parentSessionId: ROOT, childSessionId: CHILD}});
        p.handle({
            method: 'subagent.finished',
            params: {
                provider: 'spawn',
                agentId: CHILD,
                parentSessionId: ROOT,
                childSessionId: CHILD,
                status: 'ok',
                stopReason: 'end-turn',
                lastAssistantMessage: [{type: 'text', text: '子任务完成'}],
            },
        });
        const started = events.find((e) => e.meta?.type === 'subagent' && e.meta?.phase === 'started');
        expect(started?.meta?.childSessionId).toBe(CHILD);
        const finished = events.find((e) => e.meta?.type === 'subagent' && e.meta?.phase === 'finished');
        expect(finished?.meta?.status).toBe('ok');
        expect(finished?.meta?.lastAssistantMessage).toBe('子任务完成');
    });

    it('未知事件类型与 session.status 静默忽略（前向兼容）', () => {
        const {handler, events} = collector();
        const p = new DshEventProjector({onOutput: handler});
        p.handle(ev(ROOT, {type: 'some/future/event', data: {foo: 1}}));
        p.handle(ev(ROOT, {type: 'todo/write', data: {todos: []}}));
        p.handle({method: 'session.status', params: {sessionId: ROOT, status: 'running'}});
        expect(events).toHaveLength(0);
    });
});
