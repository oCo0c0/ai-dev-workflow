/**
 * @file 可放大输入框组件
 * @description 基于原生 `<textarea>` 封装，右上角悬浮「放大 / 优化」按钮。
 *   - 放大：弹出全屏弹窗进行编辑，解决输入区域过窄、行数固定导致编辑不便的问题。
 *   - 优化：调用后端 /api/prompts/optimize 对提示词进行润色，结果展示给用户自行决定是否采纳。
 *   完整保留原生 textarea 的所有属性（value / onChange / onKeyDown / placeholder 等）。
 */

import * as React from 'react';
import {useState, useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {Maximize2, X, Sparkles, Loader2} from 'lucide-react';
import {apiPost} from '../api';
import {Button} from './ui/button';

interface ExpandableTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    /** 放大弹窗标题 */
    title?: string;
    /** 外层容器额外类名（如 flex-1，用于在 flex 布局中撑满） */
    wrapperClassName?: string;
    /** 弹窗中 textarea 的额外类名 */
    modalClassName?: string;
    /** 是否启用「提示词优化」按钮 */
    optimizable?: boolean;
    /** 优化用途（reply / requirement / plan），用于给模型提供优化上下文 */
    optimizePurpose?: string;
}

export const ExpandableTextarea = React.forwardRef<HTMLTextAreaElement, ExpandableTextareaProps>(
    (
        {
            title,
            className = '',
            wrapperClassName = '',
            modalClassName = '',
            optimizable = false,
            optimizePurpose,
            ...props
        },
        ref
    ) => {
        const [expanded, setExpanded] = useState(false);
        const modalRef = useRef<HTMLTextAreaElement>(null);

        // 提示词优化状态
        const [optimizing, setOptimizing] = useState(false);
        const [optimizeResult, setOptimizeResult] = useState<string | null>(null);
        const [optimizeError, setOptimizeError] = useState<string | null>(null);

        // 打开弹窗后自动聚焦到弹窗内的 textarea
        useEffect(() => {
            if (expanded) {
                requestAnimationFrame(() => modalRef.current?.focus());
            }
        }, [expanded]);

        // 支持 Esc 关闭弹窗
        useEffect(() => {
            if (!expanded) return;
            const onKey = (e: KeyboardEvent) => {
                if (e.key === 'Escape') setExpanded(false);
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, [expanded]);

        const handleOptimize = async () => {
            const text = String(props.value ?? '').trim();
            if (!text || optimizing) return;

            setOptimizing(true);
            setOptimizeError(null);
            setOptimizeResult(null);
            try {
                const res = await apiPost<{optimized: string}>('/prompts/optimize', {
                    text,
                    purpose: optimizePurpose,
                });
                setOptimizeResult(res.optimized);
            } catch (err) {
                setOptimizeError(err instanceof Error ? err.message : String(err));
            } finally {
                setOptimizing(false);
            }
        };

        const adoptOptimized = () => {
            if (optimizeResult == null) return;
            props.onChange?.({target: {value: optimizeResult}} as React.ChangeEvent<HTMLTextAreaElement>);
            setOptimizeResult(null);
            setOptimizeError(null);
        };

        const discardOptimized = () => {
            setOptimizeResult(null);
            setOptimizeError(null);
        };

        return (
            <div className={`relative group min-w-0 ${wrapperClassName}`}>
                <textarea
                    ref={ref}
                    className={`w-full ${className}`}
                    {...props}
                />

                {/* 右上角工具栏：优化 + 放大（悬停浮现） */}
                {!props.disabled && (
                    <div className="absolute top-2 right-2 z-30 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                        {optimizable && (
                            <button
                                type="button"
                                onClick={handleOptimize}
                                disabled={optimizing || !String(props.value ?? '').trim()}
                                title="优化提示词"
                                aria-label="优化提示词"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-primary disabled:opacity-50 disabled:pointer-events-none"
                            >
                                {optimizing
                                    ? <Loader2 className="h-4 w-4 animate-spin"/>
                                    : <Sparkles className="h-4 w-4"/>}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setExpanded(true)}
                            title="放大编辑"
                            aria-label="放大编辑"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-primary"
                        >
                            <Maximize2 className="h-4 w-4"/>
                        </button>
                    </div>
                )}

                {/* 优化结果面板：展示优化后的文本，用户决定是否采纳 */}
                {(optimizing || optimizeResult != null || optimizeError != null) && (
                    <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                            <Sparkles className="h-3.5 w-3.5 text-primary"/>
                            <span className="text-xs font-medium">提示词优化</span>
                        </div>

                        {optimizing ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                                <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                                正在优化，请稍候...
                            </div>
                        ) : optimizeError != null ? (
                            <div className="space-y-2">
                                <p className="text-xs text-destructive">{optimizeError}</p>
                                <Button size="sm" variant="outline" onClick={handleOptimize}>重试</Button>
                            </div>
                        ) : (
                            <>
                                <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto bg-background/70 rounded-md p-3 border border-border/60">
                                    {optimizeResult}
                                </div>
                                <div className="flex items-center gap-2 mt-2.5">
                                    <Button size="sm" onClick={adoptOptimized}>采纳</Button>
                                    <Button size="sm" variant="outline" onClick={handleOptimize} disabled={optimizing}>
                                        重新生成
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={discardOptimized}>放弃</Button>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* 放大编辑弹窗 */}
                {expanded && createPortal(
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => setExpanded(false)}
                        />
                        <div className="relative z-10 w-full max-w-5xl mx-4 glass-panel rounded-xl shadow-2xl flex flex-col h-[85vh]">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                                <span className="text-sm font-medium">{title || '编辑内容'}</span>
                                <button
                                    onClick={() => setExpanded(false)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                    title="关闭"
                                    aria-label="关闭"
                                >
                                    <X className="h-4 w-4"/>
                                </button>
                            </div>
                            <textarea
                                ref={modalRef}
                                className={`flex-1 min-h-0 w-full bg-transparent resize-none focus:outline-none p-4 text-sm font-mono leading-relaxed ${modalClassName}`}
                                {...props}
                            />
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    }
);
ExpandableTextarea.displayName = 'ExpandableTextarea';
