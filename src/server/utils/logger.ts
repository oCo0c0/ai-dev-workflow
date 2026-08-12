/**
 * @module logger
 * @description 统一日志工具
 *
 * 基于 console 的轻量封装，为每个模块提供带命名空间的日志器。
 * 所有日志调用统一经过此模块，便于后续接入结构化日志系统（如 pino/winston）。
 *
 * 使用方式：
 *   import { createLogger } from '../utils/logger.js';
 *   const log = createLogger('module-name');
 *   log.info('message');
 *   log.warn('something odd');
 *   log.error('failure', err);
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/** 当前生效的最低日志级别。可通过环境变量 LOG_LEVEL 覆盖，默认 info */
let currentLevel: LogLevel = 'info';

const envLevel = (process.env.LOG_LEVEL ?? '').toLowerCase() as LogLevel;
if (envLevel in LOG_LEVELS) {
    currentLevel = envLevel;
}

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

/**
 * 为指定模块/标签创建一个日志器
 *
 * @param tag - 模块标识（如 'coordinator'、'plan'、'tests:ai'），自动加方括号
 * @returns 提供 info/warn/error/debug 方法的 Logger 对象
 */
export function createLogger(tag: string): Logger {
    const prefix = `[${tag}]`;

    function shouldLog(level: LogLevel): boolean {
        return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
    }

    return {
        debug(msg: string, ...args: unknown[]): void {
            if (!shouldLog('debug')) return;
            console.debug(`${prefix} ${msg}`, ...args);
        },
        info(msg: string, ...args: unknown[]): void {
            if (!shouldLog('info')) return;
            console.log(`${prefix} ${msg}`, ...args);
        },
        warn(msg: string, ...args: unknown[]): void {
            if (!shouldLog('warn')) return;
            console.warn(`${prefix} ${msg}`, ...args);
        },
        error(msg: string, ...args: unknown[]): void {
            // error 始终输出，不受日志级别限制
            console.error(`${prefix} ${msg}`, ...args);
        },
    };
}
