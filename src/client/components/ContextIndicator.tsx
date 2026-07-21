/**
 * @file ContextIndicator.tsx
 * @description 上下文窗口使用量指示器组件
 *
 * 显示当前会话的 token 使用情况，颜色编码：
 * - 绿色 (0-60%)：安全
 * - 黄色 (60-80%)：警告
 * - 红色 (80-100%)：危险
 */

import {useMemo} from 'react';
import {AlertCircle, Activity} from 'lucide-react';
import {estimateTokens, calculateUsagePercentage, getUsageTheme, formatTokenCount} from '../lib/token-estimator';
import {cn} from '../lib/utils';

interface ContextIndicatorProps {
    /** 会话日志内容（用于估算 token） */
    logs?: string[];
    /** 单个日志字符串（用于替代 logs） */
    logText?: string;
    /** 最大 token 容量（默认 300K） */
    maxTokens?: number;
    /** 是否显示详细信息 */
    showDetails?: boolean;
    /** 自定义类名 */
    className?: string;
    /** 新会话建议回调（超过 80% 时触发） */
    onSuggestNewSession?: () => void;
}

/**
 * 上下文窗口指示器组件
 *
 * @example
 * ```tsx
 * <ContextIndicator logs={planLogs} maxTokens={300000} />
 * ```
 */
export default function ContextIndicator({
    logs,
    logText,
    maxTokens = 300000,
    showDetails = false,
    className = '',
    onSuggestNewSession
}: ContextIndicatorProps) {
    // 合并日志内容
    const content = useMemo(() => {
        if (logText) return logText;
        if (logs) return logs.join('\n');
        return '';
    }, [logs, logText]);

    // 估算 token 使用量
    const {usedTokens, percentage, theme} = useMemo(() => {
        const used = estimateTokens(content);
        const pct = calculateUsagePercentage(used, maxTokens);

        return {
            usedTokens: used,
            percentage: pct,
            theme: getUsageTheme(pct)
        };
    }, [content, maxTokens, logs]);

    // 圆环进度条计算
    const circumference = 2 * Math.PI * 18; // r=18
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    // 是否显示警告（提前到 80%，给用户更多时间响应）
    const showWarning = percentage >= 80;
    // 是否为空状态
    const isEmpty = content.length < 100;

    return (
        <div className={cn('flex items-center gap-2', className)}>
            {/* 圆环进度条 */}
            <div className="relative w-10 h-10">
                <svg className="transform -rotate-90 w-10 h-10">
                    {/* 背景圆环 */}
                    <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        className="stroke-muted/30"
                        strokeWidth="3"
                    />
                    {/* 进度圆环 */}
                    <circle
                        cx="20"
                        cy="20"
                        r="18"
                        fill="none"
                        className={cn('transition-all duration-500', theme.color.replace('text-', 'stroke-'))}
                        strokeWidth="3"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                    />
                </svg>
                {/* 中心图标/百分比 */}
                <div className="absolute inset-0 flex items-center justify-center">
                    {showWarning ? (
                        <AlertCircle className={cn('h-4 w-4 animate-pulse', theme.color)} />
                    ) : (
                        <Activity className={cn('h-4 w-4', theme.color)} />
                    )}
                </div>
            </div>

            {/* 文本信息 */}
            <div className="flex flex-col">
                <div className="flex items-center gap-2">
                    {isEmpty ? (
                        <span className="text-xs text-muted-foreground">
                            暂无对话
                        </span>
                    ) : (
                        <>
                            <span className={cn('text-xs font-medium', theme.color)}>
                                上下文: {percentage.toFixed(1)}%
                            </span>
                            {showDetails && (
                                <span className="text-xs text-muted-foreground">
                                    ({formatTokenCount(usedTokens)} / {formatTokenCount(maxTokens)})
                                </span>
                            )}
                            {showWarning && onSuggestNewSession && (
                                <button
                                    onClick={onSuggestNewSession}
                                    className={cn(
                                        'text-xs px-2 py-0.5 rounded border transition-colors',
                                        theme.color,
                                        theme.bg,
                                        theme.border,
                                        'hover:opacity-80'
                                    )}
                                >
                                    开始新会话
                                </button>
                            )}
                        </>
                    )}
                </div>
                {showWarning && !onSuggestNewSession && (
                    <span className="text-xs text-muted-foreground">
                        建议开始新会话
                    </span>
                )}
            </div>
        </div>
    );
}
