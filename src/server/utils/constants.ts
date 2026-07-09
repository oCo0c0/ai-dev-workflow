/**
 * @module constants
 * @description 服务端共享常量
 *
 * 集中管理应用目录路径、超时时间和 AI 执行参数等常量，
 * 避免在多个文件中重复定义相同的魔法数字和路径。
 */
import path from 'path';
import os from 'os';

// === 目录路径 ===

/** 应用数据根目录 */
export const APP_DATA_DIR = path.join(os.homedir(), '.ai-dev-workbench');
/** 记忆子系统目录 */
export const MEMORY_DIR = path.join(APP_DATA_DIR, 'memory');
/** 需求数据根目录（每个需求一个子文件夹） */
export const REQUIREMENTS_DIR = path.join(APP_DATA_DIR, 'requirements');
/** 旧版需求图片目录（兼容迁移） */
export const LEGACY_IMAGE_DIR = path.join(APP_DATA_DIR, 'requirement-images');

// === 超时时间 (ms) ===

export const TIMEOUTS = {
    /** MCP 服务器连接超时 */
    MCP_CONNECT: 5_000,
    /** 测试执行超时 */
    TEST_EXECUTION: 10_000,
    /** HTTP 文件下载超时 */
    HTTP_DOWNLOAD: 8_000,  // 降低到 8 秒，避免图片下载卡住
    /** 桥接进程启动超时 */
    BRIDGE_START: 30_000,
} as const;

// === AI 执行参数 ===

export const AI_DEFAULTS = {
    /** 规划阶段最大轮次 */
    PLAN_MAX_TURNS: 20,
    /** 执行阶段最大轮次 */
    EXECUTION_MAX_TURNS: 30,
    /** 继续执行最大轮次 */
    EXECUTION_CONTINUE_MAX_TURNS: 50,
    /** 测试 AI 生成最大轮次 */
    TEST_AI_MAX_TURNS: 30,
} as const;

// === Daytona 沙箱默认配置 ===

export const DAYTONA_DEFAULTS = {
    /** Daytona Cloud 默认 API 地址 */
    API_URL: 'https://app.daytona.io/api',
    /** 沙箱默认镜像模板 */
    DEFAULT_TEMPLATE: 'daytonaio/sandbox:0.6.0',
} as const;
