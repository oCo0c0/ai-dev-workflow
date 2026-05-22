"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocket = setupWebSocket;
exports.broadcast = broadcast;
exports.sendTo = sendTo;
const ws_1 = require("ws");
const event_bus_js_1 = require("./event-bus.js");
/** WebSocket 服务器实例（模块级单例） */
let wss = null;
/**
 * 初始化 WebSocket 服务
 *
 * 创建 WebSocketServer 并绑定到 HTTP 服务器，监听 /ws 路径。
 * 自动处理客户端连接、消息解析和连接错误。
 *
 * @param server - HTTP 服务器实例
 * @returns 初始化后的 WebSocketServer 实例
 */
function setupWebSocket(server) {
    wss = new ws_1.WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                handleMessage(ws, msg);
            }
            catch {
                ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message format' } }));
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
function handleMessage(_ws, _msg) {
    // 消息处理将在后续功能迭代中实现
}
/**
 * 广播消息至所有已连接客户端
 *
 * 仅向处于 OPEN 状态的客户端发送。
 *
 * @param message - 要广播的消息对象
 */
function broadcast(message) {
    if (!wss)
        return;
    // 服务端事件总线分发：订阅服务先处理，异常不阻断 WebSocket 推送
    event_bus_js_1.eventBus.dispatch(message);
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
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
function sendTo(ws, message) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}
//# sourceMappingURL=websocket.js.map