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
const url_1 = require("url");
const constants_js_1 = require("./constants.js");
/** 禁止访问的 URL scheme */
const DISALLOWED_SCHEMES = ['file', 'ftp', 'data', 'javascript', 'vbscript'];
/**
 * 校验下载 URL 是否安全。
 * 仅允许 http/https，禁止 localhost/私有 IP，降低 SSRF 风险。
 *
 * @param url - 待校验的 URL 字符串
 * @throws 当 URL 不合法或不被允许时抛出错误
 */
function validateDownloadUrl(url) {
    let parsed;
    try {
        parsed = new url_1.URL(url);
    }
    catch {
        throw new Error(`Invalid URL: ${url}`);
    }
    if (DISALLOWED_SCHEMES.includes(parsed.protocol.replace(':', ''))) {
        throw new Error(`URL scheme not allowed: ${parsed.protocol}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`URL scheme not allowed: ${parsed.protocol}`);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
        throw new Error('URL points to internal address which is not allowed');
    }
    if (parsed.hostname.match(/^\d+\.\d+\.\d+\.\d+$/)) {
        const parts = parsed.hostname.split('.').map(Number);
        // 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        if (parts[0] === 127 || parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)) {
            throw new Error('URL points to internal address which is not allowed');
        }
    }
}
/**
 * 下载远程文件到本地
 *
 * @param url - 远程文件 URL
 * @param destPath - 本地保存路径
 * @param timeoutMs - 超时时间（默认 HTTP_DOWNLOAD）
 */
function downloadFile(url, destPath, timeoutMs = constants_js_1.TIMEOUTS.HTTP_DOWNLOAD, headers) {
    validateDownloadUrl(url);
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
        const pathname = new url_1.URL(url).pathname;
        const base = pathname.split('/').pop() ?? '';
        if (base && /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(base))
            return base;
    }
    catch { /* fallback */ }
    return `image-${Date.now()}.png`;
}
//# sourceMappingURL=http-utils.js.map