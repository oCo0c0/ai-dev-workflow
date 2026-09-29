/**
 * @file useResizableWidth.ts
 * @description 可拖拽调宽的侧栏宽度（含 localStorage 持久化）。
 *
 * 用途：把「侧边栏占多少宽度」交给用户自己调 —— 执行过程中最该占地方的是消息输出区，
 * 菜单/列表这类辅助区域应当能被压窄。纯逻辑（夹取、读写存储）单独导出，便于确定性验证。
 */
import {useCallback, useEffect, useRef, useState} from 'react';

/** 拖拽手柄宽度约束 */
export interface WidthBounds {
    min: number;
    max: number;
}

/** 把宽度夹取到合法区间（非法输入回退到 fallback） */
export function clampWidth(value: unknown, bounds: WidthBounds, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

/** 读取持久化宽度（读不到/非法 → 默认值） */
export function readStoredWidth(key: string, bounds: WidthBounds, fallback: number): number {
    try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return fallback;
        return clampWidth(JSON.parse(raw), bounds, fallback);
    } catch {
        return fallback;
    }
}

/** 持久化宽度（失败静默：隐私模式/配额满不影响使用） */
export function storeWidth(key: string, value: number): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch { /* 忽略 */ }
}

export interface ResizableWidth {
    /** 当前宽度（px） */
    width: number;
    /** 是否正在拖拽（拖拽中关闭过渡动画，避免跟手迟滞） */
    dragging: boolean;
    /** 绑定到手柄的 onPointerDown */
    onHandlePointerDown: (e: React.PointerEvent) => void;
    /** 恢复到默认宽度 */
    reset: () => void;
}

/**
 * 可拖拽调宽。拖拽用 pointer 事件 + 指针捕获（鼠标移出手柄也能继续拖）。
 *
 * @param key - localStorage 键（不同侧栏各存一份）
 * @param defaultWidth - 默认宽度
 * @param bounds - 最小/最大宽度
 */
export function useResizableWidth(key: string, defaultWidth: number, bounds: WidthBounds): ResizableWidth {
    const [width, setWidth] = useState(() => readStoredWidth(key, bounds, defaultWidth));
    const [dragging, setDragging] = useState(false);
    const dragRef = useRef<{startX: number; startWidth: number} | null>(null);

    const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture?.(e.pointerId);
        dragRef.current = {startX: e.clientX, startWidth: readStoredWidth(key, bounds, defaultWidth)};
        setDragging(true);
    }, [key, bounds, defaultWidth]);

    useEffect(() => {
        if (!dragging) return;
        const onMove = (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            setWidth(clampWidth(drag.startWidth + (e.clientX - drag.startX), bounds, defaultWidth));
        };
        const onUp = () => {
            dragRef.current = null;
            setDragging(false);
            setWidth((w) => {
                storeWidth(key, w);
                return w;
            });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [dragging, key, bounds, defaultWidth]);

    const reset = useCallback(() => {
        setWidth(defaultWidth);
        storeWidth(key, defaultWidth);
    }, [key, defaultWidth]);

    return {width, dragging, onHandlePointerDown, reset};
}

/**
 * 拖拽手柄（放在侧栏右边缘内侧；双击恢复默认宽度）。
 */
export function ResizeHandle({dragging, onPointerDown, onDoubleClick, title}: {
    dragging: boolean;
    onPointerDown: (e: React.PointerEvent) => void;
    onDoubleClick?: () => void;
    title?: string;
}) {
    return (
        <div
            role="separator"
            aria-orientation="vertical"
            title={title ?? '拖动调整宽度（双击恢复默认）'}
            onPointerDown={onPointerDown}
            onDoubleClick={onDoubleClick}
            className={`absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize select-none transition-colors ${
                dragging ? 'bg-primary/60' : 'bg-transparent hover:bg-primary/40'
            }`}
        />
    );
}
