/**
 * @file Agent管理路由模块
 * @module routes/agents
 * @description 提供Agent相关的 RESTful API 路由，涵盖：
 *              - 列出可用Agent
 *              - 执行单个Agent或Agent工作流
 *              - 获取执行状态和历史
 *              - 中止Agent执行
 *              - WebSocket实时推送Agent执行状态
 */

import {Router} from 'express';
import crypto from 'crypto';
import {AgentsService} from '../services/agents/agents-service.js';
import {AgentStoreService, type AgentExecution} from '../services/agent-store-service.js';
import {getCoordinatorService, CoordinatorService} from '../services/agents/coordinator-service.js';
import {broadcast} from '../websocket.js';
import {getErrorMessage} from '../utils/error-utils.js';
import {LruCache} from '../utils/lru-cache.js';

/**
 * Agent执行进度步骤
 */
interface ProgressStep {
    type: string;
    content: string;
}

/**
 * 内存缓存，用于快速访问Agent执行数据。
 */
const agentExecutionCache = new LruCache<string, AgentExecution>(50);

/**
 * 跟踪正在执行的Agent的AbortController
 */
const activeExecutions = new Map<string, AbortController>();

/**
 * 跟踪执行计划（用于暂停/恢复）
 */
const executionPlans = new Map<string, any>();

/**
 * 从缓存或文件存储中查找Agent执行
 */
function findAgentExecution(executionId: string, agentStore: AgentStoreService): AgentExecution | undefined {
    let execution = agentExecutionCache.get(executionId);
    if (!execution) {
        execution = agentStore.get(executionId);
        if (execution) agentExecutionCache.set(execution.id, execution);
    }
    return execution;
}

/**
 * 持久化Agent执行数据到缓存和文件存储
 */
function persistAgentExecution(execution: AgentExecution, agentStore: AgentStoreService): void {
    agentStore.upsert(execution);
    agentExecutionCache.set(execution.id, execution);
}

/**
 * 标记Agent执行为失败状态
 */
function failAgentExecution(
    execution: AgentExecution,
    error: string,
    agentStore: AgentStoreService,
): void {
    execution.status = 'failed';
    execution.error = error;
    execution.updatedAt = new Date().toISOString();
    persistAgentExecution(execution, agentStore);
    activeExecutions.delete(execution.id);
    broadcast({
        type: 'agent:complete',
        data: {
            executionId: execution.id,
            agentId: execution.agentId,
            status: 'failed',
            error
        }
    });
}

/**
 * 创建Agent管理路由
 */
