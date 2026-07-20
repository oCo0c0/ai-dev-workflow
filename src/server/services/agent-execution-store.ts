/**
 * @file Agent Execution Store
 * @description Agent执行存储服务 - 管理Agent执行记录的持久化
 *
 * 功能：
 * - 按需求隔离存储（每个需求独立目录）
 * - 支持执行记录的CRUD操作
 * - 存储Agent思考过程、子任务状态、执行日志
 */

import {v4 as uuidv4} from 'uuid';
import {join, dirname} from 'path';
import {mkdir, writeFile, readFile, readdir} from 'fs/promises';
import {existsSync} from 'fs';
import {APP_DATA_DIR} from '../utils/constants.js';

/**
 * 子任务状态
 */
export interface SubTask {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    agent?: string;
    startedAt?: string;
    completedAt?: string;
    output?: string;
    error?: string;
    order: number;
}

/**
 * Agent思考过程
 */
export interface AgentThought {
    type: 'analysis' | 'planning' | 'decision' | 'tool_selection' | 'error';
    content: string;
    timestamp: string;
    confidence?: number;
}

/**
 * Agent执行摘要
 */
export interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementNumber?: string;
    requirementTitle?: string;
    workspacePath: string;
    status: 'analyzing' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    createdAt: string;
    updatedAt: string;
    subTasksCount?: number;
    completedSubTasks?: number;
}

/**
 * 完整的Agent执行信息
 */
export interface AgentExecution extends AgentExecutionSummary {
    requirementText?: string;
    thoughts: AgentThought[];
    subTasks: SubTask[];
    logs: string[];
    error?: string;
    sessionId?: string;
}

/**
 * Agent执行存储服务
 */
export class AgentExecutionStore {
    private basePath: string;

    constructor() {
        this.basePath = join(APP_DATA_DIR, 'agent-executions');
        if (!existsSync(this.basePath)) {
            mkdir(this.basePath, {recursive: true});
        }
    }

    /**
     * 获取执行记录的存储路径
     */
    private getExecutionPath(executionId: string): string {
        return join(this.basePath, `${executionId}.json`);
    }

    /**
     * 创建新执行记录
     */
    async create(data: Omit<AgentExecution, 'id' | 'createdAt' | 'updatedAt' | 'subTasks' | 'thoughts' | 'logs'>): Promise<AgentExecution> {
        const now = new Date().toISOString();
        const execution: AgentExecution = {
            id: uuidv4(),
            ...data,
            subTasks: [],
            thoughts: [],
            logs: [],
            createdAt: now,
            updatedAt: now,
        };

        await this.save(execution);
        return execution;
    }

    /**
     * 保存执行记录
     */
    async save(execution: AgentExecution): Promise<void> {
        const path = this.getExecutionPath(execution.id);
        const dir = dirname(path);

        if (!existsSync(dir)) {
            await mkdir(dir, {recursive: true});
        }

        execution.updatedAt = new Date().toISOString();
        await writeFile(path, JSON.stringify(execution, null, 2), 'utf-8');
    }

    /**
     * 获取执行记录
     */
    async get(executionId: string): Promise<AgentExecution | null> {
        const path = this.getExecutionPath(executionId);

        if (!existsSync(path)) {
            return null;
        }

        try {
            const content = await readFile(path, 'utf-8');
            return JSON.parse(content);
        } catch {
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

                const path = join(this.basePath, file);
                try {
                    const content = await readFile(path, 'utf-8');
                    const execution: AgentExecution = JSON.parse(content);

                    const completedCount = execution.subTasks.filter(t => t.status === 'completed').length;

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
                    });
                } catch {
                    // 跳过损坏的文件
                }
            }

            // 按创建时间倒序
            return executions.sort((a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch {
            return [];
        }
    }

    /**
     * 删除执行记录
     */
    async delete(executionId: string): Promise<boolean> {
        const path = this.getExecutionPath(executionId);

        if (!existsSync(path)) {
            return false;
        }

        try {
            // 在Windows上使用del模块，在Unix上使用unlink
            const {unlink} = await import('fs/promises');
            await unlink(path);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 更新执行状态
     */
    async updateStatus(executionId: string, status: AgentExecution['status']): Promise<void> {
        const execution = await this.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        execution.status = status;
        await this.save(execution);
    }

    /**
     * 添加思考过程
     */
    async addThought(executionId: string, thought: AgentThought): Promise<void> {
        const execution = await this.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        execution.thoughts.push(thought);
        await this.save(execution);
    }

    /**
     * 添加日志
     */
    async addLog(executionId: string, log: string): Promise<void> {
        const execution = await this.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        execution.logs.push(log);
        await this.save(execution);
    }

    /**
     * 更新子任务状态
     */
    async updateSubTask(executionId: string, subTaskId: string, updates: Partial<SubTask>): Promise<void> {
        const execution = await this.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        const subTask = execution.subTasks.find(t => t.id === subTaskId);
        if (!subTask) {
            throw new Error(`SubTask not found: ${subTaskId}`);
        }

        Object.assign(subTask, updates);
        await this.save(execution);
    }

    /**
     * 设置子任务列表
     */
    async setSubTasks(executionId: string, subTasks: SubTask[]): Promise<void> {
        const execution = await this.get(executionId);
        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        execution.subTasks = subTasks;
        await this.save(execution);
    }
}

// 导出单例
let storeInstance: AgentExecutionStore | null = null;

export function getAgentExecutionStore(): AgentExecutionStore {
    if (!storeInstance) {
        storeInstance = new AgentExecutionStore();
    }
    return storeInstance;
}
