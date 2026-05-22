"use strict";
/**
 * @file 开发计划管理路由模块
 * @module routes/plan
 * @description 提供开发计划（Plan）相关的 RESTful API 路由，涵盖：
 *              - 基于需求自动生成开发计划（通过 Claude CLI 桥接）
 *              - 计划列表查询、状态查看、内容更新与删除
 *              - 计划生成过程中的多轮对话回复支持
 *              - 计划数据同时存储在内存缓存（快速访问）和文件持久化层（持久存储）
 *              - 支持从 Pipeline 配置中解析计划阶段所需的技能（Skills）
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlanStore = getPlanStore;
exports.createPlanRoutes = createPlanRoutes;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const validation_js_1 = require("../middleware/validation.js");
const websocket_js_1 = require("../websocket.js");
const plan_store_service_js_1 = require("../services/plan-store-service.js");
const requirement_store_service_js_1 = require("../services/requirement-store-service.js");
const skill_utils_js_1 = require("../utils/skill-utils.js");
const prompt_enrichment_js_1 = require("../utils/prompt-enrichment.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/** Bridge 调用超时时间（30 分钟） */
const BRIDGE_TIMEOUT_MS = 30 * 60 * 1000;
/** 计划生成时的系统提示模板 */
const PLAN_PROMPT_TEMPLATE = `Analyze the following requirement and generate a structured development plan.\n\n## Requirement\n{title}\n\n{description}\n\n## Instructions\nGenerate a development plan. Respond in the same language as the requirement.`;
/**
 * 内存缓存，用于快速访问已生成的计划数据。
 * 数据源为文件持久化存储，缓存缺失时会从文件存储中加载并回填。
 */
const planCache = new Map();
/**
 * 跟踪正在生成的 plan 的 AbortController，用于 pause/abort 控制。
 */
const activeGenerations = new Map();
/**
 * 获取计划内存缓存的引用。
 * 主要供 execution 路由模块访问计划数据。
 */
function getPlanStore() {
    return planCache;
}
/**
 * 从缓存或文件存储中查找计划，缓存未命中时自动预热
 * @param taskId - 计划任务ID
 * @param planStore - 文件存储服务实例
 * @returns 计划数据，未找到返回 undefined
 */
function findPlan(taskId, planStore) {
    let plan = planCache.get(taskId);
    if (!plan) {
        plan = planStore.get(taskId);
        if (plan)
            planCache.set(plan.id, plan);
    }
    return plan;
}
/**
 * 同步持久化计划数据到缓存和文件存储
 * @param plan - 计划数据
 * @param planStore - 文件存储服务实例
 */
function persistPlan(plan, planStore) {
    planStore.upsert(plan);
    planCache.set(plan.id, plan);
}
/**
 * 标记计划为失败状态，持久化并广播
 * @param plan - 计划数据
 * @param error - 错误信息
 * @param planStore - 文件存储服务实例
 * @param extraBroadcast - 额外的错误广播消息前缀（可选）
 */
function failPlan(plan, error, planStore, extraBroadcast) {
    plan.status = 'failed';
    plan.error = error;
    plan.updatedAt = new Date().toISOString();
    persistPlan(plan, planStore);
    activeGenerations.delete(plan.id);
    (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: 'failed', error } });
    if (extraBroadcast) {
        (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `${extraBroadcast}: ${error}` } });
    }
}
/**
 * 处理 bridge 成功返回后的状态更新
 * @param plan - 计划数据
 * @param result - bridge 返回结果
 * @param accumulatedOutput - 累积输出文本
 * @param planStore - 文件存储服务实例
 */
