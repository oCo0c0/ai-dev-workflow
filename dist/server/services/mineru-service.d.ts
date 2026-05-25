/**
 * @file mineru-service.ts
 * @description MinerU 文档解析服务
 *
 * 封装 MinerU FastAPI 接口，提供文档/图片/表格解析能力。
 * 支持同步解析和异步任务两种模式。
 *
 * MinerU API 端点：
 * - POST /file_parse  — 同步解析（上传文件，等待结果）
 * - POST /tasks       — 异步解析（提交任务，轮询结果）
 * - GET  /tasks/{id}  — 查询任务状态
 * - GET  /tasks/{id}/result — 获取任务结果
 * - GET  /health      — 健康检查
 */
/** MinerU 服务配置 */
export interface MinerUConfig {
    /** MinerU 服务地址 */
    apiUrl?: string;
    /** 是否启用 MinerU 解析（默认 true） */
    enabled?: boolean;
    /** 默认解析后端（字符串形式，运行时验证） */
    defaultBackend?: string;
    /** 默认语言列表 */
    defaultLangList?: string[];
}
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
 * MinerU 文档解析服务
 */
export declare class MinerUService {
    private config;
    constructor(config: MinerUConfig | undefined);
    isEnabled(): boolean;
    getBaseUrl(): string;
    getStatus(): {
        enabled: boolean;
        apiUrl: string;
    };
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
    /** 提交异步解析任务（本地文件） */
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
    private extractMarkdown;
    /** 提取图片 */
    private extractImages;
    /** MIME 类型映射 */
    private getMimeType;
}
//# sourceMappingURL=mineru-service.d.ts.map