/**
 * @file WebSocket 通信 Hook
 * @description 提供 React Hook，管理与后端的 WebSocket 长连接。
 *              支持自动重连机制（指数退避策略，最多重试 5 次），
 *              并将接收到的各类服务端消息分发到全局状态管理（Zustand Store）中。
 *
 *              处理的消息类型包括:
 *                - plan:progress / plan:complete: 计划生成进度与完成通知
 *                - execution:output / execution:step_complete / execution:complete: 执行状态更新
 *                - test:output / test:complete: 测试输出与结果
 *                - error: 服务端错误消息
 */

import {useEffect, useRef, useCallback} from 'react';
import {useAppStore} from '../stores/app-store';

/** 最大重连次数 */
const MAX_RETRIES = 5;
/** 基础重连延迟（毫秒），实际延迟 = BASE_DELAY * 2^attempt */
const BASE_DELAY = 1000; // 1 秒

/**
 * 计算指数退避延迟时间
 *
 * 采用指数退避算法，每次重试的等待时间翻倍，
 * 有效避免在网络故障时对服务端造成请求风暴。
 *
 * @param attempt - 当前重试次数（从 0 开始）
 * @param baseDelay - 基础延迟时间（毫秒），默认 1000ms
 * @returns 本次重试应等待的延迟时间（毫秒）
 *
 * @example
 * calculateBackoff(0) // => 1000  (1s)
 * calculateBackoff(1) // => 2000  (2s)
 * calculateBackoff(2) // => 4000  (4s)
 * calculateBackoff(3) // => 8000  (8s)
 */
export function calculateBackoff(attempt: number, baseDelay: number = BASE_DELAY): number {
    return baseDelay * Math.pow(2, attempt);
}

/**
 * WebSocket 连接管理 Hook
 *
 * 功能特性:
 *   - 组件挂载时自动建立 WebSocket 连接
 *   - 连接断开后按指数退避策略自动重连（最多 5 次）
 *   - 连接成功后重置重试计数器
 *   - 根据消息类型自动分发到对应的 Store action
 *   - 组件卸载时清理连接和定时器，防止内存泄漏
 *
 * @returns 包含 WebSocket 连接状态的对象
 */
