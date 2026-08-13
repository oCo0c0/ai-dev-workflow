/**
 * @file 可放大内容组件
 * @description 在内容右上角悬浮一个「放大」按钮，点击后弹出全屏弹窗完整展示内容。
 *   用于 Markdown 渲染、日志、报告等展示型区域，解决局部容器限高导致内容看不全的问题。
 *   弹窗内会移除内部容器的 max-height 限制，让长内容完整展示（配合 index.css 的 expand-modal-body）。
 */

import * as React from 'react';
import {useState, useEffect} from 'react';
import {createPortal} from 'react-dom';
import {Maximize2, X} from 'lucide-react';

interface ExpandableContentProps {
    /** 展示的内容（弹窗中会完整展示，仅渲染 content，不含外部遮罩等） */
    children: React.ReactNode;
    /** 弹窗标题 */
    title?: string;
    /** 外层容器额外类名 */
    className?: string;
    /** 弹窗内容容器额外类名（用于调整弹窗最大宽度等） */
    modalClassName?: string;
    /** 放大按钮位置类名，默认右上角 */
    buttonClassName?: string;
}

export const ExpandableContent = React.forwardRef<HTMLDivElement, ExpandableContentProps>(
    (
        {
            children,
            title,
            className = '',
            modalClassName = '',
            buttonClassName = 'top-2 right-2',
        },
        ref
    ) => {
        const [expanded, setExpanded] = useState(false);

        // 支持 Esc 关闭弹窗
        useEffect(() => {
            if (!expanded) return;
            const onKey = (e: KeyboardEvent) => {
                if (e.key === 'Escape') setExpanded(false);
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        }, [expanded]);

        return (
            <div ref={ref} className={`relative group ${className}`}>
                {children}

                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    title="放大查看"
                    aria-label="放大查看"
                    className={`absolute ${buttonClassName} z-30 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-popover text-muted-foreground shadow-sm opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 focus-visible:opacity-100 focus-visible:scale-100 transition-all duration-150 hover:bg-accent hover:text-primary`}
                >
                    <Maximize2 className="h-4 w-4"/>
                </button>

                {expanded && createPortal(
                    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
                        <div
                            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => setExpanded(false)}
                        />
                        <div className="relative z-10 w-full max-w-6xl mx-4 glass-panel rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                                <span className="text-sm font-medium">{title || '查看内容'}</span>
                                <button
                                    onClick={() => setExpanded(false)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                    title="关闭"
                                    aria-label="关闭"
                                >
                                    <X className="h-4 w-4"/>
                                </button>
                            </div>
                            <div className={`expand-modal-body flex-1 min-h-0 overflow-y-auto p-4 ${modalClassName}`}>
                                {children}
                            </div>
                        </div>
                    </div>,
                    document.body
                )}
            </div>
        );
    }
);
ExpandableContent.displayName = 'ExpandableContent';
