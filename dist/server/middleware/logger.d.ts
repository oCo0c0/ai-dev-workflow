/**
 * 请求日志中间件
 *
 * 记录所有 HTTP 请求到本地日志文件。
 * 日志格式：[时间戳] 方法 路径 状态码 耗时ms
 * 日志路径：~/.ai-dev-workbench/logs/app.log
 */
import { Request, Response, NextFunction } from 'express';
/**
 * 请求日志中间件
 *
 * 在响应完成时记录请求信息：方法、路径、状态码、处理耗时。
 * 日志写入不阻塞请求处理。
 *
 * @param req - Express 请求对象
 * @param res - Express 响应对象
 * @param next - 下一个中间件函数
 */
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=logger.d.ts.map