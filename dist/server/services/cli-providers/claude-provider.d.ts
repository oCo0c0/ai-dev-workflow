/**
 * @module claude-provider
 * @description Claude Code CLI Provider 实现
 *
 * 封装 Claude Agent SDK 的桥接进程管理，从原有的 BridgeProcess 类迁移而来。
 * 通过持久化子进程（claude-bridge.mjs）+ JSON 行协议实现双向通信。
 */
import type { CLIProvider, CLIProviderInput, CLIProviderOptions, CLIProviderResult, CLIProviderStatus, McpServerInfo, SkillInfo } from './types.js';
/**
 * Claude Code CLI Provider
 * @description 通过持久化桥接子进程与 Claude Agent SDK 通信
 */
export declare class ClaudeProvider implements CLIProvider {
    readonly id: "claude";
    readonly label = "Claude Code";
    private process;
    private ready;
    private buffer;
    private pendingRequests;
    private readyCallbacks;
    private startPromise;
    private healthCheckTimer;
    detect(): Promise<CLIProviderStatus>;
    initialize(): Promise<void>;
    run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult>;
    loadSkills(): Promise<SkillInfo[]>;
    loadMcpServers(): Promise<McpServerInfo[]>;
    dispose(): Promise<void>;
    private ensureStarted;
    private start;
    /**
     * 启动健康检测定时器
     * 每 30 秒检查进程是否存活，异常退出时清理 pending 请求
     */
    private startHealthCheck;
    private handleMessage;
}
//# sourceMappingURL=claude-provider.d.ts.map