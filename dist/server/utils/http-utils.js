"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadFile = downloadFile;
exports.urlToImageFilename = urlToImageFilename;
/**
 * @module http-utils
 * @description HTTP 工具函数
 */
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const constants_js_1 = require("./constants.js");
/**
 * 下载远程文件到本地
 *
 * @param url - 远程文件 URL
 * @param destPath - 本地保存路径
 * @param timeoutMs - 超时时间（默认 HTTP_DOWNLOAD）
 */
function downloadFile(url, destPath, timeoutMs = constants_js_1.TIMEOUTS.HTTP_DOWNLOAD, headers) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https_1.default : http_1.default;
        client.get(url, { timeout: timeoutMs, headers: headers ?? {} }, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                downloadFile(res.headers.location, destPath, timeoutMs, headers).then(resolve).catch(reject);
                return;
            }
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const stream = fs_1.default.createWriteStream(destPath);
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
function urlToImageFilename(url) {
    try {
        const pathname = new URL(url).pathname;
        const base = pathname.split('/').pop() ?? '';
        if (base && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(base))
            return base;
    }
    catch { /* fallback */ }
    return `image-${Date.now()}.png`;
}
//# sourceMappingURL=http-utils.js.map