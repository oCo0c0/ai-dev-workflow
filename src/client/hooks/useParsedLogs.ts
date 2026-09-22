/**
 * @file useParsedLogs.ts
 * @description 结构化执行日志的增量解析 hook。
 *
 * 执行日志是高频追加流：每条新日志到达都会让 logs 数组引用变化。
 * 若每次都全量 JSON.parse（O(n²)）+ 重建全部消息对象，长执行会打满 CPU。
 * 本 hook 内部持有增量解析器（createLogParser）：追加式更新只解析新增行，
 * 复用既有消息对象（身份稳定 → LogMessage 的 React.memo 生效，跳过未变项的 reconciliation）；
 * 检测到非追加式变化（切换执行 / 清空 / 历史重载）时自动全量重建。
 */
import {useMemo, useRef} from 'react';
import {createLogParser, type LogLineInput} from '../utils/agent-log-parse';
import type {LogMessageData} from '../components/LogMessage';

export function useParsedLogs(logs: Array<string | LogLineInput>): LogMessageData[] {
    const parserRef = useRef<ReturnType<typeof createLogParser> | null>(null);
    if (parserRef.current === null) parserRef.current = createLogParser();
    return useMemo(() => parserRef.current!.feed(logs), [logs]);
}
