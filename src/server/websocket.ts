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

import {WebSocketServer, WebSocket} from 'ws';
import http from 'http';
import {eventBus} from './event-bus.js';

/** WebSocket 消息格式 */
export interface WSMessage {
    /** 消息类型标识 */
    type: string;
    /** 消息数据负载 */
    data: unknown;
}

/** WebSocket 服务器实例（模块级单例） */
let wss: WebSocketServer | null = null;

/**
 * 初始化 WebSocket 服务
 *
 * 创建 WebSocketServer 并绑定到 HTTP 服务器，监听 /ws 路径。
 * 自动处理客户端连接、消息解析和连接错误。
 *
 * @param server - HTTP 服务器实例
 * @returns 初始化后的 WebSocketServer 实例
 */
export function setupWebSocket(server: http.Server): WebSocketServer {
    wss = new WebSocketServer({server, path: '/ws'});

    wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString()) as WSMessage;
                handleMessage(ws, msg);
            } catch {
                ws.send(JSON.stringify({type: 'error', data: {message: 'Invalid message format'}}));
            }
        });

        ws.on('error', () => {
            // 静默处理连接错误
        });
    });

    return wss;
}

/**
 * 处理接收到的 WebSocket 消息
 *
 * @param _ws
 * @param _msg - 解析后的消息对象（预留扩展）
 */
function handleMessage(_ws: WebSocket, _msg: WSMessage): void {
    // 消息处理将在后续功能迭代中实现
}

/**
 * 广播消息至所有已连接客户端
 *
 * 仅向处于 OPEN 状态的客户端发送。
 *
 * @param message - 要广播的消息对象
 */
export function broadcast(message: WSMessage): void {
    if (!wss) return;
    // 服务端事件总线分发：订阅服务先处理，异常不阻断 WebSocket 推送
    eventBus.dispatch(message);
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

/**
 * 向指定客户端发送消息
 *
 * @param ws - 目标客户端连接
 * @param message - 要发送的消息对象
 */
export function sendTo(ws: WebSocket, message: WSMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
