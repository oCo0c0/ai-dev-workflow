"use strict";
/**
 * @file 执行管理路由模块
 * @module routes/execution
 * @description 提供执行（Execution）相关的 RESTful API 路由，涵盖：
 *              - 基于开发计划启动代码执行（通过 Claude CLI 桥接）
 *              - 执行过程的暂停、中止、重试当前步骤、跳过当前步骤
 *              - 执行状态查看与日志获取
 *              - 执行过程中的多轮对话回复支持
 *              - 执行完成后自动触发测试阶段（根据 Pipeline 配置）
 *              - 执行数据同时存储在内存（活跃执行）和文件持久化层
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExecutionRoutes = createExecutionRoutes;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const validation_js_1 = require("../middleware/validation.js");
const websocket_js_1 = require("../websocket.js");
const plan_js_1 = require("./plan.js");
const plan_store_service_js_1 = require("../services/plan-store-service.js");
const skill_utils_js_1 = require("../utils/skill-utils.js");
const prompt_enrichment_js_1 = require("../utils/prompt-enrichment.js");
const execution_store_service_js_1 = require("../services/execution-store-service.js");
const test_store_service_js_1 = require("../services/test-store-service.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 活跃执行的内存存储 Map。
 * 键为执行ID，值为执行状态对象。
 * 服务重启后该存储会清空，持久化数据需从 ExecutionStoreService 读取。
 */
const executionStore = new Map();
/**
 * 将内存中的执行对象转换为持久化格式。
 * 移除不可序列化的 AbortController 字段。
 * @param exec - 内存中的执行对象
 * @returns 可持久化的执行数据对象
 */
function toPersisted(exec) {
    return {
        id: exec.id,
        planId: exec.planId,
        requirementId: exec.requirementId,
        status: exec.status,
        currentStep: exec.currentStep,
        totalSteps: exec.totalSteps,
        startedAt: exec.startedAt,
        completedAt: exec.completedAt,
        logs: exec.logs,
        sessionId: exec.sessionId,
        workspacePath: exec.workspacePath,
    };
}
/**
 * 创建执行管理路由
 * @param cliRunnerService - CLI 运行器服务实例，用于调用 Claude CLI 执行代码
 * @param pipelineService - 可选的流水线服务实例，用于解析执行阶段的技能和测试配置
 * @param testExecutorService - 可选的测试执行器服务实例，用于执行完成后自动运行测试
 * @param memoryService
 * @param sandboxService
 * @returns 配置好的 Express Router 实例
 *
 * @example
 * ```ts
 * const router = createExecutionRoutes(cliRunner, pipelineService, testExecutor);
 * app.use('/api/execution', router);
 * ```
 */
