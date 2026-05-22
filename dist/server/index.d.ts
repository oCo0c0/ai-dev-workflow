/**
 * 服务端核心模块
 *
 * 应用服务器工厂函数，负责：
 * 1. 创建 Express 应用并注册全局中间件（CORS、JSON 解析、请求日志）
 * 2. 实例化所有业务服务（MCP配置、MCP桥接、工作区、CLI运行器、测试执行器、技能、流水线、需求存储）
 * 3. 注册所有 API 路由模块（/api/*）
 * 4. 配置静态文件服务和 SPA 回退
 * 5. 创建 HTTP 服务器并初始化 WebSocket
 */
import http from 'http';
/**
 * 创建并启动应用服务器
 *
 * 组装完整的 HTTP + WebSocket 服务：
 * - 注册 CORS、JSON 解析、请求日志中间件
 * - 实例化 8 个业务服务并注入路由
 * - 注册 9 组 API 路由
 * - 配置前端静态资源和 SPA 回退
 * - 初始化 WebSocket 服务（路径 /ws）
 *
 * @param port - 服务监听端口号
 * @returns 已启动监听的 HTTP Server 实例
 */
export declare function createServer(port: number): Promise<http.Server>;
//# sourceMappingURL=index.d.ts.map