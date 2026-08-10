/**
 * @file Agent Coordinator (通用设计，不依赖特定格式)
 * @description 执行Agent并透传所有输出，解析结构化事件（thinking/tool_use/tool_result），
 *              生成思考过程、执行步骤、子任务数据并广播给前端。
 *
 * 执行模式：
 * - 首次运行（无 subTasks / 无 session / 无用户回复）：先 LLM 任务分解（2-8 个子任务），
 *   再串行执行每个子任务（复用 session 续接）；分解失败降级为单次执行。
 * - 续接 / 用户回复：跳过分解，直接单次执行（沿用旧行为）。
 */

import {randomUUID} from 'crypto';
import {AgentExecutionStore} from './agent-execution-store.js';
import {CLIRunnerService} from './cli-runner-service.js';
import {broadcast} from '../websocket.js';
import {renderPrompt} from '../utils/prompt-renderer.js';
import {PROMPTS} from '../prompts/index.js';
import {enrichPrompt} from '../utils/prompt-enrichment.js';
import {runBridgeJson} from '../utils/bridge-json-runner.js';
import {validateShape, type FieldSpec} from '../utils/json-validator.js';
import {getErrorMessage} from '../utils/error-utils.js';
import type {AgentExecution, SubTask} from '../../types/agent-execution.js';
import type {MemoryService} from './memory/memory-service.js';

export interface CoordinatorConfig {
    cliRunner: CLIRunnerService;
    workspacePath?: string;
    /** 记忆服务（可选，用于 enrichPrompt 注入项目上下文） */
    memoryService?: MemoryService;
}

// 只有写操作工具才创建独立步骤（Read/Glob/Grep 等读操作是噪声）
const STEP_TOOLS = new Set([
    'Write', 'Edit', 'NotebookEdit', 'Bash', 'TaskCreate',
    'Workflow', 'Skill', 'CronCreate', 'CronDelete',
]);

/** 任务分解输出校验规格：{subTasks: [{id?, title, description?}]}，1-8 项 */
const SUBTASK_DECOMPOSE_SPEC: Record<string, FieldSpec> = {
    subTasks: {
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 8,
        item: {
            type: 'object',
            fields: {
                id: {type: 'string', required: false},
                title: {type: 'string', required: true, minLength: 2},
                description: {type: 'string', required: false},
            },
        },
    },
};

export class AgentCoordinator {
    private store = AgentExecutionStore.getInstance();
    private abortControllers = new Map<string, AbortController>();
    /** 每个执行已「允许并记住」的工具名白名单（executionId → toolNames） */
    private allowedTools = new Map<string, Set<string>>();
    /** 挂起的权限请求：permissionRequestId → {executionId, toolName} */
    private pendingPermissions = new Map<string, { executionId: string; toolName: string }>();
    private config: CoordinatorConfig;

    constructor(config: CoordinatorConfig) {
        this.config = config;
    }

