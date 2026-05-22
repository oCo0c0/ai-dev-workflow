/**
 * 请求日志中间件
 *
 * 记录所有 HTTP 请求到本地日志文件。
 * 日志格式：[时间戳] 方法 路径 状态码 耗时ms
 * 日志路径：~/.ai-dev-workbench/logs/app.log
 */

import {Request, Response, NextFunction} from 'express';
import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';

/** 日志文件路径 */
const LOG_FILE = path.join(APP_DATA_DIR, 'logs', 'app.log');

/**
 * 确保日志目录存在
 *
 * 若目录不存在则递归创建。
 */
function ensureLogDir(): void {
    if (!fs.existsSync(path.dirname(LOG_FILE))) {
        fs.mkdirSync(path.dirname(LOG_FILE), {recursive: true});
    }
}

/**
 * 追加写入日志条目
 *
 * 写入失败时静默忽略，不影响主流程。
 *
 * @param entry - 日志条目字符串
 */
function writeLog(entry: string): void {
    try {
        ensureLogDir();
        fs.appendFileSync(LOG_FILE, entry + '\n');
    } catch {
        // 日志写入失败时静默处理
    }
}

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
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - start;
        const timestamp = new Date().toISOString();
        const entry = `[${timestamp}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`;
        writeLog(entry);
    });

    next();
}
