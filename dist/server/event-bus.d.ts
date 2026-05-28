/**
 * @module event-bus
 * @description 服务端事件总线
 *
 * 基于 Node.js EventEmitter 的轻量级事件总线，用于服务端内部的事件订阅/分发。
 * 在 WebSocket broadcast() 中调用 dispatch()，使服务端服务能监听系统事件，
 * 无需修改现有路由处理代码。
 *
 * 事件流：
 *   Route Handler → broadcast() → eventBus.dispatch() → 服务端订阅者
 *                                       ↓
 *                               WebSocket 推送前端
 */
import { EventEmitter } from 'events';
/**
 * 事件载荷类型
 */
export type EventPayload = {
    type: string;
    data?: unknown;
    [key: string]: unknown;
};
/**
 * 服务端事件总线类
 *
 * 提供类型化事件订阅和通配符订阅两种模式。
 * 所有订阅者的异常会被捕获并记录，不影响其他订阅者和 WebSocket 推送。
 */
declare class EventBus extends EventEmitter {
    /**
     * 分发事件到所有订阅者
     *
     * 先触发类型化监听器，再触发通配符监听器。
     * 每个监听器的异常独立捕获，不会阻断后续监听器或 WebSocket 推送。
     *
     * @param payload - 事件载荷，包含 type 和 data
     */
    dispatch(payload: EventPayload): void;
    /**
     * 订阅特定类型的事件
     *
     * @param type - 事件类型（如 'execution:complete'）
     * @param handler - 事件处理函数
     */
    onEvent(type: string, handler: (data: unknown) => void): void;
    /**
     * 订阅所有事件（通配符）
     *
     * @param handler - 事件处理函数，接收事件类型和数据
     */
    onAny(handler: (type: string, data: unknown) => void): void;
}
/** 全局单例 */
export declare const eventBus: EventBus;
export {};
//# sourceMappingURL=event-bus.d.ts.map