/**
 * WebSocket 服务模块
 *
 * 提供基于 ws 库的 WebSocket 服务，用于服务端向客户端推送实时消息。
 * WebSocket 端点路径：/ws
 *
 * 功能：
 * - 客户端连接管理与消息解析
 * - 广播消息至所有已连接客户端
 * - 向指定客户端发送消息
 */
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
/** WebSocket 消息格式 */
export interface WSMessage {
    /** 消息类型标识 */
    type: string;
    /** 消息数据负载 */
    data?: unknown;
    /** 附加字段（支持任意扩展属性） */
    [key: string]: unknown;
}
/**
 * 初始化 WebSocket 服务
 *
 * 创建 WebSocketServer 并绑定到 HTTP 服务器，监听 /ws 路径。
 * 自动处理客户端连接、消息解析和连接错误。
 *
 * @param server - HTTP 服务器实例
 * @returns 初始化后的 WebSocketServer 实例
 */
export declare function setupWebSocket(server: http.Server): WebSocketServer;
/**
 * 广播消息至所有已连接客户端
 *
 * 仅向处于 OPEN 状态的客户端发送。
 *
 * @param message - 要广播的消息对象
 */
export declare function broadcast(message: WSMessage): void;
/**
 * 向指定客户端发送消息
 *
 * @param ws - 目标客户端连接
 * @param message - 要发送的消息对象
 */
export declare function sendTo(ws: WebSocket, message: WSMessage): void;
//# sourceMappingURL=websocket.d.ts.map