/**
 * @file useParsedLogs.ts
 * @description 结构化执行日志的增量解析 hook。
 *
 * 执行日志是高频追加流：每条新日志到达都会让 logs 数组引用变化。
 * 若每次都全量 JSON.parse（O(n²)）+ 重建全部消息对象，长执行会打满 CPU。
 * 本 hook 内部持有增量解析器（createLogParser）：追加式更新只解析新增行，
 * 复用既有消息对象（身份稳定 → LogMessage 的 React.memo 生效，跳过未变项的 reconciliation）；
 * 检测到非追加式变化（切换执行 / 清空 / 历史重载）时自动全量重建。
 *
 * `finalizeRunning`：执行已结束时，把仍停在「运行中」的工具行兜底置为 stopped
 * （权限被拒 / 被中止 / 工具未返回的情况下不会有配对结果，否则会永远转圈）。
 */
import {useMemo, useRef} from 'react';
import {createLogParser, finalizeRunningTools, type LogLineInput} from '../utils/agent-log-parse';
import type {LogMessageData} from '../components/LogMessage';

export interface ParsedLogsOptions {
    /** 执行是否已结束：为 true 时把未闭环的工具行收成 stopped 终态 */
    finalizeRunning?: boolean;
}

export function useParsedLogs(logs: Array<string | LogLineInput>, options: ParsedLogsOptions = {}): LogMessageData[] {
    const parserRef = useRef<ReturnType<typeof createLogParser> | null>(null);
    if (parserRef.current === null) parserRef.current = createLogParser();
    const messages = useMemo(() => parserRef.current!.feed(logs), [logs]);
    const finalize = options.finalizeRunning === true;
    return useMemo(
        () => (finalize ? finalizeRunningTools(messages) : messages),
        [messages, finalize],
    );
}
