/**
 * @module execution-store-service
 * @description 执行记录持久化存储服务模块
 *
 * 管理由 Claude Agent 生成的执行记录的持久化存储。
 * 每个需求的执行记录存储在其需求文件夹下：requirements/{requirementId}/execution.json
 * 同时维护从 executionId → requirementId 的索引以支持按 executionId 查询。
 */
import fs from 'fs';
import path from 'path';
import {REQUIREMENTS_DIR, APP_DATA_DIR} from '../utils/constants.js';

/**
 * 持久化执行记录接口
 */
export interface PersistedExecution {
    /** 执行记录唯一标识符 */
    id: string;
    /** 关联计划 ID */
    planId: string;
    /** 关联需求 ID */
    requirementId: string;
    /** 执行状态 */
    status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    /** 当前步骤索引 */
    currentStep: number;
    /** 总步骤数 */
    totalSteps: number;
    /** 开始时间 */
    startedAt: string;
    /** 完成时间 */
    completedAt?: string;
    /** 日志 */
    logs: string[];
    /** Claude 会话 ID */
    sessionId?: string;
    /** 工作区路径 */
    workspacePath?: string;
}

/** executionId → requirementId 的索引文件路径 */
const EXECUTION_INDEX_FILE = path.join(APP_DATA_DIR, 'execution-index.json');

/** 最大保留记录数（per requirement） */
const MAX_PER_REQUIREMENT = 20;

/**
 * 执行记录存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/execution.json
 * 每个需求可有多条执行记录（数组）。
 * 维护 execution-index.json 索引以支持按 executionId 快速查找 requirementId。
 */
export class ExecutionStoreService {
    /** 读取 executionId → requirementId 索引 */
    private loadIndex(): Record<string, string> {
        if (!fs.existsSync(EXECUTION_INDEX_FILE)) return {};
        try {
            return JSON.parse(fs.readFileSync(EXECUTION_INDEX_FILE, 'utf-8'));
        } catch {
            return {};
        }
    }

