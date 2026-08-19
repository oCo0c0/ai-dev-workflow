/**
 * @file 核心常量（自 adw utils/constants.ts 抽取的最小子集）
 * @description 仅保留需求获取链路实际使用的超时常量。
 */

/** 超时配置（毫秒） */
export const TIMEOUTS = {
    /** MCP 服务器连接超时 */
    MCP_CONNECT: 5_000,
    /** HTTP 文件下载超时 */
    HTTP_DOWNLOAD: 8_000,
    /** 桥接进程启动超时 */
    BRIDGE_START: 30_000,
} as const;
