/**
 * @module http-utils
 * @description HTTP 工具函数
 */
import fs from 'fs';
import https from 'https';
import http from 'http';
import {TIMEOUTS} from './constants.js';

/**
 * 下载远程文件到本地
 *
 * @param url - 远程文件 URL
 * @param destPath - 本地保存路径
 * @param timeoutMs - 超时时间（默认 HTTP_DOWNLOAD）
 */
export function downloadFile(url: string, destPath: string, timeoutMs: number = TIMEOUTS.HTTP_DOWNLOAD, headers?: Record<string, string>): Promise<void> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, {timeout: timeoutMs, headers: headers ?? {}}, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadFile(res.headers.location, destPath, timeoutMs, headers).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const stream = fs.createWriteStream(destPath);
            res.pipe(stream);
            stream.on('finish', () => {
                stream.close();
                resolve();
            });
            stream.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * 从 URL 中提取图片文件名
 */
export function urlToImageFilename(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const base = pathname.split('/').pop() ?? '';
        if (base && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(base)) return base;
    } catch { /* fallback */ }
    return `image-${Date.now()}.png`;
}
