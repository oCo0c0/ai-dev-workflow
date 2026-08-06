/**
 * @file LogViewer.tsx
 * @description 统一的日志/消息面板组件 —— 开发计划 / 代码执行 / Agent 执行三页日志流共用。
 *   工具栏（复制全部 / 清空 / 条数）+ 分组折叠 + 自动滚动 + 空态提示。
 *   数据由调用方传入（消息的流式更新、存储、清空逻辑仍在各页面内），本组件只负责展示。
 */

import {useEffect, useMemo, useRef, useState} from 'react';
import {Copy, Check, Trash2, ChevronDown, ChevronUp, Terminal} from 'lucide-react';
import {cn} from '../lib/utils';
import {LogMessage, type LogMessageData} from './LogMessage';

const MESSAGES_PER_GROUP = 10;

interface LogViewerProps {
    messages: LogMessageData[];
    /** 空态提示文本 */
    emptyText?: string;
    /** 清空回调（传入才显示清空按钮） */
    onClear?: () => void;
    /** 面板标题 */
    title?: string;
    /** 是否处于流式输出中（标题栏显示实时绿点） */
    isStreaming?: boolean;
    /** 附加到根容器的类名（控制尺寸 / 外边距等） */
    className?: string;
}

/**
 * 统一日志/消息面板
 */
export function LogViewer({messages, emptyText = '暂无日志', onClear, title = '日志', isStreaming = false, className}: LogViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [copiedAll, setCopiedAll] = useState(false);
    // 分组：默认展开最新一组，其余折叠
    const [expanded, setExpanded] = useState<Set<number>>(new Set());

    const groups = useMemo(() => {
        const result: {start: number; logs: LogMessageData[]}[] = [];
        for (let i = 0; i < messages.length; i += MESSAGES_PER_GROUP) {
            result.push({start: i, logs: messages.slice(i, i + MESSAGES_PER_GROUP)});
        }
        return result;
    }, [messages]);

    // 消息分组变化时，始终展开最新一组
    useEffect(() => {
        if (groups.length === 0) return;
        setExpanded((prev) => {
            const last = groups.length - 1;
            if (prev.has(last)) return prev;
            const next = new Set(prev);
            next.add(last);
            return next;
        });
    }, [groups.length]);

    // 新消息到来时自动滚动到底部
    useEffect(() => {
        const el = containerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages.length]);

    const handleCopyAll = async () => {
        try {
            await navigator.clipboard.writeText(messages.map((m) => m.content).join('\n\n'));
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1500);
        } catch {
            // 忽略
        }
    };

    const toggleGroup = (idx: number) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
        });
    };

    return (
        <div className={cn('flex flex-col overflow-hidden rounded-lg border border-border/60 glass-card', className)}>
            {/* 工具栏 */}
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
                <Terminal className={cn('h-3.5 w-3.5', isStreaming ? 'text-emerald-500' : 'text-muted-foreground')}/>
                <span className={cn('text-xs font-medium', isStreaming ? 'text-emerald-500 font-mono' : 'text-foreground')}>
                    {title}
                </span>
                {isStreaming && (
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
                    </span>
                )}
                <span className="text-[10px] text-muted-foreground">{messages.length} 条</span>
                <div className="ml-auto flex items-center gap-1">
                    <button
                        onClick={handleCopyAll}
                        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                        title="复制全部消息"
                    >
                        {copiedAll ? <Check className="h-3 w-3 text-emerald-500"/> : <Copy className="h-3 w-3"/>}
                        {copiedAll ? '已复制' : '复制全部'}
                    </button>
                    {onClear && (
                        <button
                            onClick={onClear}
                            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                            title="清空日志"
                        >
                            <Trash2 className="h-3 w-3"/>
                            清空
                        </button>
                    )}
                </div>
            </div>

            {/* 日志内容（分组折叠） */}
            <div ref={containerRef} className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[120px]">
                {messages.length === 0 ? (
                    <div className="text-muted-foreground text-center py-8 text-xs">{emptyText}</div>
                ) : (
                    groups.map((group, gi) => {
                        const isOpen = expanded.has(gi);
                        return (
                            <div key={gi} className="mb-1">
                                <button
                                    onClick={() => toggleGroup(gi)}
                                    className={cn(
                                        'w-full py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-200 flex items-center justify-between',
                                        isOpen
                                            ? 'bg-blue-500/15 border border-blue-500/25 text-blue-300'
                                            : 'bg-muted/30 border border-border/50 text-muted-foreground hover:bg-muted/50'
                                    )}
                                >
                                    <span className="flex items-center gap-2">
                                        {isOpen ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>}
                                        消息 {group.start + 1}-{group.start + group.logs.length}
                                    </span>
                                    <span className="text-[10px] opacity-60">{group.logs.length} 条</span>
                                </button>
                                {isOpen && (
                                    <div className="space-y-2 mt-2">
                                        {group.logs.map((msg, i) => (
                                            <LogMessage key={`${group.start + i}-${i}`} message={msg}/>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
