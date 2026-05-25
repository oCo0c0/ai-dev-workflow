"use strict";
/**
 * @file mineru.ts
 * @description MinerU 文档解析路由模块
 *
 * 提供 MinerU 文档解析的 RESTful API，支持：
 * - 同步文件解析（上传文件，等待结果）
 * - 异步任务提交和查询
 * - 健康检查
 *
 * 路由前缀：/api/mineru
 *
 * 端点列表：
 * - GET  /status       — MinerU 服务状态和健康检查
 * - POST /parse        — 同步解析（上传文件，等待结果）
 * - POST /tasks        — 异步解析（提交任务，返回 task_id）
 * - GET  /tasks/:id    — 查询任务状态
 * - GET  /tasks/:id/result — 获取任务结果
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMinerURoutes = createMinerURoutes;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const error_utils_js_1 = require("../utils/error-utils.js");
/** multer 内存存储配置（文件不落盘，直接转发给 MinerU） */
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
/**
 * 创建 MinerU 路由实例
 *
 * @param mineruService - MinerU 服务实例
 * @returns 配置好路由的 Express Router
 */
function createMinerURoutes(mineruService) {
    const router = (0, express_1.Router)();
    // GET /api/mineru/status — MinerU 服务状态
    router.get('/status', async (_req, res) => {
        try {
            const config = mineruService.getStatus();
            if (!config.enabled) {
                res.json({ ...config, healthy: false });
                return;
            }
            const health = await mineruService.healthCheck();
            res.json({ ...config, ...health });
        }
        catch (err) {
            res.status(500).json({ code: 'MINERU_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/mineru/parse — 同步解析文件
    router.post('/parse', upload.array('files', 10), async (req, res) => {
        try {
            const files = req.files;
            if (!files || files.length === 0) {
                res.status(400).json({ code: 'NO_FILES', message: 'No files uploaded' });
                return;
            }
            const options = extractOptions(req.body);
            // 单文件直接解析
            if (files.length === 1) {
                const file = files[0];
                const result = await mineruService.parseBuffer(file.originalname, file.buffer, file.mimetype, options);
                res.json(result);
                return;
            }
            // 多文件顺序解析
            const results = [];
            for (const file of files) {
                const result = await mineruService.parseBuffer(file.originalname, file.buffer, file.mimetype, options);
                results.push({ fileName: file.originalname, ...result });
            }
            res.json({ success: true, results });
        }
        catch (err) {
            res.status(500).json({ code: 'MINERU_PARSE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // POST /api/mineru/tasks — 异步提交解析任务
    router.post('/tasks', upload.array('files', 10), async (req, res) => {
        try {
            const files = req.files;
            if (!files || files.length === 0) {
                res.status(400).json({ code: 'NO_FILES', message: 'No files uploaded' });
                return;
            }
            const options = extractOptions(req.body);
            const tasks = [];
            for (const file of files) {
                const result = await mineruService.submitTaskBuffer(file.originalname, file.buffer, file.mimetype, options);
                tasks.push({ fileName: file.originalname, ...result });
            }
            res.json({ success: true, tasks });
        }
        catch (err) {
            res.status(500).json({ code: 'MINERU_TASK_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/mineru/tasks/:taskId — 查询任务状态
    router.get('/tasks/:taskId', async (req, res) => {
        try {
            const { taskId } = req.params;
            const status = await mineruService.getTaskStatus(taskId);
            res.json(status);
        }
        catch (err) {
            res.status(500).json({ code: 'MINERU_TASK_STATUS_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/mineru/tasks/:taskId/result — 获取任务结果
    router.get('/tasks/:taskId/result', async (req, res) => {
        try {
            const { taskId } = req.params;
            const result = await mineruService.getTaskResult(taskId);
            res.json(result);
        }
        catch (err) {
            res.status(500).json({ code: 'MINERU_TASK_RESULT_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    return router;
}
/** 从请求体提取解析选项 */
function extractOptions(body) {
    // multer multipart: 同名字段多次 append 时返回 string 或 string[]
    let langList;
    if (Array.isArray(body.langList)) {
        langList = body.langList;
    }
    else if (typeof body.langList === 'string') {
        // 尝试 JSON 解析（前端可能发送 JSON 数组字符串），失败则当作单个值
        try {
            const parsed = JSON.parse(body.langList);
            langList = Array.isArray(parsed) ? parsed : [body.langList];
        }
        catch {
            langList = [body.langList];
        }
    }
    return {
        langList,
        backend: typeof body.backend === 'string' ? body.backend : undefined,
        parseMethod: typeof body.parseMethod === 'string' ? body.parseMethod : undefined,
        formulaEnable: body.formulaEnable === 'false' ? false : undefined,
        tableEnable: body.tableEnable === 'false' ? false : undefined,
        imageAnalysis: body.imageAnalysis === 'false' ? false : undefined,
        returnMd: body.returnMd === 'false' ? false : undefined,
        returnMiddleJson: body.returnMiddleJson === 'true' ? true : undefined,
        returnModelOutput: body.returnModelOutput === 'true' ? true : undefined,
        returnContentList: body.returnContentList === 'true' ? true : undefined,
        returnImages: body.returnImages === 'true' ? true : undefined,
        startPageId: body.startPageId != null ? Number(body.startPageId) : undefined,
        endPageId: body.endPageId != null ? Number(body.endPageId) : undefined,
    };
}
//# sourceMappingURL=mineru.js.map