export function createAgentRoutes(): Router {
    const agentStore = new AgentStoreService();
    const agentService = new AgentsService();
    const coordinatorService = getCoordinatorService();
    const router = Router();

    // POST /api/agents/list - 列出可用Agent
    router.post('/list', async (_req, res) => {
        try {
            const agents = agentService.listAgents();
            res.json(agents);
        } catch (err) {
            res.status(500).json({code: 'AGENT_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/coordinator/execute - 协调Agent执行（Agent模式统一入口）
    // Agent页面和流水线共用此接口
    router.post('/coordinator/execute', async (req, res) => {
        try {
            const {requirement, workspace, context, taskId, planOnly} = req.body;

            if (!requirement || !workspace) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'requirement and workspace are required'});
                return;
            }

            // 创建执行记录
            const executionId = crypto.randomUUID();
            const execution: AgentExecution = {
                id: executionId,
                agentId: 'coordinator',
                taskId: taskId || executionId,
                status: 'running',
                inputData: {requirement, workspace, context},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            persistAgentExecution(execution, agentStore);

            res.json({executionId, planOnly}); // 返回planOnly标志

            // 如果只是生成计划，同步执行
            if (planOnly) {
                try {
                    const result = await coordinatorService.executeAgentMode(
                        requirement,
                        workspace,
                        {...context, planOnly: true}
                    );

                    execution.status = 'completed';
                    execution.result = {plan: result.plan, finalResult: undefined};
                    execution.updatedAt = new Date().toISOString();
                    persistAgentExecution(execution, agentStore);

                    broadcast({
                        type: 'agent:complete',
                        data: {
                            executionId,
                            agentId: 'coordinator',
                            status: 'completed',
                            result: execution.result
                        }
                    });
                } catch (err) {
                    failAgentExecution(execution, getErrorMessage(err), agentStore);
                }
                return;
            }

            // 异步执行协调Agent
            const abortController = new AbortController();
            activeExecutions.set(executionId, abortController);

            // 广播执行开始
            broadcast({
                type: 'agent:progress',
                data: {
                    executionId,
                    agentId: 'coordinator',
                    step: 'start',
                    message: '协调Agent开始分析需求...'
                }
            });

            try {
                // 使用协调服务执行
                const result = await coordinatorService.executeAgentMode(
                    requirement,
                    workspace,
                    context || {}
                );

                // 执行成功
                execution.status = 'completed';
                execution.result = {
                    plan: result.plan,
                    finalResult: result.finalResult
                };
                execution.quality = result.success ? 0.8 : 0;
                execution.duration = result.totalDuration;
                execution.tokensUsed = result.totalTokens;
                execution.updatedAt = new Date().toISOString();
                persistAgentExecution(execution, agentStore);
                activeExecutions.delete(executionId);

                broadcast({
                    type: 'agent:complete',
                    data: {
                        executionId,
                        agentId: 'coordinator',
                        status: 'completed',
                        result: execution.result
                    }
                });
            } catch (err) {
                failAgentExecution(execution, getErrorMessage(err), agentStore);
            }
        } catch (err) {
            res.status(500).json({code: 'COORDINATOR_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/coordinator/agents - 获取所有可用的Agent（含能力描述）
    router.get('/coordinator/agents', async (_req, res) => {
        try {
            const agents = coordinatorService.listAvailableAgents();
            res.json(agents);
        } catch (err) {
            res.status(500).json({code: 'AGENT_LIST_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/coordinator/recommend - 为特定任务推荐Agent
    router.post('/coordinator/recommend', async (req, res) => {
        try {
            const {taskDescription, minConfidence} = req.body;

            if (!taskDescription) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'taskDescription is required'});
                return;
            }

            const recommendations = coordinatorService.recommendAgents(
                taskDescription,
                minConfidence || 0.3
            );

            res.json(recommendations);
        } catch (err) {
            res.status(500).json({code: 'RECOMMEND_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/execute - 执行单个Agent
    router.post('/execute', async (req, res) => {
        try {
            const {agentType, taskId, inputData, options} = req.body;

            if (!agentType || !taskId) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'agentType and taskId are required'});
                return;
            }

            // 创建执行记录
            const executionId = crypto.randomUUID();
            const execution: AgentExecution = {
                id: executionId,
                agentId: agentType,
                taskId,
                status: 'running',
                inputData: inputData || {},
                options: options || {},
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            persistAgentExecution(execution, agentStore);

            res.json({executionId});

            // 异步执行Agent
            const abortController = new AbortController();
            activeExecutions.set(executionId, abortController);

            // 广播执行开始
            broadcast({
                type: 'agent:progress',
                data: {
                    executionId,
                    agentId: agentType,
                    step: 'start',
                    message: `Starting ${agentType} agent...`
                }
            });

            try {
                const result = await agentService.executeAgent({
                    agentType,
                    taskId,
                    inputData: inputData || {},
                    options: options || {}
                });

                // 执行成功
                execution.status = 'completed';
                execution.result = result.result;
                execution.quality = result.quality;
                execution.duration = result.duration;
                execution.tokensUsed = result.tokensUsed;
                execution.updatedAt = new Date().toISOString();
                persistAgentExecution(execution, agentStore);
                activeExecutions.delete(executionId);

                broadcast({
                    type: 'agent:complete',
                    data: {
                        executionId,
                        agentId: agentType,
                        status: 'completed',
                        result: result.result
                    }
                });
            } catch (err) {
                failAgentExecution(execution, getErrorMessage(err), agentStore);
            }
        } catch (err) {
            res.status(500).json({code: 'EXECUTION_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/workflow - 执行Agent工作流
    router.post('/workflow', async (req, res) => {
        try {
            const {agentType, taskId, inputData, workflowType, options} = req.body;

            if (!agentType || !taskId) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'agentType and taskId are required'});
                return;
            }

            // 创建执行记录
            const executionId = crypto.randomUUID();
            const execution: AgentExecution = {
                id: executionId,
                agentId: agentType,
                taskId,
                status: 'running',
                inputData: inputData || {},
                workflowType,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            persistAgentExecution(execution, agentStore);

            res.json({executionId});

            // 异步执行工作流
            const abortController = new AbortController();
            activeExecutions.set(executionId, abortController);

            broadcast({
                type: 'agent:progress',
                data: {
                    executionId,
                    agentId: agentType,
                    step: 'start',
                    message: `Starting ${workflowType || 'standard'} workflow...`
                }
            });

            try {
                // workflow需要特殊配置，目前使用executeAgent
                const result = await agentService.executeAgent({
                    agentType,
                    taskId,
                    inputData: inputData || {},
                    options: options || {}
                });

                execution.status = 'completed';
                execution.result = result.result;
                execution.updatedAt = new Date().toISOString();
                persistAgentExecution(execution, agentStore);
                activeExecutions.delete(executionId);

                broadcast({
                    type: 'agent:complete',
                    data: {
                        executionId,
                        agentId: agentType,
                        status: 'completed',
                        result: result.result
                    }
                });
            } catch (err) {
                failAgentExecution(execution, getErrorMessage(err), agentStore);
            }
        } catch (err) {
            res.status(500).json({code: 'WORKFLOW_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/coordinator/confirm-execution - 确认执行计划后开始执行
    router.post('/coordinator/confirm-execution', async (req, res) => {
        try {
            const {executionId} = req.body;

            if (!executionId) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'executionId is required'});
                return;
            }

            const execution = findAgentExecution(executionId, agentStore);
            if (!execution) {
                res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
                return;
            }

            // 检查是否已有执行计划
            const storedPlan = execution.result as any;
            if (!storedPlan?.plan) {
                res.status(400).json({code: 'INVALID_STATE', message: 'No plan found. Please generate plan first.'});
                return;
            }

            execution.status = 'running';
            execution.updatedAt = new Date().toISOString();
            persistAgentExecution(execution, agentStore);

            res.json({ok: true});

            // 异步执行协调Agent
            const abortController = new AbortController();
            activeExecutions.set(executionId, abortController);

            // 广播执行开始
            broadcast({
                type: 'agent:progress',
                data: {
                    executionId,
                    agentId: 'coordinator',
                    step: 'start',
                    message: '开始执行计划...'
                }
            });

            try {
                const context = execution.inputData.context as any || {};
                const plan = storedPlan.plan;

                // 存储执行计划用于暂停/恢复
                executionPlans.set(executionId, plan);

                // 创建进度回调
                const onProgress = (step: any, currentPlan: any) => {
                    broadcast({
                        type: 'agent:step-progress',
                        data: {
                            executionId,
                            step: {
                                order: step.order,
                                agentId: step.agentId,
                                agentName: step.agentName,
                                status: step.status,
                                reasoning: step.reasoning,
                                confidence: step.confidence
                            }
                        }
                    });

                    // 更新存储的计划
                    const stored = executionPlans.get(executionId);
                    if (stored) {
                        executionPlans.set(executionId, currentPlan);
                    }
                };

                // 执行协调Agent，传入进度回调
                const result = await coordinatorService.executeAgentMode(
                    execution.inputData.requirement as string,
                    execution.inputData.workspace as string,
                    {...context, planId: executionId, onProgress}
                );

                // 执行成功
                execution.status = 'completed';
                execution.result = {
                    plan: result.plan,
                    finalResult: result.finalResult
                };
                execution.quality = result.success ? 0.8 : 0;
                execution.duration = result.totalDuration;
                execution.tokensUsed = result.totalTokens;
                execution.updatedAt = new Date().toISOString();
                persistAgentExecution(execution, agentStore);
                executionPlans.delete(executionId);
                activeExecutions.delete(executionId);

                broadcast({
                    type: 'agent:complete',
                    data: {
                        executionId,
                        agentId: 'coordinator',
                        status: 'completed',
                        result: execution.result
                    }
                });
            } catch (err) {
                failAgentExecution(execution, getErrorMessage(err), agentStore);
            }
        } catch (err) {
            res.status(500).json({code: 'CONFIRM_EXECUTION_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /api/agents/status/:id - 获取执行状态
    router.get('/status/:id', (req, res) => {
        const execution = findAgentExecution(req.params.id, agentStore);
        if (!execution) {
            res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
            return;
        }
        res.json(execution);
    });

    // GET /api/agents/history - 获取执行历史
    router.get('/history', async (_req, res) => {
        try {
            const executions = await agentStore.list();
            res.json(executions.map(e => ({
                id: e.id,
                agentId: e.agentId,
                taskId: e.taskId,
                status: e.status,
                quality: e.quality,
                duration: e.duration,
                createdAt: e.createdAt,
                updatedAt: e.updatedAt
            })));
        } catch (err) {
            res.status(500).json({code: 'STORE_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/agents/pause/:id - 暂停执行
    router.post('/pause/:id', (req, res) => {
        const execution = findAgentExecution(req.params.id, agentStore);
        if (!execution) {
            res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
            return;
        }

        if (execution.status !== 'running') {
            res.status(400).json({code: 'INVALID_STATE', message: 'Agent is not running'});
            return;
        }

        // 设置暂停标志
        const plan = executionPlans.get(req.params.id);
        if (plan) {
            plan.pauseRequested = true;
        }

        execution.status = 'paused';
        execution.updatedAt = new Date().toISOString();
        persistAgentExecution(execution, agentStore);

        broadcast({
            type: 'agent:paused',
            data: {
                executionId: execution.id,
                agentId: execution.agentId
            }
        });

        res.json({ok: true});
    });

    // POST /api/agents/resume/:id - 恢复执行
    router.post('/resume/:id', async (req, res) => {
        const execution = findAgentExecution(req.params.id, agentStore);
        if (!execution) {
            res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
            return;
        }

        if (execution.status !== 'paused') {
            res.status(400).json({code: 'INVALID_STATE', message: 'Agent is not paused'});
            return;
        }

        execution.status = 'running';
        execution.updatedAt = new Date().toISOString();
        persistAgentExecution(execution, agentStore);

        res.json({ok: true});

        // 恢复执行
        const plan = executionPlans.get(req.params.id);
        if (plan) {
            plan.pauseRequested = false;
        }

        // 广播恢复执行
        broadcast({
            type: 'agent:progress',
            data: {
                executionId: req.params.id,
                agentId: 'coordinator',
                step: 'resume',
                message: '恢复执行...'
            }
        });
    });

    // POST /api/agents/answer - 回答Agent问题
    router.post('/answer', async (req, res) => {
        try {
            const {executionId, answer} = req.body;

            if (!executionId || !answer) {
                res.status(400).json({code: 'VALIDATION_ERROR', message: 'executionId and answer are required'});
                return;
            }

            const plan = executionPlans.get(executionId);
            if (!plan || !plan.userQuestions) {
                res.status(404).json({code: 'NOT_FOUND', message: 'No active question found'});
                return;
            }

            // 找到未回答的问题
            const unansweredQuestion = plan.userQuestions.find((q: any) => !q.answer);
            if (!unansweredQuestion) {
                res.status(400).json({code: 'INVALID_STATE', message: 'No unanswered question found'});
                return;
            }

            // 记录用户回答
            unansweredQuestion.answer = answer;

            // 如果执行失败或暂停，恢复为运行状态
            const execution = findAgentExecution(executionId, agentStore);
            if (execution && (execution.status === 'failed' || execution.status === 'paused')) {
                execution.status = 'running';
                execution.updatedAt = new Date().toISOString();
                persistAgentExecution(execution, agentStore);

                // 广播状态恢复
                broadcast({
                    type: 'agent:progress',
                    data: {
                        executionId,
                        agentId: execution.agentId,
                        step: 'resume',
                        message: '收到用户回答，继续执行...'
                    }
                });
            }

            // 广播回答已接收
            broadcast({
                type: 'agent:answer_received',
                data: {executionId}
            });

            res.json({ok: true});
        } catch (err) {
            res.status(500).json({code: 'ANSWER_ERROR', message: getErrorMessage(err)});
        }
    });

    // DELETE /api/agents/:id - 删除执行记录
    router.delete('/:id', (req, res) => {
        const execution = findAgentExecution(req.params.id, agentStore);
        if (!execution) {
            res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
            return;
        }

        // 如果正在执行，先中止
        if (execution.status === 'running') {
            const ac = activeExecutions.get(req.params.id);
            if (ac) {
                ac.abort();
                activeExecutions.delete(req.params.id);
            }
        }

        // 删除执行记录
        const deleted = agentStore.delete(req.params.id);

        if (deleted) {
            executionPlans.delete(req.params.id);
            res.json({ok: true});
        } else {
            res.status(500).json({code: 'DELETE_ERROR', message: 'Failed to delete execution file'});
        }
    });

    // POST /api/agents/abort/:id - 中止执行
    router.post('/abort/:id', (req, res) => {
        const execution = findAgentExecution(req.params.id, agentStore);
        if (!execution) {
            res.status(404).json({code: 'NOT_FOUND', message: 'Agent execution not found'});
            return;
        }

        if (execution.status !== 'running') {
            res.status(400).json({code: 'INVALID_STATE', message: 'Agent is not running'});
            return;
        }

        const ac = activeExecutions.get(req.params.id);
        if (ac) {
            ac.abort();
            activeExecutions.delete(req.params.id);
        }

        execution.status = 'aborted';
        execution.updatedAt = new Date().toISOString();
        persistAgentExecution(execution, agentStore);

        broadcast({
            type: 'agent:complete',
            data: {
                executionId: execution.id,
                agentId: execution.agentId,
                status: 'aborted'
            }
        });

        res.json({ok: true});
    });

    return router;
}