    /**
     * 执行 Agent — 首次运行任务分解 + 串行子任务 / 单次执行
     */
    async execute(executionId: string): Promise<void> {
        const execution = await this.store.get(executionId);
        if (!execution) throw new Error('Execution not found');

        const controller = new AbortController();
        this.abortControllers.set(executionId, controller);

        try {
            await this.store.updateStatus(executionId, 'running');
            this.broadcastStatus(executionId, 'running');

            const cwd = execution.workspacePath || this.config.workspacePath || process.cwd();

            // 从日志中提取用户回复消息（兼容新旧两种格式），拼入 prompt 让 Agent 看到后续指令
            const userReplies = execution.logs
                .map(log => {
                    // 新格式：JSON {type: 'user', content: '...'}
                    try {
                        const parsed = JSON.parse(log);
                        if (parsed.type === 'user') return parsed.content || '';
                    } catch { /* fall through */ }
                    // 旧格式：**User:** 前缀（向后兼容）
                    if (log.startsWith('**User:**')) return log.replace('**User:** ', '');
                    return null;
                })
                .filter((r): r is string => r !== null && r.length > 0);

            // 仅「首次运行」做任务分解：已有 subTasks / 已有会话 / 有用户回复都跳过
            let subTasks = execution.subTasks ?? [];
            // 所有子任务均已结束且本次为回复/续接 → 回退单次执行，让用户补充信息生效
            const allTerminal = subTasks.length > 0
                && subTasks.every(t => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped');
            if (allTerminal && (userReplies.length > 0 || execution.sessionId)) {
                subTasks = [];
            }
            if (subTasks.length === 0 && !execution.sessionId && userReplies.length === 0) {
                subTasks = await this.tryDecompose(execution, cwd, controller.signal);
            }

            // 分解过程中被中止：直接终态，避免空跑一次 bridge
            if (controller.signal.aborted) {
                await this.finalizeSteps(executionId, 'aborted');
                await this.store.updateStatus(executionId, 'aborted');
                this.broadcastStatus(executionId, 'aborted');
                this.broadcastComplete(executionId, 'aborted');
                return;
            }

            if (subTasks.length > 0) {
                await this.runSubTaskLoop(executionId, execution, cwd, subTasks, controller);
            } else {
                await this.runSingleShot(executionId, execution, cwd, controller, userReplies);
            }
        } catch (error) {
            console.error(`[coordinator] execute error:`, error);
            await this.finalizeSteps(executionId, 'failed');
            await this.store.updateStatus(executionId, 'failed');
            await this.store.addLog(executionId, `执行失败: ${(error as Error).message}`);
            this.broadcastStatus(executionId, 'failed');
            this.broadcastComplete(executionId, 'failed');
        } finally {
            this.abortControllers.delete(executionId);
            // 执行结束清理本次白名单与挂起权限（bridge 侧超时兜底会处理残留）
            this.allowedTools.delete(executionId);
            this.denyPendingPermissions(executionId, '执行已结束');
        }
    }

    /**
     * 构造输出处理器（单次与子任务循环共用）。
     * 日志记录 tool_result 截取摘要；结构化事件分发 thinking/tool_use/tool_result。
     */
    private makeOutputHandler(executionId: string): (data: string, meta?: Record<string, unknown>) => void {
        return (data: string, meta?: Record<string, unknown>) => {
            // 日志记录：tool_result 可能包含完整文件内容（几KB~几十KB），
            // 只截取摘要存入日志，避免上下文爆炸
            if (data) {
                const logData = meta?.type === 'tool_result'
                    ? data.slice(0, 200) + (data.length > 200 ? '...' : '')
                    : data;
                // Store 写成功后再广播，保证前端收到日志时数据已持久化
                this.store.addLog(executionId, logData)
                    .then(() => this.broadcastLog(executionId, logData))
                    .catch(err => {
                        console.error(`[coordinator] addLog failed for ${executionId}:`, err);
                    });
            }

            // 结构化事件 → 写 store + 广播 rich events
            if (!meta) return;

            switch (meta.type) {
                case 'thinking':
                    this.handleThinking(executionId, data).catch(err => {
                        console.error(`[coordinator] handleThinking failed:`, err);
                    });
                    break;
                case 'tool_use':
                    this.handleToolUse(executionId, meta).catch(err => {
                        console.error(`[coordinator] handleToolUse failed:`, err);
                    });
                    break;
                case 'tool_result':
                    this.handleToolResult(executionId, meta).catch(err => {
                        console.error(`[coordinator] handleToolResult failed:`, err);
                    });
                    break;
            }
        };
    }

    /** 构造权限请求处理器（单次与子任务循环共用） */
    private makePermissionHandler(executionId: string): (meta: Record<string, unknown>) => void {
        return (meta) => this.handlePermissionRequest(executionId, meta);
    }

    /**
     * LLM 任务分解。成功写入 subTasks 并广播 agent-execution:plan；
     * 失败降级返回 []，由 execute() 回退到单次执行模式。
     */
    private async tryDecompose(execution: AgentExecution, cwd: string, signal: AbortSignal): Promise<SubTask[]> {
        try {
            const promptText = enrichPrompt(
                renderPrompt(PROMPTS.agentDecompose, {
                    requirementText: execution.requirementText || '',
                    cwd,
                }),
                this.config.memoryService,
                cwd,
            );

            const result = await runBridgeJson<{
                subTasks: Array<{ id?: string; title: string; description?: string }>
            }>({
                cliRunner: this.config.cliRunner,
                prompt: promptText,
                cwd,
                signal,
                maxTurns: 10,
                maxRetries: 2,
                validator: (value) => validateShape(value, SUBTASK_DECOMPOSE_SPEC),
            });

            if (!result.ok || !result.data || !Array.isArray(result.data.subTasks) || result.data.subTasks.length === 0) {
                throw new Error(result.validationErrors?.join('; ') || result.error || '分解失败');
            }

            const subTasks: SubTask[] = result.data.subTasks.map((t, i) => ({
                id: t.id ?? `sub-${i + 1}`,
                title: t.title,
                description: t.description,
                status: 'pending',
                order: i,
            }));

            await this.store.setSubTasks(execution.id, subTasks);
            broadcast({
                type: 'agent-execution:plan',
                data: {executionId: execution.id, subTasks},
            });
            await this.store.addLog(execution.id, `已分解为 ${subTasks.length} 个子任务`);
            return subTasks;
        } catch (err) {
            console.warn(`[coordinator] 任务分解失败，将以单次执行模式继续: ${getErrorMessage(err)}`);
            await this.store.addLog(execution.id, '任务分解失败，将以单次执行模式继续').catch(() => undefined);
            return [];
        }
    }

    /**
     * 串行执行子任务循环，复用 session 续接。
     * 每个子任务独立 runBridge；子任务边界收尾 tool steps。
     */
    private async runSubTaskLoop(
        executionId: string,
        execution: AgentExecution,
        cwd: string,
        subTasks: SubTask[],
        controller: AbortController,
    ): Promise<void> {
        let lastSessionId = execution.sessionId;
        let overall: 'completed' | 'failed' | 'aborted' = 'completed';

        for (const sub of subTasks) {
            if (controller.signal.aborted) {
                overall = 'aborted';
                break;
            }

            // 恢复执行时跳过已完成/已跳过的子任务
            const current = (await this.store.get(executionId))?.subTasks.find(t => t.id === sub.id);
            if (current && (current.status === 'completed' || current.status === 'skipped')) continue;

            await this.store.updateSubTask(executionId, sub.id, {
                status: 'running',
                startedAt: new Date().toISOString(),
            }).catch(() => undefined);
            broadcast({
                type: 'agent-execution:subtask',
                data: {executionId, subTaskId: sub.id, title: sub.title, status: 'running'},
            });

            const completedTitles = subTasks
                .filter(t => t.order < sub.order)
                .map(t => `- ${t.title}`)
                .join('\n');

            const subPrompt = enrichPrompt(
                renderPrompt(PROMPTS.agentSubTask, {
                    subTaskTitle: sub.title,
                    subTaskDescription: sub.description ?? '',
                    completedTitles,
                }),
                this.config.memoryService,
                cwd,
            );

            const result = await this.config.cliRunner.runBridge(
                {
                    prompt: subPrompt,
                    cwd,
                    ...(lastSessionId ? {sessionId: lastSessionId} : {}),
                    maxTurns: 50,
                },
                {
                    workspacePath: cwd,
                    signal: controller.signal,
                    onOutput: this.makeOutputHandler(executionId),
                    onPermissionRequest: this.makePermissionHandler(executionId),
                }
            );

            if (result.sessionId) lastSessionId = result.sessionId;

            // 子任务边界：收尾该子任务内的 tool steps，避免残留 running 步骤
            await this.finalizeSteps(executionId, result.exitCode === 0 ? 'completed' : 'failed');

            if (result.aborted) {
                overall = 'aborted';
                await this.store.updateSubTask(executionId, sub.id, {
                    status: 'failed',
                    error: '已中止',
                    completedAt: new Date().toISOString(),
                }).catch(() => undefined);
                broadcast({
                    type: 'agent-execution:subtask',
                    data: {executionId, subTaskId: sub.id, title: sub.title, status: 'failed'},
                });
                break;
            }

            if (result.exitCode === 0) {
                await this.store.updateSubTask(executionId, sub.id, {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    output: (result.stdout || '').slice(0, 500),
                }).catch(() => undefined);
                broadcast({
                    type: 'agent-execution:subtask',
                    data: {executionId, subTaskId: sub.id, title: sub.title, status: 'completed'},
                });
            } else {
                overall = 'failed';
                const errMsg = result.stderr || '未知错误';
                await this.store.updateSubTask(executionId, sub.id, {
                    status: 'failed',
                    error: errMsg.slice(0, 500),
                    completedAt: new Date().toISOString(),
                }).catch(() => undefined);
                broadcast({
                    type: 'agent-execution:subtask',
                    data: {executionId, subTaskId: sub.id, title: sub.title, status: 'failed'},
                });
                await this.store.addLog(executionId, `子任务「${sub.title}」执行失败（退出码 ${result.exitCode}）: ${errMsg}`).catch(() => undefined);
                break;
            }
        }

        // 剩余 pending 子任务标记 skipped + 持久化最后一个 sessionId 供续接
        const latest = await this.store.get(executionId);
        if (latest) {
            for (const r of latest.subTasks) {
                if (r.status === 'pending') {
                    await this.store.updateSubTask(executionId, r.id, {status: 'skipped'}).catch(() => undefined);
                }
            }
            if (lastSessionId && latest.sessionId !== lastSessionId) {
                latest.sessionId = lastSessionId;
                await this.store.updateFull(latest).catch(() => undefined);
            }
        }

        // 终态
        await this.finalizeSteps(executionId, overall);
        await this.store.updateStatus(executionId, overall);
        this.broadcastStatus(executionId, overall);
        this.broadcastComplete(executionId, overall);
        if (overall === 'aborted') {
            await this.store.addLog(executionId, '执行已中止').catch(() => undefined);
        }
    }

    /**
     * 单次执行模式（未分解或分解失败降级）：保留旧行为。
     */
    private async runSingleShot(
        executionId: string,
        execution: AgentExecution,
        cwd: string,
        controller: AbortController,
        userReplies: string[],
    ): Promise<void> {
        let prompt: string;
        if (userReplies.length > 0 && execution.sessionId) {
            // 续接会话：带上用户补充信息
            const repliesText = userReplies.map(r => `- ${r}`).join('\n');
            prompt = renderPrompt(PROMPTS.agentReply, {repliesText});
        } else if (userReplies.length > 0 && !execution.sessionId) {
            // 首次执行但用户已在回复框补充了详细信息 → 合并到 requirementText
            const repliesText = userReplies.join('\n');
            const fullRequirement = execution.requirementText + '\n\n用户补充说明：\n' + repliesText;
            prompt = renderPrompt(PROMPTS.agentStart, {requirementText: fullRequirement, cwd});
        } else {
            // 首次执行
            prompt = renderPrompt(PROMPTS.agentStart, {requirementText: execution.requirementText, cwd});
        }

        const result = await this.config.cliRunner.runBridge(
            {
                prompt,
                cwd,
                ...(execution.sessionId ? {sessionId: execution.sessionId} : {}),
                maxTurns: 50,
            },
            {
                workspacePath: cwd,
                signal: controller.signal,
                onOutput: this.makeOutputHandler(executionId),
                onPermissionRequest: this.makePermissionHandler(executionId),
            }
        );

        // 保存 sessionId 用于续接
        if (result.sessionId) {
            const exec = await this.store.get(executionId);
            if (exec) {
                exec.sessionId = result.sessionId;
                await this.store.updateFull(exec);
            }
        }

        if (result.aborted) {
            await this.finalizeSteps(executionId, 'aborted');
            await this.store.updateStatus(executionId, 'aborted');
            this.broadcastStatus(executionId, 'aborted');
            this.broadcastComplete(executionId, 'aborted');
        } else if (result.exitCode === 0) {
            await this.finalizeSteps(executionId, 'completed');
            await this.store.updateStatus(executionId, 'completed');
            this.broadcastStatus(executionId, 'completed');
            this.broadcastComplete(executionId, 'completed');
        } else {
            await this.finalizeSteps(executionId, 'failed');
            await this.store.updateStatus(executionId, 'failed');
            const errMsg = result.stderr || `未知错误`;
            await this.store.addLog(executionId, `执行失败（退出码 ${result.exitCode}）: ${errMsg}`);
            this.broadcastStatus(executionId, 'failed');
            this.broadcastComplete(executionId, 'failed');
        }
    }

    abort(executionId: string): void {
        const controller = this.abortControllers.get(executionId);
        if (controller) controller.abort();
        // 中止时拒绝该执行所有挂起的权限请求，避免 bridge query 永久挂起
        this.denyPendingPermissions(executionId, '执行已中止');
    }

    /**
     * 处理工具权限请求：命中白名单直接放行，否则广播给前端等待用户确认
     */
    private handlePermissionRequest(executionId: string, meta: Record<string, unknown>): void {
        const permissionRequestId = meta.permissionRequestId as string;
        const toolName = meta.toolName as string;
        if (!permissionRequestId) return;

        // 白名单命中（本次执行内「允许并记住」过的同类工具）：直接放行，不打扰用户
        const allowed = this.allowedTools.get(executionId);
        if (allowed && toolName && allowed.has(toolName)) {
            this.config.cliRunner.confirmPermission(permissionRequestId, 'allow');
            return;
        }

        this.pendingPermissions.set(permissionRequestId, {executionId, toolName});

        // 记录日志 + 广播给前端弹确认框
        this.store.addLog(executionId, `⏸ 等待确认工具：${toolName}`).catch(() => undefined);
        broadcast({
            type: 'agent-execution:permission_request',
            data: {executionId, ...meta},
        });
    }

    /**
     * 用户确认工具权限：remember 入白名单，反向回传决策给 bridge
     */
    async confirmTool(
        executionId: string,
        permissionRequestId: string,
        decision: 'allow' | 'deny',
        remember?: boolean,
        modifiedInput?: Record<string, unknown>,
    ): Promise<void> {
        const pending = this.pendingPermissions.get(permissionRequestId);
        if (!pending || pending.executionId !== executionId) return;

        // 「允许并记住」：加入本次执行白名单，后续同类工具自动放行
        if (decision === 'allow' && remember && pending.toolName) {
            const allowed = this.allowedTools.get(executionId) ?? new Set<string>();
            allowed.add(pending.toolName);
            this.allowedTools.set(executionId, allowed);
        }

        this.pendingPermissions.delete(permissionRequestId);
        this.config.cliRunner.confirmPermission(permissionRequestId, decision, undefined, modifiedInput);

        const verb = decision === 'allow' ? '已允许' : '已拒绝';
        await this.store.addLog(executionId, `${verb}工具：${pending.toolName}`).catch(() => undefined);
        this.broadcastLog(executionId, `${verb}工具：${pending.toolName}`);
    }

    /**
     * 拒绝某执行所有挂起的权限请求（abort / 终态时清理）
     */
    private denyPendingPermissions(executionId: string, message: string): void {
        for (const [permissionRequestId, pending] of this.pendingPermissions) {
            if (pending.executionId === executionId) {
                this.pendingPermissions.delete(permissionRequestId);
                this.config.cliRunner.confirmPermission(permissionRequestId, 'deny', message);
            }
        }
    }

    /**
     * 处理 thinking 事件 → 写 thoughts + 广播
     */
    private async handleThinking(executionId: string, content: string): Promise<void> {
        const display = content.length > 2000
            ? content.slice(0, 2000) + '...'
            : content;

        await this.store.addThought(executionId, {
            type: 'analysis',
            content: display,
            timestamp: new Date().toISOString(),
        });

        broadcast({
            type: 'agent-execution:thought',
            data: {
                executionId,
                thought: {
                    type: 'analysis',
                    content: display,
                    timestamp: new Date().toISOString(),
                },
            },
        });
    }

    /**
     * 处理 tool_use 事件 → 写操作工具创建 step + 广播，读操作只广播日志
     */
    private async handleToolUse(executionId: string, meta: Record<string, unknown>): Promise<void> {
        const toolName = meta.toolName as string || 'Tool';
        const toolUseId = meta.toolUseId as string || randomUUID();
        const toolInput = meta.toolInput as Record<string, unknown>;

        const execution = await this.store.get(executionId);
        if (!execution) return;

        // 避免重复（tool_use_id 去重）
        if (execution.steps.some(s => s.id === toolUseId)) return;

        // 只有写操作工具才创建独立步骤，读操作（Read/Glob/Grep 等）不创建
        if (!STEP_TOOLS.has(toolName)) return;

        await this.store.updateSteps(executionId, [
            ...execution.steps,
            {
                id: toolUseId,
                title: toolName,
                status: 'running',
                startedAt: new Date().toISOString(),
                logs: toolInput ? [JSON.stringify(toolInput).slice(0, 500)] : [],
            },
        ]);

        broadcast({
            type: 'agent-execution:subtask',
            data: {
                executionId,
                subTaskId: toolUseId,
                title: toolName,
                status: 'running',
            },
        });
    }

    /**
     * 处理 tool_result 事件 → 标记 step completed/failed + 广播
     */
    private async handleToolResult(executionId: string, meta: Record<string, unknown>): Promise<void> {
        const toolUseId = meta.toolUseId as string;
        const isError = meta.isError as boolean;

        if (!toolUseId) return;

        const execution = await this.store.get(executionId);
        if (!execution) return;

        const stepIdx = execution.steps.findIndex(s => s.id === toolUseId);
        if (stepIdx < 0) return;

        const step = execution.steps[stepIdx];
        step.status = isError ? 'failed' : 'completed';
        step.completedAt = new Date().toISOString();
        execution.steps[stepIdx] = step;
        await this.store.updateSteps(executionId, execution.steps);

        broadcast({
            type: 'agent-execution:subtask',
            data: {
                executionId,
                subTaskId: toolUseId,
                title: step.title,
                status: isError ? 'failed' : 'completed',
                completedAt: step.completedAt,
            },
        });

        // 步骤级日志：将工具执行摘要通过 stepLog 事件推送，前端展开步骤面板可查看
        if (meta.content && typeof meta.content === 'string' && meta.content.trim()) {
            const summary = meta.content.slice(0, 300);
            broadcast({
                type: 'agent-execution:stepLog',
                data: {
                    executionId,
                    stepId: toolUseId,
                    log: summary,
                    isError,
                },
            });
        }
    }

    /**
     * 执行结束后，将所有仍为 running 的步骤标记为终态，防止前端永久转圈
     */
    private async finalizeSteps(executionId: string, terminalStatus: 'completed' | 'failed' | 'aborted'): Promise<void> {
        const execution = await this.store.get(executionId);
        if (!execution) return;

        const now = new Date().toISOString();
        const changed = execution.steps.some(s => s.status === 'running');
        if (!changed) return;

        execution.steps.forEach(s => {
            if (s.status === 'running') {
                s.status = terminalStatus === 'completed' ? 'completed' : 'failed';
                s.completedAt = now;
            }
        });
        await this.store.updateSteps(executionId, execution.steps);

        // 广播 finalized steps，确保前端看到 step 终态
        for (const s of execution.steps) {
            broadcast({
                type: 'agent-execution:subtask',
                data: {executionId, subTaskId: s.id, title: s.title, status: s.status},
            });
        }
    }

    private broadcastStatus(executionId: string, status: string): void {
        broadcast({type: 'agent-execution:status', data: {executionId, status}});
    }

    /**
     * 广播 Agent 执行终态事件（供 AnalyticsService 消费，为技能沉淀提供素材）。
     * workspacePath 从 store 反查，catch 分支也能取到。
     */
    private broadcastComplete(executionId: string, status: string): void {
        void this.store.get(executionId).then((execution) => {
            const workspacePath = execution?.workspacePath || this.config.workspacePath || process.cwd();
            broadcast({type: 'agent-execution:complete', data: {executionId, status, workspacePath}});
        });
    }

    private broadcastLog(executionId: string, log: string): void {
        broadcast({type: 'agent-execution:log', data: {executionId, log}});
    }
}

export function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator {
    return new AgentCoordinator(config);
}
