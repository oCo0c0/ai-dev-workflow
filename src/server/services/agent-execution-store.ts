/**
 * @file Agent Execution Store
 * @description Agent执行存储服务 - 管理Agent执行记录的持久化
 *
 * 功能：
 * - 按需求隔离存储（每个需求独立目录）
 * - 支持执行记录的CRUD操作
 * - 存储Agent思考过程、子任务状态、执行日志
 */

import {v4 as uuid} from 'uuid';
import {join, dirname} from 'path';
import {mkdir, writeFile, readFile, readdir, unlink, rename} from 'fs/promises';
import {existsSync} from 'fs';
import {APP_DATA_DIR} from '../utils/constants.js';
import type {
    ExecutionStep,
    SubTask,
    AgentThought,
    AgentExecutionSummary,
    AgentExecution,
} from '../../types/agent-execution.js';

/** 当执行步骤为空时，摘要中使用的默认总步数 */
const DEFAULT_TOTAL_STEPS = 5;

/**
 * 对从磁盘读取的对象做最小限度的结构校验。
 * 不校验每个字段类型，仅确保关键字段存在且类型基本正确。
 */
function isAgentExecution(value: unknown): value is AgentExecution {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.id === 'string'
        && typeof obj.requirementId === 'string'
        && typeof obj.workspacePath === 'string'
        && typeof obj.status === 'string'
        && Array.isArray(obj.thoughts)
        && Array.isArray(obj.subTasks)
        && Array.isArray(obj.steps)
        && Array.isArray(obj.logs);
}

/**
 * Agent执行存储服务
 *
 * 注意：该类不应被外部直接实例化。请使用 {@link getAgentExecutionStore} 获取单例。
 */
export class AgentExecutionStore {
    private basePath: string;
    /** 每个 executionId 的写操作队列，串行化读-改-写避免并发覆盖/读到截断文件 */
    private writeQueues = new Map<string, Promise<unknown>>();

    private constructor() {
        this.basePath = join(APP_DATA_DIR, 'agent-executions');
    }

    /**
     * 把操作排入指定 executionId 的写队列，保证同一 execution 的写操作串行执行
     */
    private async enqueue<T>(executionId: string, task: () => Promise<T>): Promise<T> {
        const prev = this.writeQueues.get(executionId) || Promise.resolve();
        const next = prev.then(() => task()).finally(() => {
            // 只在当前任务仍是队尾时清理，避免误删后续任务
            if (this.writeQueues.get(executionId) === next) {
                this.writeQueues.delete(executionId);
            }
        });
        this.writeQueues.set(executionId, next);
        return next;
    }

    /**
     * 获取执行记录的存储路径
     */
    private getExecutionPath(executionId: string): string {
        return join(this.basePath, `${executionId}.json`);
    }

    /**
     * 内部保存方法：直接写文件，调用方必须已经处于写队列中或确保串行。
     */
    private async saveInternal(execution: AgentExecution): Promise<void> {
        const filePath = this.getExecutionPath(execution.id);
        const dir = dirname(filePath);

        // mkdir recursive 是幂等的，无需先 existsSync 检查
        await mkdir(dir, {recursive: true});

        execution.updatedAt = new Date().toISOString();
        // 原子写：先写临时文件再 rename，避免写一半被并发 get() 读到截断的 JSON。
        // agent 执行（尤其模型 tool_use 反复出错时）会高频更新 thoughts/logs，
        // 非原子 writeFile 会触发 "Unexpected end of JSON input"。
        const tmpPath = `${filePath}.${process.pid}.tmp`;
        await writeFile(tmpPath, JSON.stringify(execution, null, 2), 'utf-8');
        await rename(tmpPath, filePath);
    }

    /**
     * 创建新执行记录
     */
    async create(data: Omit<AgentExecution, 'id' | 'createdAt' | 'updatedAt' | 'subTasks' | 'thoughts' | 'logs' | 'steps'>): Promise<AgentExecution> {
        const now = new Date().toISOString();
        const execution: AgentExecution = {
            id: uuid(),
            ...data,
            subTasks: [],
            thoughts: [],
            logs: [],
            steps: [],
            createdAt: now,
            updatedAt: now,
        };

        await this.saveInternal(execution);
        return execution;
    }

