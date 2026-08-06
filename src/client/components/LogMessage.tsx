/**
 * @file LogMessage.tsx
 * @description 统一的日志/消息气泡组件 —— 开发计划 / 代码执行 / Agent 执行三页日志流共用。
 *   类型徽标（颜色编码）+ 时间戳 + 步骤号 + Markdown 内容渲染 + 单条复制。
 *   仅负责渲染展示，不涉及日志数据存储与流式逻辑。
 */

import {useState} from 'react';
import {type LucideIcon, User, Brain, Wrench, Terminal, XCircle, AlertTriangle, Copy, Check, Layers, Clock} from 'lucide-react';
import {cn} from '../lib/utils';
import {MarkdownContent} from './MarkdownContent';

/** 统一日志消息类型 */
export type LogKind = 'user' | 'thinking' | 'tool_use' | 'tool_result' | 'output' | 'error' | 'warning';

/** 统一日志消息数据 */
export interface LogMessageData {
    kind: LogKind;
    content: string;
    /** ISO 时间戳（可选） */
    timestamp?: string;
    /** 关联步骤号（可选） */
    stepIndex?: number;
}

interface KindMeta {
    label: string;
    icon: LucideIcon;
    dot: string;
    badge: string;
    bubble: string;
}

const KIND_META: Record<LogKind, KindMeta> = {
    user: {
        label: 'You',
        icon: User,
        dot: 'bg-blue-500',
        badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
        bubble: 'bg-gradient-to-br from-blue-500/15 to-blue-600/5 border-blue-500/25',
    },
    thinking: {
        label: '思考',
        icon: Brain,
        dot: 'bg-amber-500',
        badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        bubble: 'bg-amber-500/10 border-amber-500/25',
    },
    tool_use: {
        label: '工具',
        icon: Wrench,
        dot: 'bg-cyan-500',
        badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
        bubble: 'bg-cyan-500/10 border-cyan-500/25',
    },
    tool_result: {
        label: '结果',
        icon: Terminal,
        dot: 'bg-gray-400',
        badge: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
        bubble: 'bg-gray-500/10 border-gray-500/25',
    },
    output: {
        label: '输出',
        icon: Terminal,
        dot: 'bg-primary',
        badge: 'bg-primary/15 text-primary',
        bubble: 'bg-muted/40 border-border/50',
    },
    error: {
        label: '错误',
        icon: XCircle,
        dot: 'bg-red-500',
        badge: 'bg-red-500/15 text-red-600 dark:text-red-400',
        bubble: 'bg-red-500/10 border-red-500/25',
    },
    warning: {
        label: '警告',
        icon: AlertTriangle,
        dot: 'bg-orange-500',
        badge: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        bubble: 'bg-orange-500/10 border-orange-500/25',
    },
};

interface LogMessageProps {
    message: LogMessageData;
}

/**
 * 单条日志/消息气泡
 */
export function LogMessage({message}: LogMessageProps) {
    const meta = KIND_META[message.kind] ?? KIND_META.output;
    const Icon = meta.icon;
    const isUser = message.kind === 'user';
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(message.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // 剪贴板不可用时静默
        }
    };

    return (
        <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <div className={cn(
                'group relative rounded-xl border px-3.5 py-2.5 max-w-[85%] shadow-sm',
                'animate-in fade-in slide-in-from-bottom-1 duration-200',
                meta.bubble
            )}>
                {/* 用户消息左侧竖条装饰 */}
                {isUser && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-blue-500/70"/>}

                {/* 头部：类型徽标 + 时间戳/步骤 + 复制 */}
                <div className="flex items-center gap-2 mb-1">
                    <span className={cn('flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium', meta.badge)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)}/>
                        <Icon className="h-2.5 w-2.5"/>
                        {meta.label}
                    </span>
                    {message.stepIndex != null && message.stepIndex > 0 && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground select-none">
                            <Layers className="h-2.5 w-2.5"/>
                            Step {message.stepIndex}
                        </span>
                    )}
                    {message.timestamp && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground select-none">
                            <Clock className="h-2.5 w-2.5"/>
                            {new Date(message.timestamp).toLocaleTimeString()}
                        </span>
                    )}
                    <button
                        onClick={handleCopy}
                        className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:bg-accent hover:text-foreground"
                        title="复制本条消息"
                    >
                        {copied ? <Check className="h-2.5 w-2.5 text-emerald-500"/> : <Copy className="h-2.5 w-2.5"/>}
                        {copied ? '已复制' : '复制'}
                    </button>
                </div>

                {/* 内容：Markdown 渲染（紧凑样式见 index.css .log-message） */}
                <div className="log-message">
                    <MarkdownContent content={message.content}/>
                </div>
            </div>
        </div>
    );
}
