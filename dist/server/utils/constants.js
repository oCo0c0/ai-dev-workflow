"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DAYTONA_DEFAULTS = exports.AI_DEFAULTS = exports.TIMEOUTS = exports.LEGACY_IMAGE_DIR = exports.REQUIREMENTS_DIR = exports.MEMORY_DIR = exports.APP_DATA_DIR = void 0;
/**
 * @module constants
 * @description 服务端共享常量
 *
 * 集中管理应用目录路径、超时时间和 AI 执行参数等常量，
 * 避免在多个文件中重复定义相同的魔法数字和路径。
 */
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// === 目录路径 ===
/** 应用数据根目录 */
exports.APP_DATA_DIR = path_1.default.join(os_1.default.homedir(), '.ai-dev-workbench');
/** 记忆子系统目录 */
exports.MEMORY_DIR = path_1.default.join(exports.APP_DATA_DIR, 'memory');
/** 需求数据根目录（每个需求一个子文件夹） */
exports.REQUIREMENTS_DIR = path_1.default.join(exports.APP_DATA_DIR, 'requirements');
/** 旧版需求图片目录（兼容迁移） */
exports.LEGACY_IMAGE_DIR = path_1.default.join(exports.APP_DATA_DIR, 'requirement-images');
// === 超时时间 (ms) ===
exports.TIMEOUTS = {
    /** MCP 服务器连接超时 */
    MCP_CONNECT: 5_000,
    /** 测试执行超时 */
    TEST_EXECUTION: 10_000,
    /** HTTP 文件下载超时 */
    HTTP_DOWNLOAD: 15_000,
    /** 桥接进程启动超时 */
    BRIDGE_START: 30_000,
};
// === AI 执行参数 ===
exports.AI_DEFAULTS = {
    /** 规划阶段最大轮次 */
    PLAN_MAX_TURNS: 20,
    /** 执行阶段最大轮次 */
    EXECUTION_MAX_TURNS: 30,
    /** 继续执行最大轮次 */
    EXECUTION_CONTINUE_MAX_TURNS: 50,
    /** 测试 AI 生成最大轮次 */
    TEST_AI_MAX_TURNS: 30,
};
// === Daytona 沙箱默认配置 ===
exports.DAYTONA_DEFAULTS = {
    /** Daytona Cloud 默认 API 地址 */
    API_URL: 'https://app.daytona.io/api',
    /** 沙箱默认镜像模板 */
    DEFAULT_TEMPLATE: 'daytonaio/sandbox:0.6.0',
};
//# sourceMappingURL=constants.js.map