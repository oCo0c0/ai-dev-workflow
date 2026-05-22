/**
 * @module codex-provider
 * @description OpenAI Codex CLI Provider 实现
 *
 * 通过 @openai/codex-sdk 直接调用 Codex CLI，无需子进程桥接。
 * 支持流式输出和会话续接。
 */
import type { CLIProvider, CLIProviderStatus, CLIProviderInput, CLIProviderOptions, CLIProviderResult, SkillInfo, McpServerInfo } from './types.js';
/**
 * OpenAI Codex CLI Provider
 * @description 通过 @openai/codex-sdk 直接 Node.js 调用，无需子进程
 */
export declare class CodexProvider implements CLIProvider {
    readonly id: "codex";
    readonly label = "OpenAI Codex";
    /** Codex SDK 客户端实例 */
    private client;
    /** 会话 ID → Thread ID 映射 */
    private sessionIdToThreadId;
    /** Thread ID → 会话 ID 映射 */
    private threadIdToSessionId;
    detect(): Promise<CLIProviderStatus>;
    initialize(): Promise<void>;
    run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult>;
    loadSkills(): Promise<SkillInfo[]>;
    loadMcpServers(): Promise<McpServerInfo[]>;
    dispose(): Promise<void>;
    /** 动态导入并创建 Codex 客户端 */
    private createClient;
    /** 确保客户端已初始化 */
    private ensureClient;
}
//# sourceMappingURL=codex-provider.d.ts.map