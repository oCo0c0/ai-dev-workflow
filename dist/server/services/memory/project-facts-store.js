"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectFactsStore = void 0;
/**
 * @module project-facts-store
 * @description 项目特征持久化存储
 *
 * 按工作空间路径索引，存储项目技术栈、测试框架、目录约定等特征信息。
 * 存储在 ~/.ai-dev-workbench/memory/project-facts.json，上限 20 条。
 */
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const json_store_js_1 = require("../json-store.js");
const constants_js_1 = require("../../utils/constants.js");
const STORE_FILE = path_1.default.join(constants_js_1.MEMORY_DIR, 'project-facts.json');
/**
 * 项目特征存储服务
 *
 * 继承 JsonStore 基类，覆盖 upsert 以自动生成 ID。
 */
class ProjectFactsStore extends json_store_js_1.JsonStore {
    constructor(storeFile) {
        super({ defaultPath: STORE_FILE, maxRecords: 20, sortField: 'updatedAt' }, storeFile);
    }
    /** 根据 workspacePath 生成 ID */
    static idFromPath(workspacePath) {
        return crypto_1.default.createHash('md5').update(workspacePath).digest('hex').substring(0, 12);
    }
    /** 按工作空间路径查找 */
    getByPath(workspacePath) {
        const id = ProjectFactsStore.idFromPath(workspacePath);
        return this.get(id);
    }
    /** 创建或更新项目特征（自动生成 ID） */
    upsert(fact) {
        const id = fact.id ?? ProjectFactsStore.idFromPath(fact.workspacePath);
        return super.upsert({ ...fact, id });
    }
}
exports.ProjectFactsStore = ProjectFactsStore;
//# sourceMappingURL=project-facts-store.js.map