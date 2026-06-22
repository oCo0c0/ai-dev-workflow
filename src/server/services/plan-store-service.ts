/**
 * @module plan-store-service
 * @description 开发计划持久化存储服务模块
 *
 * 管理由 Claude Agent 生成的开发计划的持久化存储。
 * 每个需求的计划存储在其需求文件夹下：requirements/{requirementId}/plan.json
 * 同时维护从 planId → requirementId 的索引以支持按 planId 查询。
 */
import fs from 'fs';
import path from 'path';
import {REQUIREMENTS_DIR, APP_DATA_DIR} from '../utils/constants.js';

/**
 * 持久化开发计划接口
 */
export interface PersistedPlan {
    /** 计划唯一标识符 */
    id: string;
    /** 关联需求 ID */
    requirementId: string;
    /** 关联需求标题（冗余存储，避免跨服务查询） */
    requirementTitle?: string;
    /** 关联需求编号（如 #125975） */
    requirementNumber?: string;
    /** 工作区路径 */
    workspacePath: string;
    /** 计划状态 */
    status: 'generating' | 'paused' | 'ready' | 'failed' | 'waiting_input' | 'waiting_skill_confirm';
    /** 计划摘要 */
    summary?: string;
    /** Claude Agent 原始输出 */
    rawOutput?: string;
    /** 创建时间 */
    createdAt: string;
    /** 最后更新时间 */
    updatedAt: string;
    /** 错误信息 */
    error?: string;
    /** 会话 ID */
    sessionId?: string;
    /** 流水线 ID */
    pipelineId?: string;
    /** 待执行技能队列（顺序敏感，先选先执行） */
    pendingSkills?: string[];
    /** 已执行完成的技能列表 */
    executedSkills?: string[];
    /** 当前执行中的技能名 */
    currentSkill?: string;
}

/** planId → requirementId 的索引文件路径 */
const PLAN_INDEX_FILE = path.join(APP_DATA_DIR, 'plan-index.json');

/**
 * 开发计划存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/plan.json
 * 每个需求只有一个 plan（regenerate 覆盖）。
 * 维护 plan-index.json 索引以支持按 planId 快速查找 requirementId。
 */
export class PlanStoreService {
    /** 读取 planId → requirementId 索引 */
    private loadIndex(): Record<string, string> {
        try {
            return JSON.parse(fs.readFileSync(PLAN_INDEX_FILE, 'utf-8'));
        } catch {
            return {};
        }
    }

    /** 写入索引 */
    private saveIndex(index: Record<string, string>): void {
        fs.writeFileSync(PLAN_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
    }

    /** 获取需求文件夹下的 plan.json 路径 */
    private planFilePath(requirementId: string): string {
        return path.join(REQUIREMENTS_DIR, requirementId, 'plan.json');
    }

    /** 从文件读取单个 plan */
    private readPlanFile(requirementId: string): PersistedPlan | undefined {
        const filePath = this.planFilePath(requirementId);
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return undefined;
        }
    }

    /** 写入 plan 到需求文件夹 */
    private writePlanFile(plan: PersistedPlan): void {
        const dir = path.join(REQUIREMENTS_DIR, plan.requirementId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
        fs.writeFileSync(this.planFilePath(plan.requirementId), JSON.stringify(plan, null, 2), 'utf-8');
        // 更新索引
        const index = this.loadIndex();
        index[plan.id] = plan.requirementId;
        this.saveIndex(index);
    }

    /**
     * 列出所有计划（按 updatedAt 倒序）
     */
    async list(): Promise<PersistedPlan[]> {
        try {
            const dirs = await fs.promises.readdir(REQUIREMENTS_DIR, {withFileTypes: true});
            const plans: PersistedPlan[] = [];
            // 并行读取所有 plan 文件
            const results = await Promise.all(
                dirs.filter(d => d.isDirectory()).map(d => this.readPlanFileAsync(d.name))
            );
            for (const plan of results) if (plan) plans.push(plan);
            return plans.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        } catch {
            return [];
        }
    }

    /** 同步列表（仅 fallback 用，避免 async 链扩散） */
    private listSync(): PersistedPlan[] {
        if (!fs.existsSync(REQUIREMENTS_DIR)) return [];
        const plans: PersistedPlan[] = [];
        try {
            const dirs = fs.readdirSync(REQUIREMENTS_DIR, {withFileTypes: true});
            for (const dir of dirs) {
                if (!dir.isDirectory()) continue;
                const plan = this.readPlanFile(dir.name);
                if (plan) plans.push(plan);
            }
        } catch { /* ignore */ }
        return plans;
    }

    private async readPlanFileAsync(requirementId: string): Promise<PersistedPlan | undefined> {
        try {
            return JSON.parse(await fs.promises.readFile(this.planFilePath(requirementId), 'utf-8'));
        } catch {
            return undefined;
        }
    }

    /**
     * 根据 planId 获取计划
     */
    get(planId: string): PersistedPlan | undefined {
        const index = this.loadIndex();
        const requirementId = index[planId];
        if (requirementId) {
            return this.readPlanFile(requirementId);
        }
        // 索引未命中，扫描（兼容旧数据）
        return this.listSync().find(p => p.id === planId);
    }

    /**
     * 根据需求 ID 获取计划（直接读取，无需索引）
     */
    getByRequirement(requirementId: string): PersistedPlan | undefined {
        return this.readPlanFile(requirementId);
    }

    /**
     * 创建或更新计划（自动填充 updatedAt）
     */
    upsert(plan: Omit<PersistedPlan, 'updatedAt'> & { updatedAt?: string }): PersistedPlan {
        const updated: PersistedPlan = {
            ...plan,
            updatedAt: plan.updatedAt ?? new Date().toISOString(),
        };
        this.writePlanFile(updated);
        return updated;
    }

    /**
     * 根据 planId 删除计划
     */
    delete(planId: string): boolean {
        const plan = this.get(planId);
        if (!plan) return false;

        const filePath = this.planFilePath(plan.requirementId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        // 清理索引
        const index = this.loadIndex();
        delete index[planId];
        this.saveIndex(index);
        return true;
    }

    // === 数据迁移 ===

    /**
     * 从旧版 plans.json 迁移到按需求文件夹存储
     */
    migrateFromLegacy(): void {
        const legacyFile = path.join(APP_DATA_DIR, 'plans.json');
        if (!fs.existsSync(legacyFile)) return;

        try {
            const raw = fs.readFileSync(legacyFile, 'utf-8');
            const items: PersistedPlan[] = JSON.parse(raw);
            if (!Array.isArray(items)) return;

            let migrated = 0;
            for (const item of items) {
                if (!item.id || !item.requirementId) continue;
                // 跳过已存在的
                if (fs.existsSync(this.planFilePath(item.requirementId))) continue;
                this.writePlanFile(item);
                migrated++;
            }

            // 重命名旧文件
            fs.renameSync(legacyFile, legacyFile + '.bak');
            console.log(`[migration] migrated ${migrated} plans from legacy plans.json`);
        } catch (err) {
            console.warn(`[migration] failed to migrate plans.json: ${err}`);
        }
    }
}
