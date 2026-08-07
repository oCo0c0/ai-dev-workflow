/**
 * @file LogViewer.tsx
 * @description 统一的日志/消息面板组件 —— 开发计划 / 代码执行 / Agent 执行三页日志流共用。
 *
 *   展示逻辑：
 *     1. 所有消息按时间顺序渲染，不做分区隔离
 *     2. 连续的 output 消息按 15 条一组折叠展示（最新组始终展开）
 *     3. user / error / warning 始终可见，内联渲染
 *     4. tool_use / tool_result 不在此展示 —— 工具执行结果已在各页面的「执行步骤」面板体现
 *
 *   工具栏：标题 / 实时绿点 / 消息计数 / 复制全部 / 清空
 *   智能自动滚动：用户向上滚动时暂停，滚回底部自动恢复
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Copy, Check, Trash2, Terminal, ChevronDown, ChevronUp} from 'lucide-react';
import {cn} from '../lib/utils';
import {LogMessage, type LogMessageData} from './LogMessage';

const OUTPUT_PER_GROUP = 15;

// ── 渲染段：单条消息 ｜ 输出组 ──
type Segment =
    | { type: 'single'; message: LogMessageData; index: number }
    | { type: 'outputGroup'; messages: LogMessageData[]; start: number };

// ── Props ──
interface LogViewerProps {
    messages: LogMessageData[];
    emptyText?: string;
    onClear?: () => void;
    title?: string;
    isStreaming?: boolean;
    className?: string;
}

export function LogViewer({
                              messages,
                              emptyText = '暂无日志',
                              onClear,
                              title = '日志',
                              isStreaming = false,
                              className,
                          }: LogViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [copiedAll, setCopiedAll] = useState(false);

    // ── 智能自动滚动 ──
    const [autoScroll, setAutoScroll] = useState(true);
    const scrollRafRef = useRef<number | null>(null);

    const isNearBottom = useCallback(() => {
        const el = containerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }, []);

    const scrollToBottom = useCallback(() => {
        if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = requestAnimationFrame(() => {
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            scrollRafRef.current = null;
        });
    }, []);

    const handleScroll = useCallback(() => {
        setAutoScroll(isNearBottom());
    }, [isNearBottom]);

    useEffect(() => {
        if (autoScroll) scrollToBottom();
    }, [messages, autoScroll, scrollToBottom]);

    useEffect(() => {
        return () => {
            if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
        };
    }, []);

    // ── 消息分段：连续的 output 合并为输出组 ──
    // tool_use / tool_result 直接跳过 —— 工具执行结果已在执行步骤面板中体现
    const segments = useMemo<Segment[]>(() => {
        const result: Segment[] = [];
        let i = 0;
        while (i < messages.length) {
            const m = messages[i];
            // 跳过工具执行日志（已在执行步骤面板中展示）
            if (m.kind === 'tool_use' || m.kind === 'tool_result') {
                i++;
                continue;
            }
            // output 归入连续输出组
            if (m.kind === 'output') {
                const run: LogMessageData[] = [];
                while (i < messages.length && messages[i].kind === 'output') {
                    run.push(messages[i]);
                    i++;
                }
                for (let g = 0; g < run.length; g += OUTPUT_PER_GROUP) {
                    result.push({
                        type: 'outputGroup',
                        messages: run.slice(g, g + OUTPUT_PER_GROUP),
                        start: g,
                    });
                }
            } else {
                result.push({type: 'single', message: m, index: i});
                i++;
            }
        }
        return result;
    }, [messages]);

    // 输出组的展开/折叠状态（最新一组始终展开）
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
    const outputGroupIndices = useMemo(() => {
        const indices: number[] = [];
        segments.forEach((seg, si) => {
            if (seg.type === 'outputGroup') indices.push(si);
        });
        return indices;
    }, [segments]);

    useEffect(() => {
        if (outputGroupIndices.length === 0) return;
        const last = outputGroupIndices[outputGroupIndices.length - 1];
        setExpandedGroups((prev) => {
            if (prev.has(last)) return prev;
            const next = new Set(prev);
            next.add(last);
            return next;
        });
    }, [outputGroupIndices]);

    const toggleGroup = (segIdx: number) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(segIdx)) next.delete(segIdx);
            else next.add(segIdx);
            return next;
        });
    };

    // ── 复制全部 ──
    const handleCopyAll = async () => {
        try {
            await navigator.clipboard.writeText(messages.map((m) => m.content).join('\n\n'));
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1500);
        } catch { /* 忽略 */
        }
    };

    // ── 统计 ──
    const hasContent = messages.length > 0;

    return (
        <div className={cn('flex flex-col overflow-hidden rounded-lg border border-border/60 glass-card', className)}>
            {/* ═══ 工具栏 ═══ */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2 shrink-0">
                <Terminal
                    className={cn('h-3.5 w-3.5 shrink-0', isStreaming ? 'text-emerald-500' : 'text-muted-foreground')}/>
                <span
                    className={cn('text-xs font-medium', isStreaming ? 'text-emerald-500 font-mono' : 'text-foreground')}>
                    {title}
                </span>
                {isStreaming && (
                    <span className="relative flex h-2 w-2 shrink-0">
                        <span
                            className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
                    </span>
                )}
                <span className="text-[10px] text-muted-foreground">{messages.length} 条</span>
                {!autoScroll && (
                    <button
                        onClick={() => {
                            setAutoScroll(true);
                            scrollToBottom();
                        }}
                        className="text-[10px] text-amber-500 hover:text-amber-400 font-mono"
                        title="已暂停自动滚动，点击恢复"
                    >
                        ⬇ 暂停
                    </button>
                )}
                <div className="ml-auto flex items-center gap-1">
                    <button onClick={handleCopyAll}
                            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
                        {copiedAll ? <Check className="h-3 w-3 text-emerald-500"/> : <Copy className="h-3 w-3"/>}
                        {copiedAll ? '已复制' : '复制全部'}
                    </button>
                    {onClear && (
                        <button onClick={onClear}
                                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                            <Trash2 className="h-3 w-3"/> 清空
                        </button>
                    )}
                </div>
            </div>

            {/* ═══ 日志内容（时间顺序）═══ */}
            <div ref={containerRef} className="flex-1 overflow-y-auto p-3 min-h-[120px]" onScroll={handleScroll}>
                {!hasContent ? (
                    <div className="text-muted-foreground text-center py-8 text-xs">{emptyText}</div>
                ) : (
                    <div className="space-y-1.5">
                        {segments.map((seg, si) => {
                            if (seg.type === 'single') {
                                return <LogMessage key={`msg-${seg.index}`} message={seg.message}/>;
                            }
                            // 输出组
                            const isOpen = expandedGroups.has(si);
                            const groupLabel = seg.messages.length === 1
                                ? `输出 ${seg.start + 1}`
                                : `输出 ${seg.start + 1}-${seg.start + seg.messages.length}`;
                            return (
                                <div key={`out-${si}`}>
                                    <button
                                        onClick={() => toggleGroup(si)}
                                        className={cn(
                                            'w-full py-1 px-2.5 rounded text-[10px] font-medium transition-colors flex items-center justify-between',
                                            isOpen
                                                ? 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                                                : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50',
                                        )}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            {isOpen ? <ChevronUp className="h-3 w-3"/> :
                                                <ChevronDown className="h-3 w-3"/>}
                                            {groupLabel}
                                        </span>
                                        <span className="opacity-60">{seg.messages.length} 条</span>
                                    </button>
                                    {isOpen && (
                                        <div className="space-y-2 mt-1.5">
                                            {seg.messages.map((msg, mi) => (
                                                <LogMessage key={`out-${si}-${mi}`} message={msg}/>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