export function useWebSocket() {
    /** WebSocket 实例引用 */
    const wsRef = useRef<WebSocket | null>(null);
    /** 当前已重试次数 */
    const retriesRef = useRef(0);
    /** 重连定时器引用，用于组件卸载时清除 */
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 从全局 Store 中获取所需的 action 方法
    const setWsConnected = useAppStore((s) => s.setWsConnected);
    const addExecutionLog = useAppStore((s) => s.addExecutionLog);
    const setExecutionStatus = useAppStore((s) => s.setExecutionStatus);
    const setExecutionId = useAppStore((s) => s.setExecutionId);
    const setTestResults = useAppStore((s) => s.setTestResults);
    const setTestRunning = useAppStore((s) => s.setTestRunning);
    const setTestPhase = useAppStore((s) => s.setTestPhase);
    const setPlanStatus = useAppStore((s) => s.setPlanStatus);
    const addPlanLog = useAppStore((s) => s.addPlanLog);

    /**
     * WebSocket 消息处理回调
     *
     * 接收服务端推送的 JSON 消息，根据消息类型（type 字段）执行相应的业务逻辑，
     * 更新全局状态。非 JSON 格式的消息将被静默忽略。
     */
    const handleMessage = useCallback(
        (event: MessageEvent) => {
            try {
                const message = JSON.parse(event.data);

                switch (message.type) {
                    // 计划生成进度：更新状态为"生成中"并追加流式日志
                    case 'plan:progress':
                        setPlanStatus('generating');
                        if (message.data?.content) {
                            addPlanLog(message.data.content);
                        }
                        break;

                    // 计划生成完成：根据结果状态切换为"就绪"、"暂停"、"空闲"或"失败"
                    case 'plan:complete':
                        if (message.data?.status === 'ready') {
                            setPlanStatus('ready');
                        } else if (message.data?.status === 'paused') {
                            setPlanStatus('paused');
                        } else if (message.data?.status === 'failed') {
                            setPlanStatus('idle');
                            if (message.data?.error) {
                                addPlanLog(`\n[ERROR] ${message.data.error}`);
                            }
                        } else {
                            setPlanStatus('idle');
                        }
                        break;

                    // 执行输出：将实时输出追加到执行日志
                    case 'execution:output':
                        addExecutionLog({
                            timestamp: new Date().toISOString(),
                            stepIndex: message.data.stepIndex ?? 0,
                            type: 'output',
                            content: message.data.content,
                        });
                        // 同步更新当前执行 ID，用于追踪执行上下文
                        if (message.data.executionId) {
                            setExecutionId(message.data.executionId);
                        }
                        break;

                    // 执行步骤完成：记录步骤状态（成功/失败）到日志
                    case 'execution:step_complete':
                        addExecutionLog({
                            timestamp: new Date().toISOString(),
                            stepIndex: message.data.stepIndex ?? 0,
                            type: message.data.status === 'success' ? 'info' : 'error',
                            content: `Step ${message.data.stepIndex} ${message.data.status}`,
                        });
                        break;

                    // 执行全部完成：更新执行状态为"已完成"或"已失败"
                    case 'execution:complete':
                        setExecutionStatus({
                            executionId: message.data.executionId || '',
                            planId: '',
                            currentStep: message.data.stepsCompleted || 0,
                            totalSteps: message.data.stepsCompleted || 0,
                            status: message.data.status === 'completed' ? 'completed' : 'failed',
                            startedAt: '',
                            completedAt: new Date().toISOString(),
                        });
                        if (message.data.executionId) {
                            setExecutionId(message.data.executionId);
                        }
                        break;

                    // 测试输出：将测试过程的实时输出追加到执行日志
                    case 'test:output':
                        addExecutionLog({
                            timestamp: new Date().toISOString(),
                            stepIndex: 0,
                            type: 'output',
                            content: message.data.content,
                        });
                        break;

                    // 沙箱测试阶段变更
                    case 'test:phase_change':
                        setTestPhase(message.data.phase, message.data.label);
                        break;

                    // 测试完成：保存测试结果并标记测试运行结束
                    case 'test:complete':
                        setTestResults(message.data);
                        setTestRunning(false);
                        setTestPhase(null, null);
                        break;

                    // 服务端错误：将错误信息记录到执行日志，并退出 generating 状态
                    case 'error':
                        addExecutionLog({
                            timestamp: new Date().toISOString(),
                            stepIndex: 0,
                            type: 'error',
                            content: message.data.message,
                        });
                        // 如果当前正在生成计划，强制退出 generating 状态
                        if (message.data.message?.includes('Plan generation failed')) {
                            setPlanStatus('idle');
                            addPlanLog(`\n[ERROR] ${message.data.message}`);
                        }
                        break;
                }
            } catch {
                // 非标准 JSON 消息，静默忽略（如心跳帧等）
            }
        },
        [addExecutionLog, addPlanLog, setExecutionId, setExecutionStatus, setPlanStatus, setTestResults, setTestRunning, setTestPhase]
    );

    /**
     * 建立 WebSocket 连接
     *
     * 根据当前页面协议自动选择 ws: 或 wss: 协议，
     * 连接成功后重置重试计数器，连接断开后启动指数退避重连。
     */
    const connect = useCallback(() => {
        // 根据当前页面协议自动判断使用 ws 还是 wss
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        // 连接建立成功：更新连接状态并重置重试计数
        ws.onopen = () => {
            setWsConnected(true);
            retriesRef.current = 0; // 重置重试计数器，以便下次断开时从 0 开始
        };

        // 接收消息：委托给 handleMessage 处理
        ws.onmessage = handleMessage;

        // 连接关闭：清理引用并在未超过最大重试次数时启动退避重连
        ws.onclose = () => {
            setWsConnected(false);
            wsRef.current = null;

            // 未超过最大重试次数时，按指数退避延迟后尝试重连
            if (retriesRef.current < MAX_RETRIES) {
                const delay = calculateBackoff(retriesRef.current);
                reconnectTimerRef.current = setTimeout(() => {
                    retriesRef.current++;
                    connect();
                }, delay);
            }
        };

        // 连接出错：主动关闭连接（会触发 onclose，在那里处理重连逻辑）
        ws.onerror = () => {
            // onclose 会在 onerror 之后被调用，重连逻辑统一在 onclose 中处理
            ws.close();
        };
    }, [handleMessage, setWsConnected]);

    // 组件挂载时建立连接，卸载时清理资源
    useEffect(() => {
        connect();

        return () => {
            // 清理：取消待执行的重连定时器
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
            // 清理：关闭活跃的 WebSocket 连接
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connect]);

    return {
        /** 当前 WebSocket 连接是否处于已连接状态 */
        connected: useAppStore((s) => s.ws.connected),
    };
}
