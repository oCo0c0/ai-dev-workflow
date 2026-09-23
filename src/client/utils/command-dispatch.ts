/**
 * @file command-dispatch.ts
 * @description 前端侧斜杠命令分发：把 `/name args` 交给服务端命令路由执行。
 *
 * 语义（与 src/server/services/command-dispatch-service.ts 对齐）：
 * - `handled: true`：命令已在服务端执行完毕（结果通常已写入日志流），不要再把原文发给模型
 * - `sendText`：技能/自定义命令的展开模板，用它**替代**原始输入发给模型
 * - 返回 null：不是斜杠命令，按普通消息处理
 */

import {apiPost} from '../api';
import {parseSlashCommand} from '../lib/input-trigger';

export interface ChatCommandOutcome {
    /** 命令名（不含斜杠），调用方据此做针对性 UI 反应（如 /clear 清空本地日志） */
    name: string;
    handled: boolean;
    /** 替代原始输入发送给模型的内容 */
    sendText?: string;
    /** 命令回显文本 */
    message?: string;
    /** 失败原因 */
    error?: string;
}

interface ExecuteResponse {
    handled: boolean;
    message?: string;
    promptInjection?: string;
    error?: string;
}

/**
 * 执行一条斜杠命令。
 * @param input - 用户输入原文
 * @param ctx - 当前执行上下文（执行 id、工作区路径）
 * @returns 命令结果；非命令返回 null
 */
export async function dispatchChatCommand(
    input: string,
    ctx: {executionId?: string; workspacePath?: string} = {},
): Promise<ChatCommandOutcome | null> {
    const trimmed = input.trim();
    const parsed = parseSlashCommand(trimmed);
    if (!parsed) return null;

    try {
        const resp = await apiPost<ExecuteResponse>('/commands/execute', {
            input: trimmed,
            executionId: ctx.executionId,
            workspacePath: ctx.workspacePath,
        });
        return {
            name: parsed.name,
            handled: resp?.handled === true,
            sendText: resp?.promptInjection,
            message: resp?.message,
            error: resp?.error,
        };
    } catch (err) {
        // 命令执行失败时给出可见原因，并阻止把 `/xxx` 当普通消息发给模型
        return {
            name: parsed.name,
            handled: true,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
