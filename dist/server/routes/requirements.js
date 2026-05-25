"use strict";
/**
 * @file 需求管理路由模块
 * @module routes/requirements
 * @description 提供需求相关的 RESTful API 路由，包括本地需求存储管理、
 *              通过 MCP（Model Context Protocol）桥接服务获取需求详情与搜索功能。
 *              支持从 MCP 服务器拉取需求并自动保存到本地存储，也支持纯查询模式。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequirementsRoutes = createRequirementsRoutes;
const express_1 = require("express");
const ones_image_service_js_1 = require("../services/ones-image-service.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 创建需求管理路由
 * @param mcpBridgeService - MCP 桥接服务实例，用于与外部需求管理系统通信
 * @param requirementStore - 需求本地存储服务实例，用于持久化已保存的需求
 * @returns 配置好的 Express Router 实例
 *
 * @example
 * ```ts
 * const router = createRequirementsRoutes(mcpBridge, requirementStore);
 * app.use('/api/requirements', router);
 * ```
 */
function createRequirementsRoutes(mcpBridgeService, requirementStore, mineruService) {
    const router = (0, express_1.Router)();
    // ─── 本地存储（已保存的需求） ───────────────────────────────────────────────
    /**
     * GET /api/requirements/saved
     * @description 获取所有已保存到本地的需求列表
     * @returns {Object[]} 需求数组
     */
    router.get('/saved', (_req, res) => {
        try {
            res.json(requirementStore.list());
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * PUT /api/requirements/saved/:id
     * @description 更新已保存的需求（部分更新）
     * @param {string} id.path - 需求的唯一标识符
     * @param {Object} body - 需要更新的字段（title、description 等）
     * @returns {Object} 更新后的需求数据
     */
    router.put('/saved/:id', (req, res) => {
        try {
            const existing = requirementStore.get(req.params.id);
            if (!existing) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Requirement not found' });
                return;
            }
            const updated = requirementStore.upsert({
                ...existing,
                ...req.body,
                id: req.params.id,
            });
            res.json(updated);
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * DELETE /api/requirements/saved/:id
     * @description 根据ID删除本地已保存的需求
     * @param {string} id.path - 需求的唯一标识符
     * @returns {{ success: boolean }} 删除操作是否成功
     */
    router.delete('/saved/:id', (req, res) => {
        try {
            const deleted = requirementStore.delete(req.params.id);
            res.json({ success: deleted });
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // ─── MCP 拉取 + 自动保存 ───────────────────────────────────────────────────
    /**
     * POST /api/requirements/fetch
     * @description 通过 MCP 从外部需求管理系统拉取需求详情，并自动保存到本地存储。
     *              支持按需求ID直接拉取，也支持按需求编号（如 "302" 或 "#302"）搜索后拉取。
     *              如果指定了 mcpServerName，会临时切换 MCP 服务器，完成后恢复原始设置。
     * @param {string} id.body - 需求ID或编号（必填）
     * @param {string} [mcpServerName.body] - 可选的 MCP 服务器名称，用于切换到指定服务器拉取需求
     * @returns {Object} 保存后的需求数据
     */
    router.post('/fetch', async (req, res) => {
        try {
            const { id, mcpServerName, parseDocuments } = req.body;
            if (!id?.trim()) {
                res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Requirement ID is required' });
                return;
            }
            // 如果请求了特定的 MCP 服务器，临时切换过去
            const originalServer = mcpBridgeService.getServerName();
            if (mcpServerName)
                mcpBridgeService.setServerName(mcpServerName);
            try {
                let resolvedId = id.trim();
                // 如果输入是纯数字或 #number 格式，先通过搜索获取实际的 ID
                // 搜索失败时回退到直接用编号调用 get_requirement（MCP 支持按编号获取）
                const numberMatch = resolvedId.match(/^#?(\d+)$/);
                if (numberMatch) {
                    const number = numberMatch[1];
                    const results = await mcpBridgeService.searchRequirements(number);
                    if (results.length > 0) {
                        // 取第一个匹配结果的 ID 作为实际查询 ID
                        resolvedId = results[0].id;
                    }
                    // 搜索无结果时不中断，继续用原始编号直接调用 get_requirement
                }
                // 通过 MCP 获取需求详情，并自动保存到本地存储
                const detail = await mcpBridgeService.fetchRequirementDetail(resolvedId);
                // 如果用户输入的是 #number 格式，直接设为需求编号（不依赖 MCP 返回格式提取）
                if (numberMatch && !detail.number) {
                    detail.number = `#${numberMatch[1]}`;
                }
                // 构建 ONES 图片服务（从 MCP 配置读取认证信息）
                let onesImageService;
                const mcpConfig = mcpBridgeService.getServerConfig();
                if (mcpConfig?.env?.ONES_API_BASE && mcpConfig?.env?.ONES_ACCOUNT && mcpConfig?.env?.ONES_PASSWORD) {
                    onesImageService = new ones_image_service_js_1.OnesImageService(mcpConfig.env.ONES_API_BASE, mcpConfig.env.ONES_ACCOUNT, mcpConfig.env.ONES_PASSWORD);
                }
                // 下载图片到本地并替换 description 中的引用
                await requirementStore.downloadImages(detail, onesImageService);
                // 解析文档附件（PDF/DOCX/PPTX/XLSX）为 Markdown（需前端显式请求）
                if (parseDocuments && mineruService?.isEnabled()) {
                    try {
                        const parsedMd = await requirementStore.downloadAndParseDocuments(detail, mineruService, onesImageService);
                        if (parsedMd) {
                            detail.description += '\n\n---\n\n## 附件文档内容\n\n' + parsedMd;
                        }
                    }
                    catch (err) {
                        // 文档解析失败不阻塞需求保存
                        console.warn(`[requirements] Document parsing failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
                    }
                }
                const saved = requirementStore.upsert({
                    ...detail,
                    source: mcpBridgeService.getServerName(),
                });
                res.json(saved);
            }
            finally {
                // 无论成功与否，恢复原始 MCP 服务器设置
                if (mcpServerName)
                    mcpBridgeService.setServerName(originalServer);
            }
        }
        catch (err) {
            res.status(500).json({ code: 'MCP_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/requirements/search?q=
     * @description 通过 MCP 搜索需求（纯查询模式，不会自动保存到本地存储）
     * @param {string} q.query - 搜索关键词（必填）
     * @returns {Object[]} 匹配的需求结果列表
     */
    router.get('/search', async (req, res) => {
        try {
            const query = req.query.q;
            if (!query?.trim()) {
                res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Query parameter "q" is required' });
                return;
            }
            const results = await mcpBridgeService.searchRequirements(query);
            res.json(results);
        }
        catch (err) {
            res.status(500).json({ code: 'MCP_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * GET /api/requirements/:id
     * @description 根据ID获取需求详情。优先从本地存储查找，若未找到则回退到 MCP 实时获取。
     *              回退模式下不会自动保存到本地存储。
     * @param {string} id.path - 需求的唯一标识符
     * @returns {Object} 需求详情数据
     */
    router.get('/:id', async (req, res) => {
        try {
            // 优先检查本地存储
            const local = requirementStore.get(req.params.id);
            if (local) {
                res.json(local);
                return;
            }
            // 本地未找到时，回退到 MCP 实时获取
            const detail = await mcpBridgeService.fetchRequirementDetail(req.params.id);
            res.json(detail);
        }
        catch (err) {
            res.status(500).json({ code: 'MCP_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // ─── 图片静态文件服务 ─────────────────────────────────────────────────────
    /**
     * GET /api/requirements/images/:reqId/:filename
     * @description 提供已下载到本地的需求图片文件
     * @param {string} reqId.path - 需求 ID
     * @param {string} filename.path - 图片文件名
     */
    router.get('/images/:reqId/:filename', (req, res) => {
        const filePath = requirementStore.getImagePath(req.params.reqId, req.params.filename);
        if (!filePath) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Image not found' });
            return;
        }
        res.sendFile(filePath);
    });
    return router;
}
//# sourceMappingURL=requirements.js.map