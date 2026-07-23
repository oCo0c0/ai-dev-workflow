/**
 * @file Agent Execution Routes
 * @description Agent执行API路由 - 简化版：直接执行，无复杂子任务管理
 */

import {Router} from 'express';
import {AgentExecutionStore} from '../services/agent-execution-store.js';
import {createAgentCoordinator, type CoordinatorConfig} from '../services/agent-coordinator.js';
import {broadcast} from '../websocket.js';

export function createAgentExecutionRoutes(config: CoordinatorConfig): Router {
    const router = Router();
    const store = AgentExecutionStore.getInstance();
    const coordinator = createAgentCoordinator(config);

    /**
     * GET /api/agent-execution/list
     * 列出所有执行记录
     */
    router.get('/list', async (_req, res) => {
        try {
            const list = await store.list();
            res.json(list);
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * POST /api/agent-execution/create
     * 创建新执行记录（准备状态，等待启动）
     */
    router.post('/create', async (req, res) => {
        try {
            const {requirementText, workspacePath} = req.body;

            if (!requirementText || typeof requirementText !== 'string') {
                return res.status(400).json({code: 'VALIDATION_ERROR', message: 'requirementText is required'});
            }

            const requirementId = req.body.requirementId || `manual-${Date.now()}`;

            const execution = await store.create({
                requirementId,
                requirementText,
                requirementNumber: req.body.requirementNumber,
                requirementTitle: req.body.requirementTitle || requirementText.split('\n')[0].substring(0, 50),
                workspacePath: workspacePath || '',
                status: 'ready',
            });

            res.json({executionId: execution.id});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * POST /api/agent-execution/:id/start
     * 开始执行
     */
    router.post('/:id/start', async (req, res) => {
        try {
            const {id} = req.params;

            const execution = await store.get(id);
            if (!execution) {
                return res.status(404).json({code: 'NOT_FOUND', message: 'Execution not found'});
            }

            if (execution.status !== 'ready' && execution.status !== 'paused') {
                return res.status(400).json({
                    code: 'INVALID_STATUS',
                    message: `Execution is not ready: ${execution.status}`
                });
            }

            // 异步执行（不阻塞响应）；coordinator 内部已处理错误（更新状态+广播）
            coordinator.execute(id).catch(error => {
                console.error('Execution error:', error);
                // coordinator 已广播 failed 状态，此处仅兜底广播
                broadcast({type: 'agent-execution:status', data: {executionId: id, status: 'failed'}});
            });

            res.json({success: true});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * POST /api/agent-execution/:id/abort
     * 中止执行
     */
    router.post('/:id/abort', async (req, res) => {
        try {
            const {id} = req.params;
            coordinator.abort(id);
            await store.updateStatus(id, 'aborted');
            res.json({success: true});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * POST /api/agent-execution/:id/reply
     * 发送回复消息
     */
    router.post('/:id/reply', async (req, res) => {
        try {
            const {id} = req.params;
            const {message} = req.body || {};

            if (!message || typeof message !== 'string') {
                return res.status(400).json({code: 'VALIDATION_ERROR', message: 'message is required'});
            }

            if (message.length > 10000) {
                return res.status(400).json({
                    code: 'VALIDATION_ERROR',
                    message: 'message is too long (max 10000 characters)'
                });
            }

            const execution = await store.get(id);
            if (!execution) {
                return res.status(404).json({code: 'NOT_FOUND', message: 'Execution not found'});
            }

            // 添加用户消息到日志（coordinator 会通过 onOutput 再次广播，此处不再重复广播）
            const userMsg = `**User:** ${message}`;
            await store.addLog(id, userMsg);

            // 如果执行已完成/失败/中止，直接重新执行（coordinator 内部会设 running 并广播）
            if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'aborted') {
                // 异步自动执行，无需用户手动点开始
                coordinator.execute(id).catch(error => {
                    console.error('Auto-execute after reply error:', error);
                });
            }

            res.json({success: true});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * POST /api/agent-execution/:id/new-session
     * 创建新会话（清空上下文）
     */
    router.post('/:id/new-session', async (req, res) => {
        try {
            const execution = await store.get(req.params.id);
            if (!execution) {
                return res.status(404).json({code: 'NOT_FOUND', message: 'Execution not found'});
            }

            await store.updateSessionId(req.params.id, undefined);
            res.json({success: true});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * GET /api/agent-execution/:id/detail
     * 获取执行详情
     */
    router.get('/:id/detail', async (req, res) => {
        try {
            const {id} = req.params;

            const execution = await store.get(id);
            if (!execution) {
                return res.status(404).json({code: 'NOT_FOUND', message: 'Execution not found'});
            }

            res.json(execution);
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    /**
     * DELETE /api/agent-execution/:id
     * 删除执行记录
     */
    router.delete('/:id', async (req, res) => {
        try {
            const {id} = req.params;

            const deleted = await store.delete(id);
            if (!deleted) {
                return res.status(404).json({code: 'NOT_FOUND', message: 'Execution not found'});
            }

            res.json({success: true});
        } catch (error) {
            res.status(500).json({code: 'INTERNAL_ERROR', message: (error as Error).message});
        }
    });

    return router;
}
