"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedbackLogStore = void 0;
/**
 * @module feedback-log-store
 * @description 用户反馈日志持久化存储
 *
 * 记录用户对 AI 输出的修正、偏好和拒绝反馈。
 * 存储在 ~/.ai-dev-workbench/memory/feedback-log.json，上限 50 条。
 */
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const json_store_js_1 = require("../json-store.js");
const constants_js_1 = require("../../utils/constants.js");
const STORE_FILE = path_1.default.join(constants_js_1.MEMORY_DIR, 'feedback-log.json');
/**
 * 用户反馈日志存储服务
 *
 * 继承 JsonStore 基类，按 timestamp 倒序，上限 50 条。
 * 额外提供按执行 ID 查询和自动生成 ID 的 add 方法。
 */
class FeedbackLogStore extends json_store_js_1.JsonStore {
    constructor(storeFile) {
        super({ defaultPath: STORE_FILE, maxRecords: 50, sortField: 'timestamp' }, storeFile);
    }
    /** 按执行 ID 查找反馈 */
    getByExecutionId(executionId) {
        return this.load().filter(e => e.executionId === executionId);
    }
    /** 添加反馈条目（自动生成 id 和 timestamp） */
    add(entry) {
        const record = {
            ...entry,
            id: crypto_1.default.randomUUID(),
            timestamp: new Date().toISOString(),
        };
        const entries = this.load();
        entries.push(record);
        this.save(entries);
        return record;
    }
}
exports.FeedbackLogStore = FeedbackLogStore;
//# sourceMappingURL=feedback-log-store.js.map