    /** 写入索引 */
    private saveIndex(index: Record<string, string>): void {
        const dir = path.dirname(EXECUTION_INDEX_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        fs.writeFileSync(EXECUTION_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
    }

    /** 获取需求文件夹下的 execution.json 路径 */
    private execFilePath(requirementId: string): string {
        return path.join(REQUIREMENTS_DIR, requirementId, 'execution.json');
    }

    /** 从文件读取需求下的所有执行记录 */
    private readExecFile(requirementId: string): PersistedExecution[] {
        const filePath = this.execFilePath(requirementId);
        if (!fs.existsSync(filePath)) return [];
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /** 写入执行记录数组到需求文件夹 */
    private writeExecFile(requirementId: string, items: PersistedExecution[]): void {
        const dir = path.join(REQUIREMENTS_DIR, requirementId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        // 按 startedAt 倒序，截断到 MAX_PER_REQUIREMENT
        const sorted = items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        const trimmed = sorted.slice(0, MAX_PER_REQUIREMENT);
        fs.writeFileSync(this.execFilePath(requirementId), JSON.stringify(trimmed, null, 2), 'utf-8');

        // 更新索引
        const index = this.loadIndex();
        for (const item of trimmed) {
            index[item.id] = requirementId;
        }
        this.saveIndex(index);
    }

    /**
     * 列出所有执行记录（按 startedAt 倒序）
     */
    list(limit?: number): PersistedExecution[] {
        if (!fs.existsSync(REQUIREMENTS_DIR)) return [];

        const all: PersistedExecution[] = [];
        const dirs = fs.readdirSync(REQUIREMENTS_DIR, {withFileTypes: true});

        for (const dir of dirs) {
            if (!dir.isDirectory()) continue;
            const items = this.readExecFile(dir.name);
            all.push(...items);
        }

        const sorted = all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        return limit ? sorted.slice(0, limit) : sorted;
    }

    /**
     * 根据 executionId 获取执行记录
     */
    get(executionId: string): PersistedExecution | undefined {
        const index = this.loadIndex();
        const requirementId = index[executionId];
        if (requirementId) {
            const items = this.readExecFile(requirementId);
            return items.find(e => e.id === executionId);
        }
        // 索引未命中，扫描
        return this.list().find(e => e.id === executionId);
    }

    /**
     * 根据需求 ID 获取该需求下的所有执行记录（按 startedAt 倒序）
     */
    getByRequirement(requirementId: string): PersistedExecution[] {
        return this.readExecFile(requirementId);
    }

    /**
     * 创建或更新执行记录
     */
    upsert(exec: PersistedExecution): PersistedExecution {
        const index = this.loadIndex();
        let requirementId = index[exec.id];

        // 新记录：从 exec.requirementId 取
        if (!requirementId && exec.requirementId) {
            requirementId = exec.requirementId;
        }

        if (!requirementId) {
            console.warn(`[execution-store] cannot upsert execution ${exec.id}: no requirementId`);
            return exec;
        }

        const items = this.readExecFile(requirementId);
        const idx = items.findIndex(e => e.id === exec.id);
        if (idx >= 0) {
            items[idx] = exec;
        } else {
            items.push(exec);
        }
        this.writeExecFile(requirementId, items);
        return exec;
    }

    /**
     * 根据 executionId 删除执行记录
     */
    delete(executionId: string): boolean {
        const index = this.loadIndex();
        const requirementId = index[executionId];
        if (!requirementId) return false;

        const items = this.readExecFile(requirementId);
        const idx = items.findIndex(e => e.id === executionId);
        if (idx < 0) return false;

        items.splice(idx, 1);
        this.writeExecFile(requirementId, items);

        // 清理索引
        delete index[executionId];
        this.saveIndex(index);
        return true;
    }

    // === 数据迁移 ===

    /**
     * 从旧版 executions.json 迁移到按需求文件夹存储
     */
    migrateFromLegacy(): void {
        const legacyFile = path.join(APP_DATA_DIR, 'executions.json');
        if (!fs.existsSync(legacyFile)) return;

        try {
            const raw = fs.readFileSync(legacyFile, 'utf-8');
            const items: PersistedExecution[] = JSON.parse(raw);
            if (!Array.isArray(items)) return;

            // 按 requirementId 分组（如果没有 requirementId，尝试从 plan 索引查找）
            const planIndexFile = path.join(APP_DATA_DIR, 'plan-index.json');
            let planIndex: Record<string, string> = {};
            if (fs.existsSync(planIndexFile)) {
                try {
                    planIndex = JSON.parse(fs.readFileSync(planIndexFile, 'utf-8'));
                } catch { /* ignore */ }
            }

            const groups = new Map<string, PersistedExecution[]>();
            let orphaned = 0;

            for (const item of items) {
                if (!item.id) continue;
                let reqId = item.requirementId;
                if (!reqId && item.planId) {
                    reqId = planIndex[item.planId];
                }
                if (!reqId) {
                    orphaned++;
                    continue;
                }
                // 补全 requirementId
                item.requirementId = reqId;
                if (!groups.has(reqId)) groups.set(reqId, []);
                groups.get(reqId)!.push(item);
            }

            let migrated = 0;
            for (const [reqId, execs] of groups) {
                // 合并：不覆盖已有记录
                const existing = this.readExecFile(reqId);
                const existingIds = new Set(existing.map(e => e.id));
                const newExecs = execs.filter(e => !existingIds.has(e.id));
                if (newExecs.length > 0) {
                    this.writeExecFile(reqId, [...existing, ...newExecs]);
                    migrated += newExecs.length;
                }
            }

            // 重命名旧文件
            fs.renameSync(legacyFile, legacyFile + '.bak');
            console.log(`[migration] migrated ${migrated} executions from legacy executions.json${orphaned > 0 ? ` (${orphaned} orphaned skipped)` : ''}`);
        } catch (err) {
            console.warn(`[migration] failed to migrate executions.json: ${err}`);
        }
    }
}
