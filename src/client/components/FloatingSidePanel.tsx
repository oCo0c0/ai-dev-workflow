/**
 * @file FloatingSidePanel.tsx
 * @description 右侧悬浮侧栏 —— 从屏幕右侧滑出、覆盖在内容之上，不影响主页面布局。
 *
 *   设计要点（对齐「别影响主页面」的诉求）：
 *   - Portal 到 document.body + fixed 定位：不参与页面 flex 布局，主内容不会被挤压变窄
 *     （也规避了 glass-card 的 backdrop-filter 劫持 fixed 基准的问题）；
 *   - 从左边缘滑出/滑入（framer-motion），带阴影与玻璃底；宽度可拖拽并夹取范围；
 *   - 不加遮罩层：悬浮层不阻断主页面的操作，关闭用右上角按钮或 Esc。
 */

import {useEffect, type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {AnimatePresence, motion} from 'framer-motion';
import {X} from 'lucide-react';

interface FloatingSidePanelProps {
    open: boolean;
    title: string;
    /** 面板宽度（px） */
    width: number;
    /** 拖拽调整宽度（调用方负责夹取与持久化） */
    onWidthChange: (width: number) => void;
    onClose: () => void;
    children: ReactNode;
    /** 最小宽度，默认 360 */
    minWidth?: number;
    /** 最大宽度，默认视口宽的 85% */
    maxWidth?: number;
}

export function FloatingSidePanel({
    open,
    title,
    width,
    onWidthChange,
    onClose,
    children,
    minWidth = 360,
    maxWidth,
}: FloatingSidePanelProps) {
    // Esc 关闭
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    /** 左边缘拖拽调整宽度 */
    const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = width;
        const max = maxWidth ?? Math.round(window.innerWidth * 0.85);
        const onMove = (ev: MouseEvent) => {
            const next = startW - (ev.clientX - startX);
            onWidthChange(Math.min(max, Math.max(minWidth, next)));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    if (typeof document === 'undefined') return null;

    return createPortal(
        <AnimatePresence>
            {open && (
                <motion.div
                    key="floating-side-panel"
                    initial={{x: '100%', opacity: 0.6}}
                    animate={{x: 0, opacity: 1}}
                    exit={{x: '100%', opacity: 0.4}}
                    transition={{type: 'spring', damping: 32, stiffness: 320}}
                    className="fixed inset-y-0 right-0 z-[9000] flex flex-col glass-panel border-l border-border shadow-2xl"
                    style={{width}}
                    role="complementary"
                    aria-label={title}
                >
                    {/* 左边缘拖拽手柄 */}
                    <div
                        className="absolute inset-y-0 -left-1 w-2 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-20"
                        onMouseDown={startResize}
                        title="拖拽调整宽度"
                    />
                    {/* 标题栏 */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                        <span className="label-strong text-xs uppercase tracking-wide truncate">{title}</span>
                        <button
                            onClick={onClose}
                            className="p-1 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                            title="关闭（Esc）"
                            aria-label="关闭"
                        >
                            <X className="h-4 w-4"/>
                        </button>
                    </div>
                    {/* 内容 */}
                    <div className="flex-1 min-h-0">
                        {children}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>,
        document.body,
    );
}
