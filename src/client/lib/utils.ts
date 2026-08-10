/**
 * @file 通用工具函数模块
 * @description 提供前端应用中常用的工具函数，包括 Tailwind CSS 类名合并、
 *              相对时间格式化等功能。这些函数为纯函数，无副作用，
 *              可在任意组件或模块中安全引用。
 */

import {type ClassValue, clsx} from 'clsx';
import {twMerge} from 'tailwind-merge';

/**
 * 合并并去重 Tailwind CSS 类名
 *
 * 结合 clsx 的条件类名拼接能力和 tailwind-merge 的智能去重能力，
 * 解决 Tailwind CSS 中同类名冲突的问题（如 "px-2 px-4" 自动合并为 "px-4"）。
 *
 * @param inputs - 类名输入，支持字符串、对象、数组等多种格式（clsx ClassValue 类型）
 * @returns 合并去重后的最终类名字符串
 *
 * @example
 * cn('px-2 py-1', 'px-4')            // => 'py-1 px-4'
 * cn('text-red-500', condition && 'text-blue-500')  // => 'text-red-500' 或 'text-blue-500'
 */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/**
 * 将 ISO 8601 日期字符串格式化为相对时间描述
 *
 * 根据当前时间与给定时间的差值，自动选择最合适的显示单位：
 *   - 不足 1 分钟 → "just now"
 *   - 不足 60 分钟 → "Xm ago"（如 "3m ago"）
 *   - 不足 24 小时 → "Xh ago"（如 "2h ago"）
 *   - 超过 24 小时 → "Xd ago"（如 "5d ago"）
 *
 * @param iso - ISO 8601 格式的日期时间字符串
 * @returns 相对时间描述字符串
 */
export function formatRelativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

/**
 * 判断日志条目是否为用户消息。
 * 兼容旧格式（**User:** 前缀）和新格式（JSON {type: 'user', content: '...'}）。
 */
export function isUserMessage(log: string): boolean {
    try {
        const parsed = JSON.parse(log);
        return parsed.type === 'user';
    } catch {
        return log.startsWith('**User:**');
    }
}
