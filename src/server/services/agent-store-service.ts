/**
 * @file Agent执行存储服务
 * @description Agent执行持久化存储服务模块
 *
 * 管理Agent执行记录的持久化存储。
 * 每个执行存储在：agent-executions/{executionId}.json
 * 同时维护索引以支持快速查找。
 */

import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';
import type {RequirementAnalysisResult, CodeGenerationResult, TestResult, CodeReviewResult} from './agents/types.js';
import type {ExecutionPlan} from './agents/coordinator-agent.js';

/**
 * 协调Agent执行结果（简化版，用于存储）
 */
export interface StoredCoordinatorResult {
    plan: ExecutionPlan;
    finalResult?: any;
}

/**
 * Agent执行记录接口
 */
export interface AgentExecution {
    /** 执行唯一标识符 */
    id: string;
    /** Agent ID */
    agentId: string;
    /** 任务 ID */
    taskId: string;
    /** 执行状态 */
    status: 'running' | 'completed' | 'failed' | 'aborted' | 'paused';
    /** 输入数据 */
    inputData: Record<string, unknown>;
    /** 执行选项 */
    options?: {
        targetQuality?: number;
        tokenBudget?: number;
        maxIterations?: number;
    };
    /** 工作流类型 */
    workflowType?: string;
    /** 执行结果 */
    result?: RequirementAnalysisResult | CodeGenerationResult | TestResult | CodeReviewResult | StoredCoordinatorResult;
    /** 质量评估 */
    quality?: number;
    /** 执行时长（毫秒） */
    duration?: number;
    /** Token消耗 */
    tokensUsed?: number;
    /** 错误信息 */
    error?: string;
    /** 创建时间 */
    createdAt: string;
    /** 最后更新时间 */
    updatedAt: string;
}

/** Agent执行存储目录 */
const AGENT_EXECUTIONS_DIR = path.join(APP_DATA_DIR, 'agent-executions');

/**
 * Agent执行存储服务类
 *
 * 按执行ID存储：agent-executions/{executionId}.json
 */
export class AgentStoreService {
    /** 获取执行文件路径 */
    private executionFilePath(executionId: string): string {
        return path.join(AGENT_EXECUTIONS_DIR, `${executionId}.json`);
    }

    /** 从文件读取执行记录 */
    private readExecutionFile(executionId: string): AgentExecution | undefined {
        const filePath = this.executionFilePath(executionId);
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return undefined;
        }
    }

    /** 写入执行记录到文件 */
    private writeExecutionFile(execution: AgentExecution): void {
        const dir = AGENT_EXECUTIONS_DIR;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        fs.writeFileSync(this.executionFilePath(execution.id), JSON.stringify(execution, null, 2), 'utf-8');
    }

    /**
     * 列出所有执行记录（按 updatedAt 倒序）
     */
    async list(): Promise<AgentExecution[]> {
        try {
            if (!fs.existsSync(AGENT_EXECUTIONS_DIR)) {
                return [];
            }

            const files = await fs.promises.readdir(AGENT_EXECUTIONS_DIR);
            const executions: AgentExecution[] = [];

            // 并行读取所有执行文件
            const results = await Promise.all(
                files
                    .filter(f => f.endsWith('.json'))
                    .map(f => this.readExecutionFileAsync(f.replace('.json', '')))
            );

            for (const execution of results) {
                if (execution) executions.push(execution);
            }

            return executions.sort((a, b) =>
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
        } catch {
            return [];
        }
    }

    /** 同步列表（仅fallback用） */
    private listSync(): AgentExecution[] {
        if (!fs.existsSync(AGENT_EXECUTIONS_DIR)) return [];

        const executions: AgentExecution[] = [];
        try {
            const files = fs.readdirSync(AGENT_EXECUTIONS_DIR);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                const executionId = file.replace('.json', '');
                const execution = this.readExecutionFile(executionId);
                if (execution) executions.push(execution);
            }
        } catch { /* ignore */ }
        return executions;
    }

    private async readExecutionFileAsync(executionId: string): Promise<AgentExecution | undefined> {
        try {
            return JSON.parse(await fs.promises.readFile(this.executionFilePath(executionId), 'utf-8'));
        } catch {
            return undefined;
        }
    }

    /**
     * 根据执行ID获取记录
     */
    get(executionId: string): AgentExecution | undefined {
        return this.readExecutionFile(executionId);
    }

    /**
     * 根据Agent ID获取执行记录列表
     */
    getByAgent(agentId: string): AgentExecution[] {
        return this.listSync().filter(e => e.agentId === agentId);
    }

    /**
     * 根据任务ID获取执行记录列表
     */
    getByTask(taskId: string): AgentExecution[] {
        return this.listSync().filter(e => e.taskId === taskId);
    }

    /**
     * 创建或更新执行记录（自动填充 updatedAt）
     */
    upsert(execution: Omit<AgentExecution, 'updatedAt'> & { updatedAt?: string }): AgentExecution {
        const updated: AgentExecution = {
            ...execution,
            updatedAt: execution.updatedAt ?? new Date().toISOString(),
        };
        this.writeExecutionFile(updated);
        return updated;
    }

    /**
     * 根据执行ID删除记录
     */
    delete(executionId: string): boolean {
        const filePath = this.executionFilePath(executionId);
        if (!fs.existsSync(filePath)) return false;

        fs.unlinkSync(filePath);
        return true;
    }

    /**
     * 清理旧执行记录（超过指定天数）
     */
    async cleanupOldExecutions(daysToKeep: number = 30): Promise<number> {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        const executions = await this.list();
        let deletedCount = 0;

        for (const execution of executions) {
            const executionDate = new Date(execution.createdAt);
            if (executionDate < cutoffDate) {
                this.delete(execution.id);
                deletedCount++;
            }
        }

        return deletedCount;
    }

    /**
     * 获取统计信息
     */
    async getStats(): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byAgent: Record<string, number>;
    }> {
        const executions = await this.list();
        const byStatus: Record<string, number> = {};
        const byAgent: Record<string, number> = {};

        for (const execution of executions) {
            // 按状态统计
            byStatus[execution.status] = (byStatus[execution.status] || 0) + 1;

            // 按Agent统计
            byAgent[execution.agentId] = (byAgent[execution.agentId] || 0) + 1;
        }

        return {
            total: executions.length,
            byStatus,
            byAgent
        };
    }
}