function finalizePlan(plan, result, accumulatedOutput, planStore) {
    plan.status = result.exitCode === 0 ? 'ready' : 'failed';
    plan.rawOutput = accumulatedOutput;
    plan.summary = accumulatedOutput.substring(0, 500);
    plan.updatedAt = new Date().toISOString();
    if (result.sessionId)
        plan.sessionId = result.sessionId;
    if (result.exitCode !== 0)
        plan.error = result.stderr || 'Plan generation failed';
    persistPlan(plan, planStore);
    activeGenerations.delete(plan.id);
    (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
}
/**
 * 从 Pipeline 配置中解析计划阶段的技能列表
 * @param pipelineId - 流水线ID
 * @param pipelineService - 流水线服务实例
 * @returns 技能列表，无配置时返回 undefined
 */
function resolvePlanSkills(pipelineId, pipelineService) {
    if (!pipelineId || !pipelineService)
        return undefined;
    const pipeline = pipelineService.get(pipelineId);
    return pipeline?.steps ? (0, skill_utils_js_1.getPhaseSkills)(pipeline.steps, 'plan') : undefined;
}
/**
 * 获取需求详情：优先从本地 store 读取已保存的版本，避免重新获取导致内容不一致
 * @param requirementId - 需求ID
 * @param reqStore - 本地需求存储服务
 * @param mcpBridgeService - MCP 桥接服务（fallback）
 * @returns 需求的 title 和 description
 */
async function getRequirementContent(requirementId, reqStore, mcpBridgeService) {
    // 优先从本地已保存的需求中取（内容与 Requirements 页面展示一致）
    const saved = reqStore.get(requirementId);
    if (saved) {
        return { title: saved.title, description: saved.description };
    }
    // 本地无缓存，fallback 到 MCP 实时获取
    const detail = await mcpBridgeService.fetchRequirementDetail(requirementId);
    return { title: detail.title, description: detail.description };
}
/**
 * 执行带超时的 bridge 调用，统一处理 onOutput 回调和错误
 * @param plan - 计划数据
 * @param bridgeOptions - bridge 调用参数
 * @param planStore - 文件存储服务实例
 * @param errorPrefix - 错误广播前缀
 */
async function runBridgeWithTimeout(plan, bridgeOptions, planStore, errorPrefix) {
    let accumulatedOutput = bridgeOptions.accumulatedOutput ?? '';
    try {
        const result = await Promise.race([
            bridgeOptions.cliRunner.runBridge({
                prompt: bridgeOptions.prompt,
                cwd: bridgeOptions.cwd,
                sessionId: bridgeOptions.sessionId,
                maxTurns: 20,
                skills: bridgeOptions.skills,
            }, {
                workspacePath: bridgeOptions.cwd,
                signal: bridgeOptions.signal,
                onOutput: (data) => {
                    accumulatedOutput += data;
                    plan.rawOutput = accumulatedOutput;
                    plan.summary = accumulatedOutput.substring(0, 500);
                    planCache.set(plan.id, { ...plan });
                    (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: data } });
                },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`${errorPrefix} timed out after 30 minutes`)), BRIDGE_TIMEOUT_MS)),
        ]);
        finalizePlan(plan, result, accumulatedOutput, planStore);
    }
    catch (err) {
        failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, errorPrefix);
    }
}
/**
 * 创建开发计划管理路由
 */
