/**
 * 下载远程文件到本地
 *
 * @param url - 远程文件 URL
 * @param destPath - 本地保存路径
 * @param timeoutMs - 超时时间（默认 HTTP_DOWNLOAD）
 */
export declare function downloadFile(url: string, destPath: string, timeoutMs?: number, headers?: Record<string, string>): Promise<void>;
/**
 * 从 URL 中提取图片文件名
 */
export declare function urlToImageFilename(url: string): string;
//# sourceMappingURL=http-utils.d.ts.map