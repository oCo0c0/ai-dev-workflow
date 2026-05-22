"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanStoreService = void 0;
/**
 * @module plan-store-service
 * @description 开发计划持久化存储服务模块
 *
 * 管理由 Claude Agent 生成的开发计划的持久化存储。
 * 每个需求的计划存储在其需求文件夹下：requirements/{requirementId}/plan.json
 * 同时维护从 planId → requirementId 的索引以支持按 planId 查询。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
/** planId → requirementId 的索引文件路径 */
const PLAN_INDEX_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'plan-index.json');
/**
 * 开发计划存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/plan.json
 * 每个需求只有一个 plan（regenerate 覆盖）。
 * 维护 plan-index.json 索引以支持按 planId 快速查找 requirementId。
 */
class PlanStoreService {
    /** 读取 planId → requirementId 索引 */
    loadIndex() {
        if (!fs_1.default.existsSync(PLAN_INDEX_FILE))
            return {};
        try {
            return JSON.parse(fs_1.default.readFileSync(PLAN_INDEX_FILE, 'utf-8'));
        }
        catch {
            return {};
        }
    }
    /** 写入索引 */
    saveIndex(index) {
        fs_1.default.writeFileSync(PLAN_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
    }
    /** 获取需求文件夹下的 plan.json 路径 */
    planFilePath(requirementId) {
        return path_1.default.join(constants_js_1.REQUIREMENTS_DIR, requirementId, 'plan.json');
    }
    /** 从文件读取单个 plan */
    readPlanFile(requirementId) {
        const filePath = this.planFilePath(requirementId);
        if (!fs_1.default.existsSync(filePath))
            return undefined;
        try {
            return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return undefined;
        }
    }
    /** 写入 plan 到需求文件夹 */
    writePlanFile(plan) {
        const dir = path_1.default.join(constants_js_1.REQUIREMENTS_DIR, plan.requirementId);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(this.planFilePath(plan.requirementId), JSON.stringify(plan, null, 2), 'utf-8');
        // 更新索引
        const index = this.loadIndex();
        index[plan.id] = plan.requirementId;
        this.saveIndex(index);
    }
    /**
     * 列出所有计划（按 updatedAt 倒序）
     */
    list() {
        if (!fs_1.default.existsSync(constants_js_1.REQUIREMENTS_DIR))
            return [];
        const plans = [];
        const dirs = fs_1.default.readdirSync(constants_js_1.REQUIREMENTS_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            const plan = this.readPlanFile(dir.name);
            if (plan)
                plans.push(plan);
        }
        return plans.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    /**
     * 根据 planId 获取计划
     */
    get(planId) {
        const index = this.loadIndex();
        const requirementId = index[planId];
        if (requirementId) {
            return this.readPlanFile(requirementId);
        }
        // 索引未命中，扫描（兼容旧数据）
        return this.list().find(p => p.id === planId);
    }
    /**
     * 根据需求 ID 获取计划（直接读取，无需索引）
     */
    getByRequirement(requirementId) {
        return this.readPlanFile(requirementId);
    }
    /**
     * 创建或更新计划（自动填充 updatedAt）
     */
    upsert(plan) {
        const updated = {
            ...plan,
            updatedAt: plan.updatedAt ?? new Date().toISOString(),
        };
        this.writePlanFile(updated);
        return updated;
    }
    /**
     * 根据 planId 删除计划
     */
    delete(planId) {
        const plan = this.get(planId);
        if (!plan)
            return false;
        const filePath = this.planFilePath(plan.requirementId);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
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
    migrateFromLegacy() {
        const legacyFile = path_1.default.join(constants_js_1.APP_DATA_DIR, 'plans.json');
        if (!fs_1.default.existsSync(legacyFile))
            return;
        try {
            const raw = fs_1.default.readFileSync(legacyFile, 'utf-8');
            const items = JSON.parse(raw);
            if (!Array.isArray(items))
                return;
            let migrated = 0;
            for (const item of items) {
                if (!item.id || !item.requirementId)
                    continue;
                // 跳过已存在的
                if (fs_1.default.existsSync(this.planFilePath(item.requirementId)))
                    continue;
                this.writePlanFile(item);
                migrated++;
            }
            // 重命名旧文件
            fs_1.default.renameSync(legacyFile, legacyFile + '.bak');
            console.log(`[migration] migrated ${migrated} plans from legacy plans.json`);
        }
        catch (err) {
            console.warn(`[migration] failed to migrate plans.json: ${err}`);
        }
    }
}
exports.PlanStoreService = PlanStoreService;
//# sourceMappingURL=plan-store-service.js.map