"use strict";
/**
 * 端口查找模块
 *
 * 提供可用端口探测功能，优先使用用户配置的首选端口，
 * 若不可用则在指定范围内自动扫描。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAvailablePort = findAvailablePort;
const net_1 = __importDefault(require("net"));
/**
 * 检测指定端口是否可用
 *
 * 通过尝试在 127.0.0.1 上创建 TCP 服务来验证端口可用性。
 *
 * @param port - 待检测的端口号
 * @returns 端口可用返回 true，否则返回 false
 */
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net_1.default.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}
/**
 * 查找可用端口
 *
 * 查找策略：
 * 1. 优先尝试用户配置的首选端口（必须在 1024-65535 范围内）
 * 2. 若首选端口不可用或未配置，则在 rangeStart ~ rangeEnd 范围内顺序扫描
 * 3. 若扫描范围内无可用端口，抛出错误
 *
 * @param options - 端口查找配置
 * @returns 包含端口号和是否为首选端口的结果
 * @throws 当扫描范围内无可用端口时抛出错误
 */
async function findAvailablePort(options = {}) {
    const { preferredPort, rangeStart = 3000, rangeEnd = 9000 } = options;
    // 优先尝试首选端口
    if (preferredPort && preferredPort >= 1024 && preferredPort <= 65535) {
        if (await isPortAvailable(preferredPort)) {
            return { port: preferredPort, isPreferred: true };
        }
    }
    // 在指定范围内顺序扫描可用端口
    for (let port = rangeStart; port <= rangeEnd; port++) {
        if (await isPortAvailable(port)) {
            return { port, isPreferred: false };
        }
    }
    throw new Error(`No available port found in range ${rangeStart}-${rangeEnd}. Please check for port conflicts.`);
}
//# sourceMappingURL=port-finder.js.map