function createExecutionRoutes(cliRunnerService, pipelineService, testExecutorService, memoryService, sandboxService) {
    const persistStore = new execution_store_service_js_1.ExecutionStoreService();
    const planFileStore = new plan_store_service_js_1.PlanStoreService();
    const testPersistStore = new test_store_service_js_1.TestStoreService();
    const router = (0, express_1.Router)();
    /**
     * GET /api/execution/list
     * @description 获取最近的执行记录列表，返回精简信息（不包含完整日志）
     * @returns {Object[]} 执行列表，每个元素包含 id、计划ID、状态、步骤进度等字段
     */
    router.get('/list', (_req, res) => {
        try {
            const planStore = (0, plan_js_1.getPlanStore)();
            const executions = persistStore.list().map(e => {
                // 优先从内存缓存取 plan，否则从文件存储取
                let plan = planStore.get(e.planId);
                if (!plan)
                    plan = planFileStore.get(e.planId);
                return {
                    id: e.id,
                    planId: e.planId,
                    requirementTitle: plan?.requirementTitle,
                    requirementNumber: plan?.requirementNumber,
                    status: e.status,
                    currentStep: e.currentStep,
                    totalSteps: e.totalSteps,
                    startedAt: e.startedAt,
                    completedAt: e.completedAt,
                    workspacePath: e.workspacePath,
                    logCount: e.logs.length,
                };
            });
            res.json(executions);
        }
        catch (err) {
            res.status(500).json({ code: 'STORE_ERROR', message: (0, error_utils_js_1.getErrorMessage)(err) });
        }
    });
    /**
     * POST /api/execution/start
     * @description 基于指定的开发计划启动代码执行。该接口为异步操作，立即返回 executionId，
     *              执行过程通过 WebSocket 广播输出日志。
     *              如果关联的 Pipeline 配置了自动测试，执行完成后会自动触发测试阶段。
     *              允许在计划状态为 'ready' 或 'generating' 时启动执行（后者处理时序问题）。
     * @param {string} planId.body - 开发计划ID（必填）
     * @returns {{ executionId: string }} 执行任务ID，用于后续查询状态和控制
     */
    router.post('/start', (0, validation_js_1.validateBody)([
        { field: 'planId', required: true, type: 'string' },
    ]), async (req, res) => {
        const { planId } = req.body;
        let plan = (0, plan_js_1.getPlanStore)().get(planId);
        if (!plan)
            plan = planFileStore.get(planId);
        if (!plan) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
            return;
        }
        // 允许计划状态为 ready、generating 或 failed（有内容可重试）时启动执行
        if (plan.status === 'failed' && !plan.rawOutput && !plan.summary) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Plan has no content to execute' });
            return;
        }
        const executionId = crypto_1.default.randomUUID();
        const abortController = new AbortController();
        // 从 Pipeline 配置中解析执行阶段所需的技能列表
        let executionSkills;
        if (plan.pipelineId && pipelineService) {
            const pipeline = pipelineService.get(plan.pipelineId);
            if (pipeline?.steps) {
                executionSkills = (0, skill_utils_js_1.getPhaseSkills)(pipeline.steps, 'execution');
            }
        }
        // 初始化执行对象
        const execution = {
            id: executionId,
            planId,
            requirementId: plan.requirementId,
            status: 'running',
            currentStep: 0,
            totalSteps: 1,
            startedAt: new Date().toISOString(),
            logs: [],
            sessionId: plan.sessionId,
            workspacePath: plan.workspacePath,
            abortController,
        };
        executionStore.set(executionId, execution);
        persistStore.upsert(toPersisted(execution));
        // 立即返回执行ID，后续执行过程异步进行
        res.json({ executionId });
        // 异步执行代码
        try {
            const onOutput = (data) => {
                execution.logs.push(data);
                (0, websocket_js_1.broadcast)({
                    type: 'execution:output',
                    data: { executionId, stepIndex: execution.currentStep, content: data }
                });
            };
            const result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(plan.rawOutput ?? plan.summary ?? '', memoryService, plan.workspacePath),
                cwd: plan.workspacePath,
                sessionId: plan.sessionId,
                maxTurns: 50,
                skills: executionSkills,
            }, {
                workspacePath: plan.workspacePath,
                onOutput,
                signal: abortController.signal,
            });
            // 保存会话ID以便后续多轮对话
            if (result.sessionId)
                execution.sessionId = result.sessionId;
            // 根据中止状态和退出码设置最终状态
            if (result.aborted) {
                execution.status = 'aborted';
            }
            else if (result.exitCode === 0) {
                execution.status = 'completed';
            }
            else {
                execution.status = 'failed';
            }
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'execution:complete', data: { executionId, status: execution.status } });
            // 如果执行成功完成且 Pipeline 配置了自动测试，则自动触发测试阶段
            if (execution.status === 'completed' && plan.pipelineId && pipelineService && testExecutorService) {
                void triggerTestPhase(execution, plan, pipelineService, cliRunnerService, testExecutorService, testPersistStore, sandboxService);
            }
        }
        catch (err) {
            execution.status = 'failed';
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `Execution failed: ${(0, error_utils_js_1.getErrorMessage)(err)}` } });
        }
    });
    /**
     * POST /api/execution/:id/pause
     * @description 暂停正在运行的执行任务。通过 AbortController 向 CLI 发送中止信号。
     * @param {string} id.path - 执行任务ID
     * @returns {{ status: 'paused' }} 确认已暂停
     */
    router.post('/:id/pause', (req, res) => {
        let execution = executionStore.get(req.params.id);
        if (!execution) {
            const persisted = persistStore.get(req.params.id);
            if (!persisted) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
                return;
            }
            if (persisted.status !== 'running') {
                res.status(400).json({ code: 'INVALID_STATE', message: 'Execution is not running' });
                return;
            }
            execution = {
                ...persisted,
                abortController: new AbortController(),
                workspacePath: persisted.workspacePath,
            };
            executionStore.set(execution.id, execution);
        }
        if (execution.status !== 'running') {
            res.status(400).json({ code: 'INVALID_STATE', message: 'Execution is not running' });
            return;
        }
        execution.status = 'paused';
        execution.abortController?.abort(); // 向 CLI 进程发送中止信号
        persistStore.upsert(toPersisted(execution));
        res.json({ status: 'paused' });
    });
    /**
     * POST /api/execution/:id/retry-step
     * @description 重试当前步骤。仅当执行处于"已暂停"或"已失败"状态时允许操作。
     *              如果执行不在内存中，会从持久化存储恢复并重新启动 bridge。
     * @param {string} id.path - 执行任务ID
     * @returns {{ status: 'retrying' }} 确认正在重试
     */
    router.post('/:id/retry-step', async (req, res) => {
        let execution = executionStore.get(req.params.id);
        // 内存未命中，从持久化存储恢复（服务重启后场景）
        if (!execution) {
            const persisted = persistStore.get(req.params.id);
            if (!persisted) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
                return;
            }
            if (persisted.status !== 'paused' && persisted.status !== 'failed') {
                res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to retry' });
                return;
            }
            // 恢复到内存
            let plan = (0, plan_js_1.getPlanStore)().get(persisted.planId);
            if (!plan)
                plan = planFileStore.get(persisted.planId);
            execution = {
                ...persisted,
                abortController: new AbortController(),
                workspacePath: persisted.workspacePath || plan?.workspacePath,
            };
            executionStore.set(execution.id, execution);
        }
        else {
            if (execution.status !== 'paused' && execution.status !== 'failed') {
                res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to retry' });
                return;
            }
        }
        execution.status = 'running';
        execution.completedAt = undefined;
        persistStore.upsert(toPersisted(execution));
        res.json({ status: 'retrying' });
        // 真正重新执行：用已有的 sessionId 继续对话
        const plan = (0, plan_js_1.getPlanStore)().get(execution.planId) ?? planFileStore.get(execution.planId);
        const retryPrompt = `The previous execution step failed. Please retry the current step. Continue from where you left off.`;
        try {
            const result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(retryPrompt, memoryService, execution.workspacePath || process.cwd()),
                cwd: execution.workspacePath || process.cwd(),
                sessionId: execution.sessionId,
                maxTurns: 50,
            }, {
                workspacePath: execution.workspacePath || process.cwd(),
                onOutput: (data) => {
                    execution.logs.push(data);
                    (0, websocket_js_1.broadcast)({
                        type: 'execution:output',
                        data: { executionId: execution.id, stepIndex: execution.currentStep, content: data }
                    });
                },
                signal: execution.abortController?.signal,
            });
            if (result.sessionId)
                execution.sessionId = result.sessionId;
            if (result.aborted) {
                execution.status = 'aborted';
            }
            else if (result.exitCode === 0) {
                execution.status = 'completed';
            }
            else {
                execution.status = 'failed';
            }
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'execution:complete', data: { executionId: execution.id, status: execution.status } });
            if (execution.status === 'completed' && plan?.pipelineId && pipelineService && testExecutorService) {
                void triggerTestPhase(execution, plan, pipelineService, cliRunnerService, testExecutorService, testPersistStore, sandboxService);
            }
        }
        catch (err) {
            execution.status = 'failed';
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `Execution retry failed: ${(0, error_utils_js_1.getErrorMessage)(err)}` } });
        }
    });
    /**
     * POST /api/execution/:id/skip-step
     * @description 跳过当前步骤，步骤索引递增并恢复运行状态。
     *              仅当执行处于"已暂停"或"已失败"状态时允许操作。
     *              支持从持久化存储恢复（服务重启后场景）。
     * @param {string} id.path - 执行任务ID
     * @returns {{ status: 'skipped' }} 确认已跳过
     */
    router.post('/:id/skip-step', async (req, res) => {
        let execution = executionStore.get(req.params.id);
        // 内存未命中，从持久化存储恢复
        if (!execution) {
            const persisted = persistStore.get(req.params.id);
            if (!persisted) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
                return;
            }
            if (persisted.status !== 'paused' && persisted.status !== 'failed') {
                res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to skip' });
                return;
            }
            execution = {
                ...persisted,
                abortController: new AbortController(),
                workspacePath: persisted.workspacePath,
            };
            executionStore.set(execution.id, execution);
        }
        else {
            if (execution.status !== 'paused' && execution.status !== 'failed') {
                res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to skip' });
                return;
            }
        }
        execution.currentStep += 1;
        execution.status = 'running';
        execution.completedAt = undefined;
        persistStore.upsert(toPersisted(execution));
        res.json({ status: 'skipped' });
        // 继续执行后续步骤
        const plan = (0, plan_js_1.getPlanStore)().get(execution.planId) ?? planFileStore.get(execution.planId);
        const continuePrompt = `The previous step was skipped. Please continue with the next step.`;
        try {
            const result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(continuePrompt, memoryService, execution.workspacePath || process.cwd()),
                cwd: execution.workspacePath || process.cwd(),
                sessionId: execution.sessionId,
                maxTurns: 50,
            }, {
                workspacePath: execution.workspacePath || process.cwd(),
                onOutput: (data) => {
                    execution.logs.push(data);
                    (0, websocket_js_1.broadcast)({
                        type: 'execution:output',
                        data: { executionId: execution.id, stepIndex: execution.currentStep, content: data }
                    });
                },
                signal: execution.abortController?.signal,
            });
            if (result.sessionId)
                execution.sessionId = result.sessionId;
            if (result.aborted) {
                execution.status = 'aborted';
            }
            else if (result.exitCode === 0) {
                execution.status = 'completed';
            }
            else {
                execution.status = 'failed';
            }
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'execution:complete', data: { executionId: execution.id, status: execution.status } });
            if (execution.status === 'completed' && plan?.pipelineId && pipelineService && testExecutorService) {
                void triggerTestPhase(execution, plan, pipelineService, cliRunnerService, testExecutorService, testPersistStore, sandboxService);
            }
        }
        catch (err) {
            execution.status = 'failed';
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `Execution skip-continue failed: ${(0, error_utils_js_1.getErrorMessage)(err)}` } });
        }
    });
    /**
     * POST /api/execution/:id/abort
     * @description 中止执行任务，记录完成时间并通过 AbortController 终止 CLI 进程。
     * @param {string} id.path - 执行任务ID
     * @returns {{ status: 'aborted' }} 确认已中止
     */
    router.post('/:id/abort', (req, res) => {
        let execution = executionStore.get(req.params.id);
        if (!execution) {
            const persisted = persistStore.get(req.params.id);
            if (!persisted) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
                return;
            }
            execution = {
                ...persisted,
                abortController: new AbortController(),
                workspacePath: persisted.workspacePath,
            };
            executionStore.set(execution.id, execution);
        }
        execution.status = 'aborted';
        execution.completedAt = new Date().toISOString();
        execution.abortController?.abort();
        persistStore.upsert(toPersisted(execution));
        res.json({ status: 'aborted' });
    });
    /**
     * GET /api/execution/:id/status
     * @description 获取执行任务的详细状态和完整日志。
     *              优先从内存中读取（活跃执行的最新状态），未命中时回退到持久化存储。
     * @param {string} id.path - 执行任务ID
     * @returns {Object} 执行状态详情，包含日志数组
     */
    router.get('/:id/status', (req, res) => {
        // 优先检查内存中的活跃执行（状态更实时）
        const active = executionStore.get(req.params.id);
        if (active) {
            res.json({
                id: active.id,
                planId: active.planId,
                status: active.status,
                currentStep: active.currentStep,
                totalSteps: active.totalSteps,
                startedAt: active.startedAt,
                completedAt: active.completedAt,
                logs: active.logs,
            });
            return;
        }
        // 回退到持久化存储
        const persisted = persistStore.get(req.params.id);
        if (!persisted) {
            res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
            return;
        }
        res.json(persisted);
    });
    /**
     * DELETE /api/execution/:id
     * @description 删除执行记录，同时清除内存缓存和持久化存储中的数据
     * @param {string} id.path - 执行任务ID
     * @returns {{ success: boolean }} 删除操作是否成功
     */
    router.delete('/:id', (req, res) => {
        executionStore.delete(req.params.id);
        const deleted = persistStore.delete(req.params.id);
        res.json({ success: deleted });
    });
    /**
     * POST /api/execution/:id/reply
     * @description 在执行过程中向 Claude 发送追加消息（多轮对话）。
     *              需要执行存在活跃的会话（sessionId）才能回复。
     *              回复后执行状态恢复为 'running'，通过 WebSocket 广播输出。
     * @param {string} id.path - 执行任务ID
     * @param {string} message.body - 用户发送的消息内容（必填）
     * @returns {{ ok: boolean }} 确认消息已接收
     */
    router.post('/:id/reply', async (req, res) => {
        let execution = executionStore.get(req.params.id);
        // 内存未命中，从持久化存储恢复
        if (!execution) {
            const persisted = persistStore.get(req.params.id);
            if (!persisted) {
                res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
                return;
            }
            execution = {
                ...persisted,
                abortController: new AbortController(),
                workspacePath: persisted.workspacePath,
            };
            executionStore.set(execution.id, execution);
        }
        const { message } = req.body;
        if (!message?.trim()) {
            res.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
            return;
        }
        // 必须存在活跃的会话才能进行多轮对话
        if (!execution.sessionId) {
            res.status(400).json({ code: 'INVALID_STATE', message: 'No active session to reply to' });
            return;
        }
        // 先确认收到请求，异步执行回复处理
        res.json({ ok: true });
        // 将执行状态恢复为运行中，并广播用户消息
        execution.status = 'running';
        execution.logs.push(`\n**User:** ${message}\n`);
        (0, websocket_js_1.broadcast)({
            type: 'execution:output',
            data: { executionId: execution.id, stepIndex: execution.currentStep, content: `\n**User:** ${message}\n` }
        });
        try {
            // 在同一会话中继续对话，复用 sessionId 保持上下文连续性
            const result = await cliRunnerService.runBridge({
                prompt: (0, prompt_enrichment_js_1.enrichPrompt)(message, memoryService, execution.workspacePath || process.cwd()),
                cwd: execution.workspacePath || process.cwd(),
                sessionId: execution.sessionId,
                maxTurns: 50,
            }, {
                workspacePath: execution.workspacePath || process.cwd(),
                onOutput: (data) => {
                    execution.logs.push(data);
                    (0, websocket_js_1.broadcast)({
                        type: 'execution:output',
                        data: { executionId: execution.id, stepIndex: execution.currentStep, content: data }
                    });
                },
                signal: execution.abortController?.signal,
            });
            // 保存会话ID以便后续多轮对话
            if (result.sessionId)
                execution.sessionId = result.sessionId;
            // 根据中止状态和退出码设置最终状态
            if (result.aborted) {
                execution.status = 'aborted';
            }
            else if (result.exitCode === 0) {
                execution.status = 'completed';
            }
            else {
                execution.status = 'failed';
            }
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'execution:complete', data: { executionId: execution.id, status: execution.status } });
        }
        catch (err) {
            execution.status = 'failed';
            execution.completedAt = new Date().toISOString();
            persistStore.upsert(toPersisted(execution));
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `Execution reply failed: ${(0, error_utils_js_1.getErrorMessage)(err)}` } });
        }
    });
    return router;
}
// === 执行完成后自动触发测试阶段 ===
/**
 * 根据流水线配置，在执行完成后自动触发测试阶段。
 * 支持两种测试模式：
 * 1. 'run_existing': 使用 TestExecutorService 运行项目中已有的测试用例
 * 2. 其他（如 AI 生成模式）: 使用 CLIRunnerService 让 Claude 分析代码变更并编写测试
 *
 * 仅当 Pipeline 配置中 testStrategy.autoRunAfterExecution 为 true 时才会触发。
 *
 * @param execution - 已完成的执行对象
 * @param plan - 关联的开发计划对象
 * @param pipelineService - 流水线服务实例，用于获取测试策略配置
 * @param cliRunnerService - CLI 运行器服务实例，用于 AI 生成测试
 * @param testExecutorService - 测试执行器服务实例，用于运行已有测试
 * @param testPersistStore - 测试持久化存储服务实例，用于保存测试结果
 * @param sandboxService - 沙箱测试接入
 */
