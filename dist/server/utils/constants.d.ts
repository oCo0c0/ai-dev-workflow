/** 应用数据根目录 */
export declare const APP_DATA_DIR: string;
/** 记忆子系统目录 */
export declare const MEMORY_DIR: string;
/** 需求数据根目录（每个需求一个子文件夹） */
export declare const REQUIREMENTS_DIR: string;
/** 旧版需求图片目录（兼容迁移） */
export declare const LEGACY_IMAGE_DIR: string;
export declare const TIMEOUTS: {
    /** MCP 服务器连接超时 */
    readonly MCP_CONNECT: 5000;
    /** 测试执行超时 */
    readonly TEST_EXECUTION: 10000;
    /** HTTP 文件下载超时 */
    readonly HTTP_DOWNLOAD: 8000;
    /** 桥接进程启动超时 */
    readonly BRIDGE_START: 30000;
};
export declare const AI_DEFAULTS: {
    /** 规划阶段最大轮次 */
    readonly PLAN_MAX_TURNS: 20;
    /** 执行阶段最大轮次 */
    readonly EXECUTION_MAX_TURNS: 30;
    /** 继续执行最大轮次 */
    readonly EXECUTION_CONTINUE_MAX_TURNS: 50;
    /** 测试 AI 生成最大轮次 */
    readonly TEST_AI_MAX_TURNS: 30;
};
export declare const DAYTONA_DEFAULTS: {
    /** Daytona Cloud 默认 API 地址 */
    readonly API_URL: "https://app.daytona.io/api";
    /** 沙箱默认镜像模板 */
    readonly DEFAULT_TEMPLATE: "daytonaio/sandbox:0.6.0";
};
//# sourceMappingURL=constants.d.ts.map