    /**
     * 获取执行记录
     */
    async get(executionId: string): Promise<AgentExecution | null> {
        const filePath = this.getExecutionPath(executionId);

        if (!existsSync(filePath)) {
            return null;
        }

        try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            if (!isAgentExecution(parsed)) {
                console.warn(`[agent-execution-store] Corrupted execution file: ${filePath}`);
                return null;
            }
            return parsed;
        } catch (err) {
            console.warn(`[agent-execution-store] Failed to read execution ${executionId}: ${err instanceof Error ? err.message : err}`);
            return null;
        }
    }

    /**
     * 列出所有执行记录
     */
    async list(): Promise<AgentExecutionSummary[]> {
        if (!existsSync(this.basePath)) {
            return [];
        }

        try {
            const files = await readdir(this.basePath);
            const executions: AgentExecutionSummary[] = [];

            for (const file of files) {
                if (!file.endsWith('.json')) continue;

                const filePath = join(this.basePath, file);
                try {
                    const content = await readFile(filePath, 'utf-8');
                    const execution = JSON.parse(content);
                    if (!isAgentExecution(execution)) {
                        console.warn(`[agent-execution-store] Skipping corrupted file: ${filePath}`);
                        continue;
                    }

                    const completedCount = execution.subTasks.filter(t => t.status === 'completed').length;

                    // 计算当前执行的步骤
                    const totalSteps = execution.steps.length || DEFAULT_TOTAL_STEPS;
                    const currentStep = execution.steps.findIndex(s => s.status === 'running') + 1 ||
                        execution.steps.filter(s => s.status === 'completed').length + 1;

                    executions.push({
                        id: execution.id,
                        requirementId: execution.requirementId,
                        requirementNumber: execution.requirementNumber,
                        requirementTitle: execution.requirementTitle,
                        workspacePath: execution.workspacePath,
                        status: execution.status,
                        createdAt: execution.createdAt,
                        updatedAt: execution.updatedAt,
                        subTasksCount: execution.subTasks.length,
                        completedSubTasks: completedCount,
                        currentStep,
                        totalSteps,
                    });
                } catch (err) {
                    console.warn(`[agent-execution-store] Failed to list file ${filePath}: ${err instanceof Error ? err.message : err}`);
                }
            }

            // 按创建时间倒序
            return executions.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch (err) {
            console.warn(`[agent-execution-store] Failed to list executions: ${err instanceof Error ? err.message : err}`);
            return [];
        }
    }

    /**
     * 删除执行记录
     */
    async delete(executionId: string): Promise<boolean> {
        const filePath = this.getExecutionPath(executionId);

        if (!existsSync(filePath)) {
            return false;
        }

        try {
            await unlink(filePath);
            return true;
        } catch (err) {
            console.warn(`[agent-execution-store] Failed to delete execution ${executionId}: ${err instanceof Error ? err.message : err}`);
            return false;
        }
    }

    /**
     * 更新执行状态
     */
    async updateStatus(executionId: string, status: AgentExecution['status']): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.status = status;
            await this.saveInternal(execution);
        });
    }

    /**
     * 更新 sessionId，传 undefined 表示清空
     */
    async updateSessionId(executionId: string, sessionId: string | undefined): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.sessionId = sessionId;
            await this.saveInternal(execution);
        });
    }

    /**
     * 更新整个执行记录（供 coordinator 等内部模块使用）。
     * 写操作会进入队列以保证并发安全。
     */
    async updateFull(execution: AgentExecution): Promise<void> {
        return this.enqueue(execution.id, async () => {
            await this.saveInternal(execution);
        });
    }

    /**
     * 添加思考过程
     */
    async addThought(executionId: string, thought: AgentThought): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.thoughts.push(thought);
            await this.saveInternal(execution);
        });
    }

    /**
     * 添加日志
     */
    async addLog(executionId: string, log: string): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.logs.push(log);
            await this.saveInternal(execution);
        });
    }

    /**
     * 更新子任务状态
     */
    async updateSubTask(executionId: string, subTaskId: string, updates: Partial<SubTask>): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            const subTask = execution.subTasks.find(t => t.id === subTaskId);
            if (!subTask) {
                throw new Error(`SubTask not found: ${subTaskId}`);
            }

            Object.assign(subTask, updates);
            await this.saveInternal(execution);
        });
    }

    /**
     * 设置子任务列表
     */
    async setSubTasks(executionId: string, subTasks: SubTask[]): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.subTasks = subTasks;
            await this.saveInternal(execution);
        });
    }

    /**
     * 添加单个子任务
     */
    async addSubTask(executionId: string, subTask: SubTask): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.subTasks.push(subTask);
            await this.saveInternal(execution);
        });
    }

    /**
     * 更新执行步骤
     */
    async updateSteps(executionId: string, steps: ExecutionStep[]): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            execution.steps = steps;
            await this.saveInternal(execution);
        });
    }

    /**
     * 更新单个步骤
     */
    async updateStep(executionId: string, stepIndex: number, step: ExecutionStep): Promise<void> {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }

            if (!execution.steps[stepIndex]) {
                execution.steps[stepIndex] = step;
            } else {
                Object.assign(execution.steps[stepIndex], step);
            }

            await this.saveInternal(execution);
        });
    }

    static #instance: AgentExecutionStore | null = null;

    static getInstance(): AgentExecutionStore {
        if (!AgentExecutionStore.#instance) {
            AgentExecutionStore.#instance = new AgentExecutionStore();
        }
        return AgentExecutionStore.#instance;
    }
}