async function triggerTestPhase(execution, plan, pipelineService, cliRunnerService, testExecutorService, testPersistStore, sandboxService) {
    const pipeline = pipelineService.get(plan.pipelineId);
    if (!pipeline?.steps)
        return;
    const testStrategy = pipeline.steps.testStrategy;
    // 仅在配置了自动运行测试时触发
    if (!testStrategy.autoRunAfterExecution)
        return;
    const testRunId = crypto_1.default.randomUUID();
    // 从 Pipeline 配置中解析测试阶段的技能列表
    const testSkills = (0, skill_utils_js_1.getPhaseSkills)(pipeline.steps, 'test');
    // 如果配置了 changedFilesOnly，通过 git 命令获取变更文件列表
    // 包含已修改、已暂存和未跟踪的新文件
    let changedFiles;
    if (testStrategy.changedFilesOnly) {
        try {
            const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const changed = new Set();
            const run = (cmd) => {
                try {
                    const output = execSync(cmd, { cwd: plan.workspacePath, encoding: 'utf-8', timeout: 10000 });
                    output.split('\n').map(f => f.trim()).filter(Boolean).forEach(f => changed.add(f));
                }
                catch {
                }
            };
            run('git diff --name-only HEAD');
            run('git diff --cached --name-only');
            run('git ls-files --others --exclude-standard');
            changedFiles = [...changed];
        }
        catch {
            // git 命令失败时忽略，跑全量测试
        }
    }
    if (testStrategy.mode === 'run_existing') {
        // 模式一：运行已有的测试用例（支持变更文件定向测试）
        const testRun = {
            id: testRunId,
            status: 'running',
            mode: 'pipeline_run_existing',
            framework: testStrategy.framework,
            workspacePath: plan.workspacePath,
            executionId: execution.id,
            planId: plan.id,
            pipelineId: plan.pipelineId,
            startedAt: new Date().toISOString(),
        };
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:auto_start', data: { testRunId, executionId: execution.id, mode: 'run_existing' } });
        testExecutorService.runTests({
            workspacePath: plan.workspacePath,
            framework: testStrategy.framework || '',
            command: testStrategy.command,
            changedFiles,
            taskId: testRunId,
            sandboxId: testStrategy.environment === 'sandbox' ? testStrategy.sandboxId : undefined,
        }, {
            onOutput: (data) => {
                testRun.rawOutput = (testRun.rawOutput || '') + data;
                (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data } });
            },
        }).then((results) => {
            testRun.status = 'completed';
            testRun.results = results;
            testRun.completedAt = new Date().toISOString();
            testPersistStore.upsert(testRun);
            (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, results, status: 'completed' } });
        }).catch((err) => {
            testRun.status = 'failed';
            testRun.error = (0, error_utils_js_1.getErrorMessage)(err);
            testRun.completedAt = new Date().toISOString();
            testPersistStore.upsert(testRun);
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `Auto test run failed: ${testRun.error}` } });
        });
    }
    else if (testStrategy.mode === 'ai_generate_e2e') {
        // 模式三：AI 生成 Playwright E2E 测试文件，然后通过 Provider 结构化执行
        const testRun = {
            id: testRunId,
            status: 'running',
            mode: 'pipeline_ai_generate',
            workspacePath: plan.workspacePath,
            executionId: execution.id,
            planId: plan.id,
            pipelineId: plan.pipelineId,
            startedAt: new Date().toISOString(),
        };
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:auto_start', data: { testRunId, executionId: execution.id, mode: 'ai_generate_e2e' } });
        // E2E 测试生成的提示词：要求生成 Playwright 测试文件并保存到项目目录
        const e2ePrompt = `The execution has been completed. Now generate Playwright E2E tests for the UI changes.\n\n## Context\n- Workspace: ${plan.workspacePath}\n- Plan summary: ${plan.summary || 'See previous context'}\n\n## Instructions\n1. Review the code changes that were just made, focusing on UI/frontend changes\n2. Use the Playwright MCP browser tools to explore the application UI if needed\n3. Generate Playwright test files and save them to the project's e2e/ or tests/e2e/ directory\n4. Each test file should:\n   - Import from '@playwright/test'\n   - Test the key user flows affected by the changes\n   - Use meaningful test names that describe the scenario\n   - Include appropriate assertions\n5. After generating the files, verify they exist on disk\n\nImportant: Write the test files to disk using file write tools. Do NOT run the tests - they will be executed separately.\n\nRespond in the same language as the project.`;
        let accumulatedOutput = '';
        cliRunnerService.runBridge({
            prompt: e2ePrompt,
            cwd: plan.workspacePath,
            sessionId: execution.sessionId,
            maxTurns: 30,
            skills: testSkills,
        }, {
            workspacePath: plan.workspacePath,
            onOutput: (data) => {
                accumulatedOutput += data;
                testRun.rawOutput = accumulatedOutput;
                (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data } });
            },
        }).then(async (result) => {
            // AI 生成阶段完成，标记为 completed
            testRun.status = result.exitCode === 0 ? 'completed' : 'failed';
            testRun.rawOutput = accumulatedOutput;
            testRun.completedAt = new Date().toISOString();
            if (result.exitCode !== 0)
                testRun.error = 'AI E2E test generation failed';
            testPersistStore.upsert(testRun);
            (0, websocket_js_1.broadcast)({
                type: 'test:complete',
                data: { taskId: testRunId, status: testRun.status, rawOutput: accumulatedOutput }
            });
            // 如果生成成功，自动触发 Playwright Provider 执行生成的测试文件
            if (result.exitCode === 0) {
                const e2eRunId = crypto_1.default.randomUUID();
                const e2eRun = {
                    id: e2eRunId,
                    status: 'running',
                    mode: 'pipeline_run_existing',
                    framework: 'playwright',
                    workspacePath: plan.workspacePath,
                    executionId: execution.id,
                    planId: plan.id,
                    pipelineId: plan.pipelineId,
                    startedAt: new Date().toISOString(),
                };
                testPersistStore.upsert(e2eRun);
                (0, websocket_js_1.broadcast)({
                    type: 'test:auto_start',
                    data: { testRunId: e2eRunId, executionId: execution.id, mode: 'run_existing' }
                });
                try {
                    const e2eResults = await testExecutorService.runTests({
                        workspacePath: plan.workspacePath,
                        framework: 'playwright',
                        taskId: e2eRunId,
                        sandboxId: testStrategy.environment === 'sandbox' ? testStrategy.sandboxId : undefined,
                    }, {
                        onOutput: (data) => {
                            e2eRun.rawOutput = (e2eRun.rawOutput || '') + data;
                            (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: e2eRunId, content: data } });
                        },
                    });
                    e2eRun.status = 'completed';
                    e2eRun.results = e2eResults;
                    e2eRun.completedAt = new Date().toISOString();
                    testPersistStore.upsert(e2eRun);
                    (0, websocket_js_1.broadcast)({
                        type: 'test:complete',
                        data: { taskId: e2eRunId, results: e2eResults, status: 'completed' }
                    });
                }
                catch (err) {
                    e2eRun.status = 'failed';
                    e2eRun.error = (0, error_utils_js_1.getErrorMessage)(err);
                    e2eRun.completedAt = new Date().toISOString();
                    testPersistStore.upsert(e2eRun);
                    (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `E2E test execution failed: ${e2eRun.error}` } });
                }
            }
        }).catch((err) => {
            testRun.status = 'failed';
            testRun.error = (0, error_utils_js_1.getErrorMessage)(err);
            testRun.completedAt = new Date().toISOString();
            testPersistStore.upsert(testRun);
            (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `AI E2E test generation failed: ${testRun.error}` } });
        });
    }
    else {
        // 模式二（默认）：使用 AI（Claude）分析代码变更并生成测试
        const isSandboxMode = testStrategy.environment === 'sandbox' && !!testStrategy.sandboxId && !!sandboxService?.isEnabled();
        console.log(`[test-phase] ai_generate mode: environment=${testStrategy.environment}, sandboxId=${testStrategy.sandboxId || 'none'}, sandboxEnabled=${sandboxService?.isEnabled()}, isSandboxMode=${isSandboxMode}`);
        const testRun = {
            id: testRunId,
            status: 'running',
            mode: 'pipeline_ai_generate',
            workspacePath: plan.workspacePath,
            executionId: execution.id,
            planId: plan.id,
            pipelineId: plan.pipelineId,
            startedAt: new Date().toISOString(),
            environment: isSandboxMode ? 'sandbox' : 'local',
            sandboxId: isSandboxMode ? testStrategy.sandboxId : undefined,
            phases: [],
        };
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({
            type: 'test:auto_start',
            data: { testRunId, executionId: execution.id, mode: 'ai_generate', environment: testRun.environment }
        });
        if (isSandboxMode) {
            // === 沙箱三阶段流程 ===
            void executeAiGenerateSandbox(execution, plan, testStrategy, testRunId, testRun, cliRunnerService, testExecutorService, sandboxService, testPersistStore, testSkills, changedFiles);
        }
        else {
            // === 原有本地一体化流程（不变） ===
            const prompt = `The execution has been completed. Now analyze the changes made and write appropriate tests.\n\n## Context\n- Workspace: ${plan.workspacePath}\n- Plan summary: ${plan.summary || 'See previous context'}\n\n## Instructions\n1. Review the code changes that were just made\n2. Write appropriate unit and/or integration tests\n3. Run the tests and report results\n4. If tests fail, fix the issues and re-run\n\nRespond in the same language as the project.`;
            let accumulatedOutput = '';
            cliRunnerService.runBridge({
                prompt,
                cwd: plan.workspacePath,
                sessionId: execution.sessionId,
                maxTurns: 30,
                skills: testSkills,
            }, {
                workspacePath: plan.workspacePath,
                onOutput: (data) => {
                    accumulatedOutput += data;
                    testRun.rawOutput = accumulatedOutput;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data } });
                },
            }).then((result) => {
                testRun.status = result.exitCode === 0 ? 'completed' : 'failed';
                testRun.rawOutput = accumulatedOutput;
                testRun.completedAt = new Date().toISOString();
                if (result.exitCode !== 0)
                    testRun.error = 'AI test generation failed';
                testPersistStore.upsert(testRun);
                (0, websocket_js_1.broadcast)({
                    type: 'test:complete',
                    data: { taskId: testRunId, status: testRun.status, rawOutput: accumulatedOutput }
                });
            }).catch((err) => {
                testRun.status = 'failed';
                testRun.error = (0, error_utils_js_1.getErrorMessage)(err);
                testRun.completedAt = new Date().toISOString();
                testPersistStore.upsert(testRun);
                (0, websocket_js_1.broadcast)({ type: 'error', data: { message: `AI test generation failed: ${testRun.error}` } });
            });
        }
    }
}
/**
 * ai_generate 模式的沙箱三阶段测试执行流程
 *
 * Phase 1: AI 本地编写测试文件（需要读写 workspace）
 * Phase 2: 同步文件到沙箱并在沙箱中执行测试
 * Phase 3 (条件): AI 修复失败用例 + 沙箱重新执行
 */
