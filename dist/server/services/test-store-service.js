"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestStoreService = void 0;
/**
 * @file 测试运行记录存储服务
 * @description 提供测试运行记录的本地持久化存储能力。
 *   每次测试执行（包括手动触发和管线自动执行）的结果都会被保存到本地，
 *   以便用户查看历史记录和追踪测试趋势。
 *   数据以 JSON 数组格式存储在 ~/.ai-dev-workbench/test-runs.json 文件中。
 *   最多保留 50 条记录。
 */
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
const json_store_js_1 = require("./json-store.js");
/** 默认存储文件路径 */
const TEST_RUNS_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'test-runs.json');
/**
 * 测试运行记录存储服务类
 *
 * 继承 JsonStore 通用基类，按 startedAt 倒序排列，最多保留 50 条记录。
 */
class TestStoreService extends json_store_js_1.JsonStore {
    constructor(storeFile) {
        super({ defaultPath: TEST_RUNS_FILE, maxRecords: 50, sortField: 'startedAt' }, storeFile);
    }
}
exports.TestStoreService = TestStoreService;
//# sourceMappingURL=test-store-service.js.map