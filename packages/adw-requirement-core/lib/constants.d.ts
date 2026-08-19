/**
 * @file 核心常量（自 adw utils/constants.ts 抽取的最小子集）
 * @description 仅保留需求获取链路实际使用的超时常量。
 */
/** 超时配置（毫秒） */
export declare const TIMEOUTS: {
    /** MCP 服务器连接超时 */
    readonly MCP_CONNECT: 5000;
    /** HTTP 文件下载超时 */
    readonly HTTP_DOWNLOAD: 8000;
    /** 桥接进程启动超时 */
    readonly BRIDGE_START: 30000;
};
//# sourceMappingURL=constants.d.ts.map