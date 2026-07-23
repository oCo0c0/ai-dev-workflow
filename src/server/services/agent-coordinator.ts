/**
 * @file Agent Coordinator (通用设计，不依赖特定格式)
 * @description 执行Agent并透传所有输出，解析结构化事件（thinking/tool_use/tool_result），
 *              生成思考过程、执行步骤、子任务数据并广播给前端。
 */

import {randomUUID} from 'crypto';
import {AgentExecutionStore} from './agent-execution-store.js';
import {CLIRunnerService} from './cli-runner-service.js';
import {broadcast} from '../websocket.js';

export interface CoordinatorConfig {
    cliRunner: CLIRunnerService;
    workspacePath?: string;
}

// 只有写操作工具才创建独立步骤（Read/Glob/Grep 等读操作是噪声）
const STEP_TOOLS = new Set([
    'Write', 'Edit', 'NotebookEdit', 'Bash', 'TaskCreate',
    'Workflow', 'Skill', 'CronCreate', 'CronDelete',
]);

export class AgentCoordinator {
    private store = AgentExecutionStore.getInstance();
    private abortControllers = new Map<string, AbortController>();
    private config: CoordinatorConfig;

    constructor(config: CoordinatorConfig) {
        this.config = config;
    }

    /**
     * 执行 Agent — 解析结构化事件，生成 thoughts/steps 数据
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

            // 从日志中提取用户回复消息，拼入 prompt 让 Agent 看到后续指令
            const userReplies = execution.logs
                .filter(log => log.startsWith('**User:**'))
                .map(log => log.replace('**User:** ', ''));

            let prompt: string;
            if (userReplies.length > 0 && execution.sessionId) {
                // 续接会话：带上用户补充信息
                const repliesText = userReplies.map(r => `- ${r}`).join('\n');
                prompt = `用户补充了以下信息：\n\n${repliesText}\n\n请根据以上补充继续工作。`;
            } else {
                // 首次执行
                prompt = `请完成以下需求：\n\n${execution.requirementText}\n\n工作区：${cwd}\n\n请开始工作。`;
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
                    onOutput: (data: string, meta?: Record<string, unknown>) => {
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
                    },
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
            } else if (result.exitCode === 0) {
                await this.finalizeSteps(executionId, 'completed');
                await this.store.updateStatus(executionId, 'completed');
                this.broadcastStatus(executionId, 'completed');
            } else {
                await this.finalizeSteps(executionId, 'failed');
                await this.store.updateStatus(executionId, 'failed');
                const errMsg = result.stderr || `未知错误`;
                await this.store.addLog(executionId, `执行失败（退出码 ${result.exitCode}）: ${errMsg}`);
                this.broadcastStatus(executionId, 'failed');
            }

        } catch (error) {
            console.error(`[coordinator] execute error:`, error);
            await this.finalizeSteps(executionId, 'failed');
            await this.store.updateStatus(executionId, 'failed');
            await this.store.addLog(executionId, `执行失败: ${(error as Error).message}`);
            this.broadcastStatus(executionId, 'failed');
        } finally {
            this.abortControllers.delete(executionId);
        }
    }

    abort(executionId: string): void {
        const controller = this.abortControllers.get(executionId);
        if (controller) controller.abort();
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
            },
        });
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

    private broadcastLog(executionId: string, log: string): void {
        broadcast({type: 'agent-execution:log', data: {executionId, log}});
    }
}

export function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator {
    return new AgentCoordinator(config);
}
