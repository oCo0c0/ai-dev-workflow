/**
 * @file useStickToBottom.ts
 * @description 流式内容容器的「贴底跟随」滚动 hook（成熟终端/聊天的主流交互）
 *
 * 行为：
 * - 跟随中：内容增长自动置底（rAF 置底，等当前帧渲染完成）；
 * - 用户向上滚：暂停跟随（滚轮/触摸按方向判定，滚轮一格即响应）；
 * - 向下滚：立即重新跟随 —— 关键设计。流式输出下内容增长快于手动滚动，
 *   「手动滚回底部才恢复」的旧方案在高速输出时永远追不上，表现为永久不滚动；
 * - 暂停期间 UI 可展示「回到底部」按钮（showResume），点击即重新跟随。
 *
 * 滚动行为真值在 pinnedRef（免重渲染）；showResume 仅用于按钮显隐。
 */
import {useCallback, useRef, useState, type TouchEvent, type WheelEvent} from 'react';

export interface StickToBottom<T extends HTMLElement = HTMLDivElement> {
    /** 挂到滚动容器元素上 */
    containerRef: React.RefObject<T>;
    /** 暂停跟随（用户在翻历史）时为 true —— 用于「回到底部」按钮显隐 */
    showResume: boolean;
    /** 跟随状态 ref：effect 里判断「是否需要置底」用（不触发重渲染） */
    pinnedRef: React.MutableRefObject<boolean>;
    /** 绑定到容器的滚动/手势事件 */
    handlers: {
        onScroll: () => void;
        onWheel: (e: WheelEvent<T>) => void;
        onTouchStart: (e: TouchEvent<T>) => void;
        onTouchMove: (e: TouchEvent<T>) => void;
    };
    /** 置底（rAF，等当前帧渲染完成） */
    scrollToBottom: () => void;
    /** 重新跟随并置底（「回到底部」按钮用） */
    pin: () => void;
}

export function useStickToBottom<T extends HTMLElement = HTMLDivElement>(threshold = 80): StickToBottom<T> {
    const containerRef = useRef<T>(null!);
    const pinnedRef = useRef(true);
    const [showResume, setShowResume] = useState(false);
    const lastTouchY = useRef(0);

    const setPinned = useCallback((pinned: boolean) => {
        pinnedRef.current = pinned;
        setShowResume((prev) => (prev === !pinned ? prev : !pinned));
    }, []);

    const isNearBottom = useCallback((): boolean => {
        const el = containerRef.current;
        if (!el) return true;
        return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }, [threshold]);

    const scrollToBottom = useCallback(() => {
        requestAnimationFrame(() => {
            const el = containerRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        });
    }, []);

    // 程序化置底也会触发 scroll 事件，但落点必在底部 → 判定为跟随，无害
    const onScroll = useCallback(() => setPinned(isNearBottom()), [isNearBottom]);

    // 滚轮方向即用户意图：向下=回底部重新跟随，向上=暂停跟随
    const onWheel = useCallback((e: WheelEvent<T>) => setPinned(e.deltaY > 0), []);

    const onTouchStart = useCallback((e: TouchEvent<T>) => {
        lastTouchY.current = e.touches[0]?.clientY ?? 0;
    }, []);

    const onTouchMove = useCallback((e: TouchEvent<T>) => {
        const y = e.touches[0]?.clientY ?? 0;
        const dy = lastTouchY.current - y;
        if (Math.abs(dy) >= 4) setPinned(dy > 0);
        lastTouchY.current = y;
    }, [setPinned]);

    const pin = useCallback(() => {
        setPinned(true);
        scrollToBottom();
    }, [setPinned, scrollToBottom]);

    return {
        containerRef,
        showResume,
        pinnedRef,
        handlers: {onScroll, onWheel, onTouchStart, onTouchMove},
        scrollToBottom,
        pin,
    };
}