function createPlanRoutes(cliRunnerService, mcpBridgeService, pipelineService, memoryService) {
    const planStore = new plan_store_service_js_1.PlanStoreService();
    const reqStore = new requirement_store_service_js_1.RequirementStoreService();
    const router = (0, express_1.Router)();
    // POST /api/plan/generate - 基于需求生成开发计划
    router.post('/generate', (0, validation_js_1.validateBody)([
        { field: 'requirementId', required: true, type: 'string' },
        { field: 'workspacePath', required: true, type: 'string' },
    ]), async (req, res) => {
        const { requirementId, workspacePath, pipelineId, requirementTitle, requirementNumber } = req.body;
        const wsCheck = (0, validation_js_1.validateWorkspacePath)(workspacePath);
        if (!wsCheck.valid) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: wsCheck.error });
            return;
        }
        const taskId = crypto_1.default.randomUUID();
        const planSkills = resolvePlanSkills(pipelineId, pipelineService);
        const plan = {
            id: taskId,
            requirementId,
            requirementTitle,
            requirementNumber,
            workspacePath,
            status: 'generating',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pipelineId,
        };
        persistPlan(plan, planStore);
        res.json({ taskId });
        const abortController = new AbortController();
        activeGenerations.set(taskId, abortController);
        // 异步生成
        try {
            const { title, description } = await getRequirementContent(requirementId, reqStore, mcpBridgeService);
            const promptText = PLAN_PROMPT_TEMPLATE
                .replace('{title}', title)
                .replace('{description}', description);
            await runBridgeWithTimeout(plan, {
                cliRunner: cliRunnerService,
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, workspacePath),
                cwd: workspacePath,
                skills: planSkills,
                signal: abortController.signal,
            }, planStore, 'Plan generation');
        }
        catch (err) {
            failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Plan generation');
        }
    });
    // GET /api/plan/list - 获取计划列表
    router.get('/list', (_req, res) => {
        try {
            const plans = planStore.list().map(p => {
                // 迁移：旧 plan 没有 requirementTitle，从 requirement store 补数据
                if (!p.requirementTitle) {
                    try {
                        const req = reqStore.get(p.requirementId);
                        if (req) {
                            p.requirementTitle = req.title;
                            p.requirementNumber = req.number;
                            planStore.upsert(p);
                        }
                    }
                    catch { /* 补数据失败不影响列表返回 */ }
                }
                return {
                    id: p.id,
                    requirementId: p.requirementId,
                    requirementTitle: p.requirementTitle,
                    requirementNumber: p.requirementNumber,
                    workspacePath: p.workspacePath,
                    status: p.status,
                    summary: p.summary?.substring(0, 200),
                    createdAt: p.createdAt,
                    updatedAt: p.updatedAt,
                };
            });
            res.json(plans);
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    // GET /api/plan/:taskId - 获取计划详情
    router.get('/:taskId', (req, res) => {
        const plan = findPlan(req.params.taskId, planStore);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        res.json(plan);
    });
    // PUT /api/plan/:taskId - 更新计划内容
    router.put('/:taskId', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (req.body.summary !== undefined)
            plan.summary = req.body.summary;
        if (req.body.rawOutput !== undefined)
            plan.rawOutput = req.body.rawOutput;
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        res.json(plan);
    });
    // DELETE /api/plan/:taskId - 删除计划
    router.delete('/:taskId', (req, res) => {
        const deleted = planStore.delete(req.params.taskId);
        planCache.delete(req.params.taskId);
        res.json({ success: deleted });
    });
    // POST /api/plan/:taskId/reply - 多轮对话回复
    router.post('/:taskId/reply', async (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const { message } = req.body;
        if (!message?.trim()) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
            return;
        }
        if (!plan.sessionId) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No active session to reply to' });
            return;
        }
        res.json({ ok: true });
        plan.status = 'generating';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: `\n\n**User:** ${message}\n\n` } });
        await runBridgeWithTimeout(plan, {
            cliRunner: cliRunnerService,
            prompt: message,
            cwd: plan.workspacePath,
            sessionId: plan.sessionId,
            accumulatedOutput: plan.rawOutput || '',
        }, planStore, 'Reply');
    });
    // POST /api/plan/:taskId/abort - 取消生成
    router.post('/:taskId/abort', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const ac = activeGenerations.get(req.params.taskId);
        if (!ac) {
            failPlan(plan, 'Generation cancelled by user', planStore);
            res.json({ ok: true });
            return;
        }
        ac.abort();
        activeGenerations.delete(req.params.taskId);
        res.json({ ok: true });
    });
    // POST /api/plan/:taskId/pause - 暂停生成
    router.post('/:taskId/pause', (req, res) => {
        const plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        const ac = activeGenerations.get(req.params.taskId);
        if (!ac) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No active generation to pause' });
            return;
        }
        res.json({ ok: true });
        ac.abort();
        activeGenerations.delete(req.params.taskId);
        plan.status = 'paused';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:complete', data: { taskId: plan.id, status: 'paused' } });
    });
    // POST /api/plan/:taskId/resume - 恢复生成
    router.post('/:taskId/resume', async (req, res) => {
        const plan = findPlan(req.params.taskId, planStore);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (plan.status !== 'paused') {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Plan is not paused' });
            return;
        }
        if (!plan.sessionId) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No session ID available for resume' });
            return;
        }
        const abortController = new AbortController();
        activeGenerations.set(plan.id, abortController);
        plan.status = 'generating';
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId: plan.id, content: '\n\n[Resuming generation...]\n\n' } });
        res.json({ ok: true });
        await runBridgeWithTimeout(plan, {
            cliRunner: cliRunnerService,
            prompt: 'Continue generating the development plan from where you left off.',
            cwd: plan.workspacePath,
            sessionId: plan.sessionId,
            signal: abortController.signal,
            accumulatedOutput: plan.rawOutput || '',
        }, planStore, 'Resume');
    });
    // POST /api/plan/:taskId/regenerate - 在原 plan 上重新生成
    router.post('/:taskId/regenerate', async (req, res) => {
        const taskId = req.params.taskId;
        const plan = planCache.get(taskId) ?? planStore.get(taskId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        if (activeGenerations.has(taskId)) {
            res.status(409).json({ code: 'CONFLICT', message: 'Plan is already generating' });
            return;
        }
        const planSkills = resolvePlanSkills(plan.pipelineId, pipelineService);
        // 重置状态
        plan.status = 'generating';
        plan.rawOutput = undefined;
        plan.summary = undefined;
        plan.error = undefined;
        plan.sessionId = undefined;
        plan.updatedAt = new Date().toISOString();
        persistPlan(plan, planStore);
        res.json({ taskId });
        const abortController = new AbortController();
        activeGenerations.set(taskId, abortController);
        try {
            const { title, description } = await getRequirementContent(plan.requirementId, reqStore, mcpBridgeService);
            const promptText = PLAN_PROMPT_TEMPLATE
                .replace('{title}', title)
                .replace('{description}', description);
            await runBridgeWithTimeout(plan, {
                cliRunner: cliRunnerService,
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, plan.workspacePath),
                cwd: plan.workspacePath,
                skills: planSkills,
                signal: abortController.signal,
            }, planStore, 'Plan regeneration');
        }
        catch (err) {
            failPlan(plan, (0, error_utils_js_1.getErrorMessage)(err), planStore, 'Plan regeneration');
        }
    });
    return router;
}
//# sourceMappingURL=plan.js.map