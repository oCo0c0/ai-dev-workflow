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

import fs from 'fs';
import path from 'path';
import {getErrorMessage} from './error-utils.js';

/** 解析后端类型 */
export type MinerUBackend =
    | 'pipeline'
    | 'vlm-auto-engine'
    | 'vlm-http-client'
    | 'hybrid-auto-engine'
    | 'hybrid-http-client';

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
export class MinerUClient {
    private readonly baseUrl: string;

    /**
     * @param apiUrl - MinerU 服务地址（如 http://127.0.0.1:8000）；空串 = 未配置
     */
    constructor(apiUrl: string | undefined) {
        this.baseUrl = (apiUrl ?? '').trim().replace(/\/+$/, '');
    }

    /** 是否已配置 MinerU 服务 */
    isConfigured(): boolean {
        return this.baseUrl !== '';
    }

    /** 服务地址 */
    getBaseUrl(): string {
        return this.baseUrl;
    }

    /** 健康检查 */
    async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
        if (!this.isConfigured()) {
            return {healthy: false, error: 'MinerU service is not configured'};
        }
        const start = Date.now();
        try {
            const res = await fetch(`${this.baseUrl}/health`);
            const latency = Date.now() - start;
            return {healthy: res.ok, latency, error: res.ok ? undefined : `HTTP ${res.status}`};
        } catch (err) {
            return {healthy: false, latency: Date.now() - start, error: getErrorMessage(err)};
        }
    }

    /** 同步解析本地文件 */
    async parseFile(filePath: string, options?: MinerUParseOptions): Promise<MinerUParseResult> {
        if (!this.isConfigured()) return {success: false, error: 'MinerU service is not configured'};
        if (!fs.existsSync(filePath)) return {success: false, error: `File not found: ${filePath}`};

        const fileName = path.basename(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        const mimeType = MinerUClient.getMimeType(fileName);
        return this.parseBuffer(fileName, fileBuffer, mimeType, options);
    }

    /** 同步解析 Buffer 文件 */
    async parseBuffer(
        fileName: string,
        buffer: Buffer,
        mimeType: string,
        options?: MinerUParseOptions,
    ): Promise<MinerUParseResult> {
        if (!this.isConfigured()) return {success: false, error: 'MinerU service is not configured'};

        try {
            const fd = this.buildFormData(fileName, buffer, mimeType, options);
            const res = await fetch(`${this.baseUrl}/file_parse`, {
                method: 'POST',
                body: fd,
            });

            if (!res.ok) {
                const text = await res.text();
                return {success: false, error: `MinerU HTTP ${res.status}: ${text.substring(0, 500)}`};
            }

            const text = await res.text();
            return this.parseResponse(text);
        } catch (err) {
            return {success: false, error: getErrorMessage(err)};
        }
    }

    /** 解析远程 URL 文档（先下载到内存再同步解析） */
    async parseUrl(fileUrl: string, options?: MinerUParseOptions): Promise<MinerUParseResult> {
        if (!this.isConfigured()) return {success: false, error: 'MinerU service is not configured'};

        try {
            const res = await fetch(fileUrl);
            if (!res.ok) {
                return {success: false, error: `Download failed: HTTP ${res.status}`};
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            const fileName = path.basename(new URL(fileUrl).pathname) || 'document';
            return this.parseBuffer(fileName, buffer, res.headers.get('content-type') ?? MinerUClient.getMimeType(fileName), options);
        } catch (err) {
            return {success: false, error: getErrorMessage(err)};
        }
    }

    /** 提交异步解析任务（本地文件），返回提交结果 */
    async submitTask(filePath: string, options?: MinerUParseOptions): Promise<MinerUTaskSubmitResult & {
        error?: string
    }> {
        if (!this.isConfigured()) return {task_id: '', error: 'MinerU service is not configured'};
        if (!fs.existsSync(filePath)) return {task_id: '', error: `File not found: ${filePath}`};

        const fileName = path.basename(filePath);
        const fileBuffer = fs.readFileSync(filePath);
        const mimeType = MinerUClient.getMimeType(fileName);
        return this.submitTaskBuffer(fileName, fileBuffer, mimeType, options);
    }

    /** 提交异步解析任务（Buffer） */
    async submitTaskBuffer(
        fileName: string,
        buffer: Buffer,
        mimeType: string,
        options?: MinerUParseOptions,
    ): Promise<MinerUTaskSubmitResult & { error?: string }> {
        if (!this.isConfigured()) return {task_id: '', error: 'MinerU service is not configured'};

        try {
            const fd = this.buildFormData(fileName, buffer, mimeType, options);
            const res = await fetch(`${this.baseUrl}/tasks`, {
                method: 'POST',
                body: fd,
            });

            if (!res.ok) {
                const text = await res.text();
                return {task_id: '', error: `MinerU HTTP ${res.status}: ${text.substring(0, 500)}`};
            }

            const result = await res.json() as Record<string, unknown>;
            return {
                task_id: result.task_id as string,
                status: result.status as string,
                message: result.message as string
            };
        } catch (err) {
            return {task_id: '', error: getErrorMessage(err)};
        }
    }

    /** 查询异步任务状态 */
    async getTaskStatus(taskId: string): Promise<MinerUTaskStatus & { error?: string }> {
        if (!this.isConfigured()) return {task_id: taskId, status: 'failed', error: 'MinerU service is not configured'};

        try {
            const res = await fetch(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}`);
            if (!res.ok) {
                const text = await res.text();
                return {task_id: taskId, status: 'failed', error: `HTTP ${res.status}: ${text.substring(0, 300)}`};
            }
            return await res.json() as MinerUTaskStatus;
        } catch (err) {
            return {task_id: taskId, status: 'failed', error: getErrorMessage(err)};
        }
    }

    /** 获取异步任务结果 */
    async getTaskResult(taskId: string): Promise<MinerUParseResult> {
        if (!this.isConfigured()) return {success: false, error: 'MinerU service is not configured'};

        try {
            const res = await fetch(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}/result`);
            if (!res.ok) {
                const text = await res.text();
                return {success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}`};
            }
            const text = await res.text();
            return this.parseResponse(text);
        } catch (err) {
            return {success: false, error: getErrorMessage(err)};
        }
    }

    /**
     * 提交异步任务并轮询到完成（大文件推荐；同步 file_parse 会占住 HTTP 连接）。
     * 状态 completed → 取结果；failed / 超时 → 返回 error。
     */
    async parseFileAsync(filePath: string, options?: MinerUParseOptions & {pollIntervalMs?: number; timeoutMs?: number}): Promise<MinerUParseResult> {
        const {pollIntervalMs = 2000, timeoutMs = 300_000, ...parseOptions} = options ?? {};
        const submitted = await this.submitTask(filePath, parseOptions);
        if (submitted.error !== undefined || submitted.task_id === '') {
            return {success: false, error: submitted.error ?? 'Task submit failed'};
        }
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            if (Date.now() > deadline) {
                return {success: false, error: `Polling timed out after ${timeoutMs}ms (task ${submitted.task_id})`};
            }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            const status = await this.getTaskStatus(submitted.task_id);
            if (status.error !== undefined) {
                return {success: false, error: status.error};
            }
            if (status.status === 'completed') {
                return this.getTaskResult(submitted.task_id);
            }
            if (status.status === 'failed') {
                return {success: false, error: status.message ?? `Task ${submitted.task_id} failed`};
            }
            // pending / processing → 继续轮询
        }
    }

    // ========== 私有方法 ==========

    /** 合并默认选项 */
    private mergeOptions(options?: MinerUParseOptions): Required<Pick<MinerUParseOptions,
        'langList' | 'backend' | 'parseMethod' |
        'formulaEnable' | 'tableEnable' | 'imageAnalysis' |
        'returnMd' | 'returnMiddleJson' | 'returnModelOutput' |
        'returnContentList' | 'returnImages' | 'startPageId' | 'endPageId'
    >> {
        return {
            langList: options?.langList ?? ['ch'],
            // pipeline = 纯 CPU 经典管线，任何部署都能跑；vlm/hybrid 系需要 GPU
            // device（CPU 服务器报 "Device string must not be empty"）——默认保守。
            backend: options?.backend ?? 'pipeline',
            parseMethod: options?.parseMethod ?? 'auto',
            formulaEnable: options?.formulaEnable ?? true,
            tableEnable: options?.tableEnable ?? true,
            imageAnalysis: options?.imageAnalysis ?? true,
            returnMd: options?.returnMd ?? true,
            returnMiddleJson: options?.returnMiddleJson ?? false,
            returnModelOutput: options?.returnModelOutput ?? false,
            returnContentList: options?.returnContentList ?? false,
            returnImages: options?.returnImages ?? false,
            startPageId: options?.startPageId ?? 0,
            endPageId: options?.endPageId ?? 99999,
        };
    }

    /**
     * 使用 Node 18+ 原生 FormData + Blob 构建 multipart 请求
     *
     * FormData.append 配合 Blob 会自动处理 multipart boundary、
     * Content-Type header 和二进制编码，无需手动拼接。
     */
    private buildFormData(
        fileName: string,
        buffer: Buffer,
        mimeType: string,
        options?: MinerUParseOptions,
    ): FormData {
        const opts = this.mergeOptions(options);
        const fd = new FormData();

        // 文件字段：Blob 会正确设置 Content-Type
        fd.append('files', new Blob([buffer], {type: mimeType}), fileName);

        // 文本字段
        fd.append('backend', opts.backend);
        fd.append('parse_method', opts.parseMethod);
        fd.append('formula_enable', String(opts.formulaEnable));
        fd.append('table_enable', String(opts.tableEnable));
        fd.append('image_analysis', String(opts.imageAnalysis));
        fd.append('return_md', String(opts.returnMd));
        fd.append('return_middle_json', String(opts.returnMiddleJson));
        fd.append('return_model_output', String(opts.returnModelOutput));
        fd.append('return_content_list', String(opts.returnContentList));
        fd.append('return_images', String(opts.returnImages));
        fd.append('start_page_id', String(opts.startPageId));
        fd.append('end_page_id', String(opts.endPageId));

        // lang_list 数组：每个语言单独 append
        for (const lang of opts.langList) {
            fd.append('lang_list', lang);
        }

        return fd;
    }

    /** 解析 MinerU 响应体 */
    private parseResponse(body: string): MinerUParseResult {
        if (!body) return {success: false, error: 'Empty response from MinerU'};

        try {
            const data = JSON.parse(body);
            const result: MinerUParseResult = {success: true, raw: data};

            if (Array.isArray(data)) {
                result.markdown = data.map((item: unknown) => MinerUClient.extractMarkdown(item)).filter(Boolean).join('\n\n---\n\n');
                return result;
            }

            if (typeof data === 'object' && data !== null) {
                const obj = data as Record<string, unknown>;
                result.markdown = MinerUClient.extractMarkdown(obj);
                result.middleJson = obj.middle_json ?? obj.middleJson ?? obj.middle;
                result.modelOutput = obj.model_output ?? obj.modelOutput;
                result.contentList = obj.content_list ?? obj.contentList ?? obj.content;
                result.images = MinerUClient.extractImages(obj);
            }

            return result;
        } catch {
            return {success: true, markdown: body, raw: body};
        }
    }

    /** 从响应对象中提取 markdown（兼容多种字段名） */
    private static extractMarkdown(obj: unknown): string {
        if (typeof obj === 'string') return obj;
        if (typeof obj !== 'object' || obj === null) return '';

        const o = obj as Record<string, unknown>;

        // MinerU 实际结构: { results: { "文件名": { md_content: "..." } } }
        if (typeof o.results === 'object' && o.results !== null) {
            const results = o.results as Record<string, unknown>;
            const mdParts: string[] = [];
            for (const [, fileResult] of Object.entries(results)) {
                if (typeof fileResult === 'object' && fileResult !== null) {
                    const fr = fileResult as Record<string, unknown>;
                    if (typeof fr.md_content === 'string') {
                        mdParts.push(fr.md_content);
                    }
                }
            }
            if (mdParts.length > 0) {
                return mdParts.join('\n\n---\n\n');
            }
        }

        // 顶层字段
        for (const field of ['md_content', 'markdown', 'md', 'content', 'text'] as const) {
            if (typeof o[field] === 'string' && (o[field] as string).length > 0) {
                return o[field] as string;
            }
        }

        // 单数 result 字段
        if (typeof o.result === 'object' && o.result !== null) {
            return MinerUClient.extractMarkdown(o.result);
        }
        return '';
    }

    /** 提取图片 */
    private static extractImages(obj: Record<string, unknown>): string[] | undefined {
        for (const field of ['images', 'image_list', 'imageList'] as const) {
            if (Array.isArray(obj[field]) && (obj[field] as unknown[]).length > 0) {
                return obj[field] as string[];
            }
        }
        return undefined;
    }

    /** MIME 类型映射 */
    private static getMimeType(fileName: string): string {
        const ext = path.extname(fileName).toLowerCase();
        const map: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheet.sheet',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}
