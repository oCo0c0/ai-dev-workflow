"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsStoreService = void 0;
/**
 * @module analytics-store-service
 * @description 执行分析数据持久化存储
 *
 * 记录每次执行的分析结果（成功/失败、耗时、使用的技能、模式检测等）。
 * 存储在 ~/.ai-dev-workbench/analytics.json，上限 200 条。
 */
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const json_store_js_1 = require("./json-store.js");
const constants_js_1 = require("../utils/constants.js");
const STORE_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'analytics.json');
/**
 * 分析数据存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 200 条。
 * 额外提供按工作空间、阶段查询和自动生成 ID 的 create 方法。
 */
class AnalyticsStoreService extends json_store_js_1.JsonStore {
    constructor(storeFile) {
        super({ defaultPath: STORE_FILE, maxRecords: 200, sortField: 'timestamp' }, storeFile);
    }
    /** 按工作空间查询 */
    getByWorkspace(workspacePath, limit) {
        const filtered = this.load()
            .filter(r => r.workspacePath === workspacePath)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return limit ? filtered.slice(0, limit) : filtered;
    }
    /** 按阶段查询 */
    getByPhase(phase, limit) {
        const filtered = this.load()
            .filter(r => r.phase === phase)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return limit ? filtered.slice(0, limit) : filtered;
    }
    /** 创建分析记录（自动生成 id 和 timestamp） */
    create(record) {
        const entry = {
            ...record,
            id: crypto_1.default.randomUUID(),
            timestamp: new Date().toISOString(),
        };
        // 使用继承的 load/save 实现 insert
        const records = this.load();
        records.push(entry);
        this.save(records);
        return entry;
    }
}
exports.AnalyticsStoreService = AnalyticsStoreService;
//# sourceMappingURL=analytics-store-service.js.map