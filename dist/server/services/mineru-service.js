"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinerUService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * MinerU 文档解析服务
 */
class MinerUService {
    config;
    constructor(config) {
        this.config = config ?? {};
        if (this.config.enabled !== false) {
            console.log(`[mineru] Service initialized (${this.getBaseUrl()})`);
        }
    }
    isEnabled() {
        return this.config.enabled !== false && !!this.config.apiUrl;
    }
    getBaseUrl() {
        return this.config.apiUrl ?? '';
    }
    getStatus() {
        return { enabled: this.isEnabled(), apiUrl: this.getBaseUrl() };
    }
    /** 健康检查 */
    async healthCheck() {
        if (!this.isEnabled()) {
            return { healthy: false, error: 'MinerU service is disabled' };
        }
        const start = Date.now();
        try {
            const res = await fetch(`${this.getBaseUrl()}/health`);
            const latency = Date.now() - start;
            return { healthy: res.ok, latency, error: res.ok ? undefined : `HTTP ${res.status}` };
        }
        catch (err) {
            return { healthy: false, latency: Date.now() - start, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    /** 同步解析本地文件 */
    async parseFile(filePath, options) {
        if (!this.isEnabled())
            return { success: false, error: 'MinerU service is disabled' };
        if (!fs_1.default.existsSync(filePath))
            return { success: false, error: `File not found: ${filePath}` };
        const fileName = path_1.default.basename(filePath);
        const fileBuffer = fs_1.default.readFileSync(filePath);
        const mimeType = this.getMimeType(fileName);
        return this.parseBuffer(fileName, fileBuffer, mimeType, options);
    }
    /** 同步解析 Buffer 文件 */
    async parseBuffer(fileName, buffer, mimeType, options) {
        if (!this.isEnabled())
            return { success: false, error: 'MinerU service is disabled' };
        try {
            const fd = this.buildFormData(fileName, buffer, mimeType, options);
            const res = await fetch(`${this.getBaseUrl()}/file_parse`, {
                method: 'POST',
                body: fd,
            });
            if (!res.ok) {
                const text = await res.text();
                return { success: false, error: `MinerU HTTP ${res.status}: ${text.substring(0, 500)}` };
            }
            const text = await res.text();
            return this.parseResponse(text);
        }
        catch (err) {
            return { success: false, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    /** 提交异步解析任务（本地文件） */
    async submitTask(filePath, options) {
        if (!this.isEnabled())
            return { task_id: '', error: 'MinerU service is disabled' };
        if (!fs_1.default.existsSync(filePath))
            return { task_id: '', error: `File not found: ${filePath}` };
        const fileName = path_1.default.basename(filePath);
        const fileBuffer = fs_1.default.readFileSync(filePath);
        const mimeType = this.getMimeType(fileName);
        return this.submitTaskBuffer(fileName, fileBuffer, mimeType, options);
    }
    /** 提交异步解析任务（Buffer） */
    async submitTaskBuffer(fileName, buffer, mimeType, options) {
        if (!this.isEnabled())
            return { task_id: '', error: 'MinerU service is disabled' };
        try {
            const fd = this.buildFormData(fileName, buffer, mimeType, options);
            const res = await fetch(`${this.getBaseUrl()}/tasks`, {
                method: 'POST',
                body: fd,
            });
            if (!res.ok) {
                const text = await res.text();
                return { task_id: '', error: `MinerU HTTP ${res.status}: ${text.substring(0, 500)}` };
            }
            const result = await res.json();
            return {
                task_id: result.task_id,
                status: result.status,
                message: result.message
            };
        }
        catch (err) {
            return { task_id: '', error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    /** 查询异步任务状态 */
    async getTaskStatus(taskId) {
        if (!this.isEnabled())
            return { task_id: taskId, status: 'failed', error: 'MinerU service is disabled' };
        try {
            const res = await fetch(`${this.getBaseUrl()}/tasks/${encodeURIComponent(taskId)}`);
            if (!res.ok) {
                const text = await res.text();
                return { task_id: taskId, status: 'failed', error: `HTTP ${res.status}: ${text.substring(0, 300)}` };
            }
            const data = await res.json();
            return data;
        }
        catch (err) {
            return { task_id: taskId, status: 'failed', error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    /** 获取异步任务结果 */
    async getTaskResult(taskId) {
        if (!this.isEnabled())
            return { success: false, error: 'MinerU service is disabled' };
        try {
            const res = await fetch(`${this.getBaseUrl()}/tasks/${encodeURIComponent(taskId)}/result`);
            if (!res.ok) {
                const text = await res.text();
                return { success: false, error: `HTTP ${res.status}: ${text.substring(0, 300)}` };
            }
            const text = await res.text();
            return this.parseResponse(text);
        }
        catch (err) {
            return { success: false, error: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    // ========== 私有方法 ==========
    /** 合并默认选项 */
    mergeOptions(options) {
        return {
            langList: options?.langList ?? this.config.defaultLangList ?? ['ch'],
            backend: (options?.backend ?? this.config.defaultBackend ?? 'hybrid-auto-engine'),
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
    buildFormData(fileName, buffer, mimeType, options) {
        const opts = this.mergeOptions(options);
        const fd = new FormData();
        // 文件字段：Blob 会正确设置 Content-Type
        fd.append('files', new Blob([buffer], { type: mimeType }), fileName);
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
    parseResponse(body) {
        if (!body)
            return { success: false, error: 'Empty response from MinerU' };
        try {
            const data = JSON.parse(body);
            const result = { success: true, raw: data };
            if (Array.isArray(data)) {
                result.markdown = data.map((item) => this.extractMarkdown(item)).filter(Boolean).join('\n\n---\n\n');
                return result;
            }
            if (typeof data === 'object' && data !== null) {
                const obj = data;
                result.markdown = this.extractMarkdown(obj);
                result.middleJson = obj.middle_json ?? obj.middleJson ?? obj.middle;
                result.modelOutput = obj.model_output ?? obj.modelOutput;
                result.contentList = obj.content_list ?? obj.contentList ?? obj.content;
                result.images = this.extractImages(obj);
            }
            return result;
        }
        catch {
            return { success: true, markdown: body, raw: body };
        }
    }
    /** 从响应对象中提取 markdown（兼容多种字段名） */
    extractMarkdown(obj) {
        if (typeof obj === 'string')
            return obj;
        if (typeof obj !== 'object' || obj === null)
            return '';
        const o = obj;
        // MinerU 实际结构: { results: { "文件名": { md_content: "..." } } }
        if (typeof o.results === 'object' && o.results !== null) {
            const results = o.results;
            const mdParts = [];
            for (const [, fileResult] of Object.entries(results)) {
                if (typeof fileResult === 'object' && fileResult !== null) {
                    const fr = fileResult;
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
        for (const field of ['md_content', 'markdown', 'md', 'content', 'text']) {
            if (typeof o[field] === 'string' && o[field].length > 0) {
                return o[field];
            }
        }
        // 单数 result 字段
        if (typeof o.result === 'object' && o.result !== null) {
            return this.extractMarkdown(o.result);
        }
        return '';
    }
    /** 提取图片 */
    extractImages(obj) {
        for (const field of ['images', 'image_list', 'imageList']) {
            if (Array.isArray(obj[field]) && obj[field].length > 0) {
                return obj[field];
            }
        }
        return undefined;
    }
    /** MIME 类型映射 */
    getMimeType(fileName) {
        const ext = path_1.default.extname(fileName).toLowerCase();
        const map = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        };
        return map[ext] ?? 'application/octet-stream';
    }
}
exports.MinerUService = MinerUService;
//# sourceMappingURL=mineru-service.js.map