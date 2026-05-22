/**
 * @module claude-provider
 * @description Claude Code CLI Provider 实现
 *
 * 封装 Claude Agent SDK 的桥接进程管理，从原有的 BridgeProcess 类迁移而来。
 * 通过持久化子进程（claude-bridge.mjs）+ JSON 行协议实现双向通信。
 */
import type { CLIProvider, CLIProviderStatus, CLIProviderInput, CLIProviderOptions, CLIProviderResult, SkillInfo, McpServerInfo } from './types.js';
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
    detect(): Promise<CLIProviderStatus>;
    initialize(): Promise<void>;
    run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult>;
    loadSkills(): Promise<SkillInfo[]>;
    loadMcpServers(): Promise<McpServerInfo[]>;
    dispose(): Promise<void>;
    private ensureStarted;
    private start;
    private handleMessage;
}
//# sourceMappingURL=claude-provider.d.ts.map