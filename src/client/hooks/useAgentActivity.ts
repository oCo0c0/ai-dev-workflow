/**
 * @file useAgentActivity.ts
 * @description Agent 活动状态推导 —— 驱动吉祥物（Bongo Cat）的敲键盘动画与状态气泡
 *
 * 独立持有一条 /ws WebSocket 连接（与应用主连接互不干扰；宠物悬浮窗口也用同一
 * hook，天然复用）。把服务端事件流归纳为四个心情：
 * - typing：近期有输出/进度事件（execution:output、plan:progress、test:output、
 *   agent-execution:*、task:log）→ 猫敲键盘；
 * - happy / sad：收到 *:complete 类事件后按成败闪现 4 秒；
 * - idle：3 秒无活动。
 */
import {useEffect, useState} from 'react';
import type {MascotMood} from '../components/mascot/pets';

/** 活动判定的事件前缀/精确类型（与服务端 EventBus 广播对齐） */
const TYPING_EVENTS = new Set([
    'execution:output',
    'plan:progress',
    'test:output',
    'test:phase_change',
    'task:log',
]);

/** 气泡文案 i18n 键（按最近事件类型归类） */
function labelKeyOf(type: string): string {
    if (type.startsWith('execution:')) return 'settings.mascot.actExecution';
    if (type.startsWith('plan:')) return 'settings.mascot.actPlan';
    if (type.startsWith('test:')) return 'settings.mascot.actTest';
    if (type.startsWith('agent-execution:')) return 'settings.mascot.actAgent';
    if (type.startsWith('task:')) return 'settings.mascot.actTask';
    return 'settings.mascot.actBusy';
}

/** 输出停止多久后回到 idle（ms） */
const TYPING_HOLD_MS = 3000;
/** 完成/失败表情闪现时长（ms） */
const RESULT_HOLD_MS = 4000;

export interface AgentActivity {
    mood: MascotMood;
    /** 气泡文案的 i18n 键（idle 时为 null） */
    labelKey: string | null;
}

/** 模块级单例连接：多个 hook 消费者共享一条 WS */
let sharedWs: WebSocket | null = null;
let refCount = 0;
let lastActivityAt = 0;
let lastLabelKey: string | null = null;
let result: {mood: MascotMood; until: number} | null = null;
const listeners = new Set<() => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
    for (const fn of listeners) fn();
}

function handleEvent(type: string, data: unknown): void {
    const isComplete = type.endsWith(':complete');
    if (isComplete) {
        const status = (data as {status?: string} | undefined)?.status;
        const failed = status === 'failed' || status === 'error' || status === 'aborted';
        result = {mood: failed ? 'sad' : 'happy', until: Date.now() + RESULT_HOLD_MS};
        lastLabelKey = failed ? 'settings.mascot.doneFailed' : 'settings.mascot.doneOk';
        lastActivityAt = Date.now();
        notify();
        return;
    }
    if (TYPING_EVENTS.has(type) || type.startsWith('agent-execution:')) {
        lastActivityAt = Date.now();
        lastLabelKey = labelKeyOf(type);
        notify();
    }
}

function ensureConnection(): void {
    if (sharedWs) return;
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    try {
        sharedWs = new WebSocket(`${proto}${location.host}/ws`);
    } catch {
        scheduleReconnect();
        return;
    }
    sharedWs.onmessage = (msg) => {
        try {
            const parsed = JSON.parse(String(msg.data)) as {type?: string; data?: unknown};
            if (parsed.type) handleEvent(parsed.type, parsed.data);
        } catch { /* 非 JSON 消息忽略 */ }
    };
    sharedWs.onclose = () => {
        sharedWs = null;
        scheduleReconnect();
    };
    sharedWs.onerror = () => {
        try { sharedWs?.close(); } catch { /* ignore */ }
    };
}

function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (refCount > 0) ensureConnection();
    }, 3000);
}

function computeActivity(): AgentActivity {
    const now = Date.now();
    if (result && now < result.until) {
        return {mood: result.mood, labelKey: lastLabelKey};
    }
    if (result && now >= result.until) result = null;
    if (now - lastActivityAt < TYPING_HOLD_MS && lastLabelKey) {
        return {mood: 'typing', labelKey: lastLabelKey};
    }
    return {mood: 'idle', labelKey: null};
}

/**
 * 订阅 agent 活动状态（组件级 hook）
 *
 * 内部 300ms 节拍重算（typing 超时/表情闪现到期都需要时间推进），
 * 状态未变化时返回同一对象引用，避免无谓重渲染。
 */
export function useAgentActivity(): AgentActivity {
    const [activity, setActivity] = useState<AgentActivity>(() => computeActivity());

    useEffect(() => {
        refCount += 1;
        ensureConnection();
        listeners.add(onChange);
        // 节拍：活动超时/表情到期时触发重算
        const tick = setInterval(onChange, 300);
        function onChange(): void {
            const next = computeActivity();
            setActivity((prev) =>
                prev.mood === next.mood && prev.labelKey === next.labelKey ? prev : next
            );
        }
        return () => {
            listeners.delete(onChange);
            clearInterval(tick);
            refCount -= 1;
            // 无消费者时保留连接 5 秒再关（页面内切换组件不反复重连）
            if (refCount === 0) {
                setTimeout(() => {
                    if (refCount === 0 && sharedWs) {
                        const ws = sharedWs;
                        sharedWs = null;
                        try { ws.close(); } catch { /* ignore */ }
                    }
                }, 5000);
            }
        };
    }, []);

    return activity;
}
