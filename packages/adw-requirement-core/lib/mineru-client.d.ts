/**
 * @file mineru-client.ts
 * @description MinerU 文档解析客户端（纯 HTTP，无 Express 依赖）
 *
 * 从主项目 mineru-service.ts 移植：封装 MinerU FastAPI 接口，提供
 * 文档/图片/表格解析能力，支持同步解析与异步任务两种模式。
 *
 * MinerU API 端点：
 * - POST /file_parse  — 同步解析（上传文件，等待结果）
 * - POST /tasks       — 异步解析（提交任务，轮询结果）
 * - GET  /tasks/{id}  — 查询任务状态
 * - GET  /tasks/{id}/result — 获取任务结果
 * - GET  /health      — 健康检查
 */
/** 解析后端类型 */
export type MinerUBackend = 'pipeline' | 'vlm-auto-engine' | 'vlm-http-client' | 'hybrid-auto-engine' | 'hybrid-http-client';
/** 解析方法 */
export type MinerUParseMethod = 'auto' | 'txt' | 'ocr';
/** 解析请求参数 */
export interface MinerUParseOptions {
    /** OCR 语言列表（默认 ['ch']） */
    langList?: string[];
    /** 解析后端（默认 hybrid-auto-engine） */
    backend?: MinerUBackend;
    /** 解析方法（默认 auto） */
    parseMethod?: MinerUParseMethod;
    /** 启用公式解析（默认 true） */
    formulaEnable?: boolean;
    /** 启用表格解析（默认 true） */
    tableEnable?: boolean;
    /** 启用图片分析（默认 true） */
    imageAnalysis?: boolean;
    /** 是否返回 markdown（默认 true） */
    returnMd?: boolean;
    /** 是否返回中间 JSON */
    returnMiddleJson?: boolean;
    /** 是否返回模型输出 */
    returnModelOutput?: boolean;
    /** 是否返回内容列表 */
    returnContentList?: boolean;
    /** 是否返回提取的图片 */
    returnImages?: boolean;
    /** PDF 起始页（从 0 开始） */
    startPageId?: number;
    /** PDF 结束页 */
    endPageId?: number;
}
/** 异步任务提交结果 */
export interface MinerUTaskSubmitResult {
    /** 任务 ID */
    task_id: string;
    /** 任务状态 */
    status?: string;
    /** 消息 */
    message?: string;
}
/** 异步任务状态 */
export interface MinerUTaskStatus {
    /** 任务 ID */
    task_id: string;
    /** 任务状态：pending / processing / completed / failed */
    status: string;
    /** 进度信息 */
    progress?: number;
    /** 消息 */
    message?: string;
}
/** 解析结果 */
export interface MinerUParseResult {
    /** 是否成功 */
    success: boolean;
    /** Markdown 内容 */
    markdown?: string;
    /** 中间 JSON 数据 */
    middleJson?: unknown;
    /** 模型输出 */
    modelOutput?: unknown;
    /** 内容列表 */
    contentList?: unknown;
    /** 提取的图片列表（base64 编码） */
    images?: string[];
    /** 原始响应数据 */
    raw?: unknown;
    /** 错误信息 */
    error?: string;
}
/**
 * MinerU 文档解析客户端
 */
export declare class MinerUClient {
    private readonly baseUrl;
    /**
     * @param apiUrl - MinerU 服务地址（如 http://127.0.0.1:8000）；空串 = 未配置
     */
    constructor(apiUrl: string | undefined);
    /** 是否已配置 MinerU 服务 */
    isConfigured(): boolean;
    /** 服务地址 */
    getBaseUrl(): string;
    /** 健康检查 */
    healthCheck(): Promise<{
        healthy: boolean;
        latency?: number;
        error?: string;
    }>;
    /** 同步解析本地文件 */
    parseFile(filePath: string, options?: MinerUParseOptions): Promise<MinerUParseResult>;
    /** 同步解析 Buffer 文件 */
    parseBuffer(fileName: string, buffer: Buffer, mimeType: string, options?: MinerUParseOptions): Promise<MinerUParseResult>;
    /** 解析远程 URL 文档（先下载到内存再同步解析） */
    parseUrl(fileUrl: string, options?: MinerUParseOptions): Promise<MinerUParseResult>;
    /** 提交异步解析任务（本地文件），返回提交结果 */
    submitTask(filePath: string, options?: MinerUParseOptions): Promise<MinerUTaskSubmitResult & {
        error?: string;
    }>;
    /** 提交异步解析任务（Buffer） */
    submitTaskBuffer(fileName: string, buffer: Buffer, mimeType: string, options?: MinerUParseOptions): Promise<MinerUTaskSubmitResult & {
        error?: string;
    }>;
    /** 查询异步任务状态 */
    getTaskStatus(taskId: string): Promise<MinerUTaskStatus & {
        error?: string;
    }>;
    /** 获取异步任务结果 */
    getTaskResult(taskId: string): Promise<MinerUParseResult>;
    /**
     * 提交异步任务并轮询到完成（大文件推荐；同步 file_parse 会占住 HTTP 连接）。
     * 状态 completed → 取结果；failed / 超时 → 返回 error。
     */
    parseFileAsync(filePath: string, options?: MinerUParseOptions & {
        pollIntervalMs?: number;
        timeoutMs?: number;
    }): Promise<MinerUParseResult>;
    /** 合并默认选项 */
    private mergeOptions;
    /**
     * 使用 Node 18+ 原生 FormData + Blob 构建 multipart 请求
     *
     * FormData.append 配合 Blob 会自动处理 multipart boundary、
     * Content-Type header 和二进制编码，无需手动拼接。
     */
    private buildFormData;
    /** 解析 MinerU 响应体 */
    private parseResponse;
    /** 从响应对象中提取 markdown（兼容多种字段名） */
    private static extractMarkdown;
    /** 提取图片 */
    private static extractImages;
    /** MIME 类型映射 */
    private static getMimeType;
}
//# sourceMappingURL=mineru-client.d.ts.map