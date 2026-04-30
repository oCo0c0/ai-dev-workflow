import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

export interface WSMessage {
  type: string;
  data: unknown;
}

let wss: WebSocketServer | null = null;

export function setupWebSocket(server: http.Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as WSMessage;
        handleMessage(ws, msg);
      } catch {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message format' } }));
      }
    });

    ws.on('error', () => {
      // Silently handle connection errors
    });
  });

  return wss;
}

function handleMessage(_ws: WebSocket, _msg: WSMessage): void {
  // Message handling will be implemented as features are added
}

export function broadcast(message: WSMessage): void {
  if (!wss) return;
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

export function sendTo(ws: WebSocket, message: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
