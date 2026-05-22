"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionStoreService = void 0;
/**
 * @module execution-store-service
 * @description 执行记录持久化存储服务模块
 *
 * 管理由 Claude Agent 生成的执行记录的持久化存储。
 * 每个需求的执行记录存储在其需求文件夹下：requirements/{requirementId}/execution.json
 * 同时维护从 executionId → requirementId 的索引以支持按 executionId 查询。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
/** executionId → requirementId 的索引文件路径 */
const EXECUTION_INDEX_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'execution-index.json');
/** 最大保留记录数（per requirement） */
const MAX_PER_REQUIREMENT = 20;
/**
 * 执行记录存储服务类
 *
 * 按需求文件夹存储：requirements/{requirementId}/execution.json
 * 每个需求可有多条执行记录（数组）。
 * 维护 execution-index.json 索引以支持按 executionId 快速查找 requirementId。
 */
class ExecutionStoreService {
    /** 读取 executionId → requirementId 索引 */
    loadIndex() {
        if (!fs_1.default.existsSync(EXECUTION_INDEX_FILE))
            return {};
        try {
            return JSON.parse(fs_1.default.readFileSync(EXECUTION_INDEX_FILE, 'utf-8'));
        }
        catch {
            return {};
        }
    }
    /** 写入索引 */
    saveIndex(index) {
        const dir = path_1.default.dirname(EXECUTION_INDEX_FILE);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(EXECUTION_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
    }
    /** 获取需求文件夹下的 execution.json 路径 */
    execFilePath(requirementId) {
        return path_1.default.join(constants_js_1.REQUIREMENTS_DIR, requirementId, 'execution.json');
    }
    /** 从文件读取需求下的所有执行记录 */
    readExecFile(requirementId) {
        const filePath = this.execFilePath(requirementId);
        if (!fs_1.default.existsSync(filePath))
            return [];
        try {
            const parsed = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    /** 写入执行记录数组到需求文件夹 */
    writeExecFile(requirementId, items) {
        const dir = path_1.default.join(constants_js_1.REQUIREMENTS_DIR, requirementId);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        // 按 startedAt 倒序，截断到 MAX_PER_REQUIREMENT
        const sorted = items.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        const trimmed = sorted.slice(0, MAX_PER_REQUIREMENT);
        fs_1.default.writeFileSync(this.execFilePath(requirementId), JSON.stringify(trimmed, null, 2), 'utf-8');
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
    list(limit) {
        if (!fs_1.default.existsSync(constants_js_1.REQUIREMENTS_DIR))
            return [];
        const all = [];
        const dirs = fs_1.default.readdirSync(constants_js_1.REQUIREMENTS_DIR, { withFileTypes: true });
        for (const dir of dirs) {
            if (!dir.isDirectory())
                continue;
            const items = this.readExecFile(dir.name);
            all.push(...items);
        }
        const sorted = all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        return limit ? sorted.slice(0, limit) : sorted;
    }
    /**
     * 根据 executionId 获取执行记录
     */
    get(executionId) {
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
    getByRequirement(requirementId) {
        return this.readExecFile(requirementId);
    }
    /**
     * 创建或更新执行记录
     */
    upsert(exec) {
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
        }
        else {
            items.push(exec);
        }
        this.writeExecFile(requirementId, items);
        return exec;
    }
    /**
     * 根据 executionId 删除执行记录
     */
    delete(executionId) {
        const index = this.loadIndex();
        const requirementId = index[executionId];
        if (!requirementId)
            return false;
        const items = this.readExecFile(requirementId);
        const idx = items.findIndex(e => e.id === executionId);
        if (idx < 0)
            return false;
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
    migrateFromLegacy() {
        const legacyFile = path_1.default.join(constants_js_1.APP_DATA_DIR, 'executions.json');
        if (!fs_1.default.existsSync(legacyFile))
            return;
        try {
            const raw = fs_1.default.readFileSync(legacyFile, 'utf-8');
            const items = JSON.parse(raw);
            if (!Array.isArray(items))
                return;
            // 按 requirementId 分组（如果没有 requirementId，尝试从 plan 索引查找）
            const planIndexFile = path_1.default.join(constants_js_1.APP_DATA_DIR, 'plan-index.json');
            let planIndex = {};
            if (fs_1.default.existsSync(planIndexFile)) {
                try {
                    planIndex = JSON.parse(fs_1.default.readFileSync(planIndexFile, 'utf-8'));
                }
                catch { /* ignore */ }
            }
            const groups = new Map();
            let orphaned = 0;
            for (const item of items) {
                if (!item.id)
                    continue;
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
                if (!groups.has(reqId))
                    groups.set(reqId, []);
                groups.get(reqId).push(item);
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
            fs_1.default.renameSync(legacyFile, legacyFile + '.bak');
            console.log(`[migration] migrated ${migrated} executions from legacy executions.json${orphaned > 0 ? ` (${orphaned} orphaned skipped)` : ''}`);
        }
        catch (err) {
            console.warn(`[migration] failed to migrate executions.json: ${err}`);
        }
    }
}
exports.ExecutionStoreService = ExecutionStoreService;
//# sourceMappingURL=execution-store-service.js.map