async function executeAiGenerateSandbox(execution, plan, testStrategy, testRunId, testRun, cliRunnerService, testExecutorService, sandboxService, testPersistStore, testSkills, changedFiles) {
    const phases = testRun.phases;
    // === Phase 1: AI 编写测试文件（本地） ===
    const phase1Start = new Date().toISOString();
    testRun.currentPhase = 'writing';
    phases.push({ phase: 'writing', label: 'AI 编写测试文件', startedAt: phase1Start, status: 'running' });
    testPersistStore.upsert(testRun);
    (0, websocket_js_1.broadcast)({ type: 'test:phase_change', data: { taskId: testRunId, phase: 'writing', label: 'AI 编写测试文件' } });
    const writeOnlyPrompt = `The execution has been completed. Now analyze the changes made and write appropriate tests.\n\n## Context\n- Workspace: ${plan.workspacePath}\n- Plan summary: ${plan.summary || 'See previous context'}\n\n## Instructions\n1. Review the code changes that were just made\n2. Write appropriate unit and/or integration tests\n3. Save the test files to the project\n\nIMPORTANT: Do NOT run the tests. Only write and save the test files. Tests will be executed in a separate environment.\n\nRespond in the same language as the project.`;
    let phase1Output = '';
    try {
        const phase1Result = await cliRunnerService.runBridge({
            prompt: writeOnlyPrompt,
            cwd: plan.workspacePath,
            sessionId: execution.sessionId,
            maxTurns: 20,
            skills: testSkills,
        }, {
            workspacePath: plan.workspacePath,
            onOutput: (data) => {
                phase1Output += data;
                testRun.rawOutput = phase1Output;
                (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data, phase: 'writing' } });
            },
        });
        // Phase 1 完成
        phases[0].completedAt = new Date().toISOString();
        phases[0].status = phase1Result.exitCode === 0 ? 'completed' : 'failed';
        testPersistStore.upsert(testRun);
        if (phase1Result.exitCode !== 0) {
            // Phase 1 失败，终止流程
            testRun.status = 'failed';
            testRun.error = 'AI test file generation failed';
            testRun.completedAt = new Date().toISOString();
            testPersistStore.upsert(testRun);
            (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, status: 'failed', error: testRun.error } });
            return;
        }
    }
    catch (err) {
        phases[0].completedAt = new Date().toISOString();
        phases[0].status = 'failed';
        testRun.status = 'failed';
        testRun.error = `Phase 1 failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`;
        testRun.completedAt = new Date().toISOString();
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, status: 'failed', error: testRun.error } });
        return;
    }
    // === Phase 2: 沙箱执行测试 ===
    const phase2Start = new Date().toISOString();
    testRun.currentPhase = 'sandbox_run';
    phases.push({ phase: 'sandbox_run', label: '在沙箱中执行测试', startedAt: phase2Start, status: 'running' });
    testPersistStore.upsert(testRun);
    (0, websocket_js_1.broadcast)({ type: 'test:phase_change', data: { taskId: testRunId, phase: 'sandbox_run', label: '在沙箱中执行测试' } });
    // 同步变更文件到沙箱
    const syncOk = await sandboxService.syncChangedFiles(plan.workspacePath, testStrategy.sandboxId);
    if (!syncOk) {
        console.error(`[sandbox-test] File sync failed for sandbox "${testStrategy.sandboxId}"`);
        // 标记阶段失败并终止
        const runPhase = testRun.phases.find(p => p.phase === 'sandbox_run');
        if (runPhase) {
            runPhase.completedAt = new Date().toISOString();
            runPhase.status = 'failed';
        }
        testRun.status = 'failed';
        testRun.error = `Sandbox "${testStrategy.sandboxId}" is not available. File sync failed.`;
        testRun.completedAt = new Date().toISOString();
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, status: 'failed', error: testRun.error } });
        return;
    }
    let phase2Output = '';
    let sandboxResults;
    try {
        sandboxResults = await testExecutorService.runTests({
            workspacePath: plan.workspacePath,
            framework: testStrategy.framework || '',
            command: testStrategy.command,
            changedFiles,
            taskId: testRunId,
            sandboxId: testStrategy.sandboxId,
        }, {
            onOutput: (data) => {
                phase2Output += data;
                testRun.rawOutput = (testRun.rawOutput || '') + '\n--- Sandbox Test Output ---\n' + data;
                (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data, phase: 'sandbox_run' } });
            },
        });
        phases[1].completedAt = new Date().toISOString();
        phases[1].status = 'completed';
        testRun.results = sandboxResults;
        testPersistStore.upsert(testRun);
    }
    catch (err) {
        phases[1].completedAt = new Date().toISOString();
        phases[1].status = 'failed';
        testRun.status = 'failed';
        testRun.error = `Sandbox test execution failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`;
        testRun.completedAt = new Date().toISOString();
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, status: 'failed', error: testRun.error } });
        return;
    }
    // === Phase 3: AI 修复（条件：存在失败用例） ===
    if (sandboxResults.failed > 0) {
        const phase3Start = new Date().toISOString();
        testRun.currentPhase = 'fixing';
        phases.push({ phase: 'fixing', label: 'AI 修复失败用例', startedAt: phase3Start, status: 'running' });
        testPersistStore.upsert(testRun);
        (0, websocket_js_1.broadcast)({ type: 'test:phase_change', data: { taskId: testRunId, phase: 'fixing', label: 'AI 修复失败用例' } });
        // 构造失败详情
        const failureDetails = sandboxResults.suites
            ?.flatMap(s => s.tests?.filter(t => t.status === 'failed').map(t => `- [${s.name}] ${t.name}: ${t.error || 'Unknown error'}`) ?? [])
            .join('\n') || `${sandboxResults.failed} test(s) failed`;
        const fixPrompt = `The following tests failed when executed in the sandbox:\n\n${failureDetails}\n\n## Context\n- Workspace: ${plan.workspacePath}\n\n## Instructions\n1. Analyze the test failures above\n2. Fix the test files or source code to resolve the failures\n3. Do NOT run the tests - they will be executed separately\n\nRespond in the same language as the project.`;
        let phase3Output = '';
        try {
            const fixResult = await cliRunnerService.runBridge({
                prompt: fixPrompt,
                cwd: plan.workspacePath,
                sessionId: execution.sessionId,
                maxTurns: 15,
                skills: testSkills,
            }, {
                workspacePath: plan.workspacePath,
                onOutput: (data) => {
                    phase3Output += data;
                    testRun.rawOutput = (testRun.rawOutput || '') + '\n--- AI Fix Output ---\n' + data;
                    (0, websocket_js_1.broadcast)({ type: 'test:output', data: { taskId: testRunId, content: data, phase: 'fixing' } });
                },
            });
            const fixPhase = phases.find(p => p.phase === 'fixing');
            fixPhase.completedAt = new Date().toISOString();
            fixPhase.status = fixResult.exitCode === 0 ? 'completed' : 'failed';
            if (fixResult.exitCode === 0) {
                // 重新在沙箱中执行测试
                const rerunStart = new Date().toISOString();
                testRun.currentPhase = 'sandbox_rerun';
                phases.push({
                    phase: 'sandbox_rerun',
                    label: '在沙箱中重新执行测试',
                    startedAt: rerunStart,
                    status: 'running'
                });
                testPersistStore.upsert(testRun);
                (0, websocket_js_1.broadcast)({
                    type: 'test:phase_change',
                    data: { taskId: testRunId, phase: 'sandbox_rerun', label: '在沙箱中重新执行测试' }
                });
                // 再次同步修复后的文件
                const resyncOk = await sandboxService.syncChangedFiles(plan.workspacePath, testStrategy.sandboxId);
                if (!resyncOk) {
                    console.error(`[sandbox-test] Re-sync failed for sandbox "${testStrategy.sandboxId}"`);
                    const rerunPhase = testRun.phases.find(p => p.phase === 'sandbox_rerun');
                    if (rerunPhase) {
                        rerunPhase.completedAt = new Date().toISOString();
                        rerunPhase.status = 'failed';
                    }
                    testRun.status = 'failed';
                    testRun.error = `Sandbox "${testStrategy.sandboxId}" is not available. File sync failed during re-run.`;
                    testRun.completedAt = new Date().toISOString();
                    testPersistStore.upsert(testRun);
                    (0, websocket_js_1.broadcast)({
                        type: 'test:complete',
                        data: { taskId: testRunId, status: 'failed', error: testRun.error }
                    });
                    return;
                }
                let rerunOutput = '';
                const rerunResults = await testExecutorService.runTests({
                    workspacePath: plan.workspacePath,
                    framework: testStrategy.framework || '',
                    command: testStrategy.command,
                    changedFiles,
                    taskId: testRunId,
                    sandboxId: testStrategy.sandboxId,
                }, {
                    onOutput: (data) => {
                        rerunOutput += data;
                        testRun.rawOutput = (testRun.rawOutput || '') + '\n--- Sandbox Re-run Output ---\n' + data;
                        (0, websocket_js_1.broadcast)({
                            type: 'test:output',
                            data: { taskId: testRunId, content: data, phase: 'sandbox_rerun' }
                        });
                    },
                });
                // 使用重跑结果
                const rerunPhase = phases.find(p => p.phase === 'sandbox_rerun');
                rerunPhase.completedAt = new Date().toISOString();
                rerunPhase.status = 'completed';
                testRun.results = rerunResults;
            }
        }
        catch (err) {
            const fixPhase = phases.find(p => p.phase === 'fixing');
            fixPhase.completedAt = new Date().toISOString();
            fixPhase.status = 'failed';
            console.error(`[sandbox-test] AI fix phase failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    // 最终完成
    testRun.status = 'completed';
    testRun.currentPhase = undefined;
    testRun.completedAt = new Date().toISOString();
    testPersistStore.upsert(testRun);
    (0, websocket_js_1.broadcast)({ type: 'test:complete', data: { taskId: testRunId, status: 'completed', results: testRun.results } });
}
//# sourceMappingURL=execution.js.map