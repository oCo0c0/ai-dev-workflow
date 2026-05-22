/**
 * @module codex-provider
 * @description OpenAI Codex CLI Provider 实现
 *
 * 通过 @openai/codex-sdk 直接调用 Codex CLI，无需子进程桥接。
 * 支持流式输出和会话续接。
 */

import {execSync} from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {getErrorMessage} from '../../utils/error-utils.js';
import type {
    CLIProvider,
    CLIProviderStatus,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    SkillInfo,
    McpServerInfo,
} from './types.js';

/** Codex 配置目录 */
const CODEX_DIR = path.join(os.homedir(), '.codex');

/**
 * OpenAI Codex CLI Provider
 * @description 通过 @openai/codex-sdk 直接 Node.js 调用，无需子进程
 */
export class CodexProvider implements CLIProvider {
    readonly id = 'codex' as const;
    readonly label = 'OpenAI Codex';

    /** Codex SDK 客户端实例 */
    private client: InstanceType<typeof import('@openai/codex-sdk').Codex> | null = null;
    /** 会话 ID → Thread ID 映射 */
    private sessionIdToThreadId = new Map<string, string>();
    /** Thread ID → 会话 ID 映射 */
    private threadIdToSessionId = new Map<string, string>();

    async detect(): Promise<CLIProviderStatus> {
        try {
            // 检查 API Key
            if (!process.env.OPENAI_API_KEY) {
                return {available: false, error: 'OPENAI_API_KEY environment variable not set'};
            }

            // 检查 SDK 是否可导入
            let sdkPath: string | undefined;
            try {
                // ESM 动态导入检测
                const sdk = await import('@openai/codex-sdk');
                if (!sdk.Codex) {
                    return {available: false, error: '@openai/codex-sdk: Codex class not exported'};
                }
                sdkPath = '@openai/codex-sdk';
            } catch {
                return {available: false, error: '@openai/codex-sdk not installed'};
            }

            // 检查 codex CLI 是否安装
            let cliPath: string | undefined;
            try {
                cliPath = execSync('which codex 2>/dev/null || where codex 2>/dev/null', {encoding: 'utf-8'}).trim();
            } catch {
                // CLI 未安装但 SDK 可用，仍然可以使用
            }

            return {
                available: true,
                version: 'codex-sdk',
                path: cliPath || sdkPath,
            };
        } catch (err) {
            return {available: false, error: getErrorMessage(err)};
        }
    }

    async initialize(): Promise<void> {
        // Codex SDK 不需要预启动，按需创建客户端
        this.client = await this.createClient();
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        const client = await this.ensureClient();

        try {
            // 确定是否续接已有 thread
            let thread: InstanceType<typeof import('@openai/codex-sdk').Thread>;

            if (input.sessionId) {
                const threadId = this.sessionIdToThreadId.get(input.sessionId);
                if (threadId) {
                    thread = client.resumeThread(threadId);
                } else {
                    thread = client.startThread({
                        workingDirectory: input.cwd,
                    });
                }
            } else {
                thread = client.startThread({
                    workingDirectory: input.cwd,
                });
            }

            // 生成会话 ID
            const sessionId = input.sessionId || `codex-${Date.now()}`;

            let stdout = '';

            // 使用 runStreamed 获取流式输出
            const {events} = await thread.runStreamed(input.prompt, {
                signal: options?.signal,
            });

            for await (const event of events) {
                if (options?.signal?.aborted) {
                    break;
                }

                switch (event.type) {
                    case 'item.completed': {
                        // 提取 agent 消息文本
                        const item = event.item as Record<string, unknown>;
                        if (item.type === 'agentMessage' && typeof item.text === 'string') {
                            stdout += item.text;
                            options?.onOutput?.(item.text);
                        }
                        // 提取命令执行输出
                        if (item.type === 'commandExecution' && typeof item.output === 'string') {
                            stdout += item.output;
                            options?.onOutput?.(item.output);
                        }
                        break;
                    }
                    case 'turn.completed':
                        // Turn 完成
                        break;
                }
            }

            // 保存 thread ID 映射
            const threadId = thread.id;
            if (threadId && typeof threadId === 'string') {
                this.sessionIdToThreadId.set(sessionId, threadId);
                this.threadIdToSessionId.set(threadId, sessionId);
            }

            if (options?.signal?.aborted) {
                return {exitCode: null, stdout, stderr: '', sessionId, aborted: true};
            }

            return {exitCode: 0, stdout, stderr: '', sessionId, aborted: false};
        } catch (err) {
            const message = getErrorMessage(err);
            options?.onError?.(message);
            return {exitCode: 1, stdout: '', stderr: message, aborted: false};
        }
    }

    async loadSkills(): Promise<SkillInfo[]> {
        const skills: SkillInfo[] = [];

        // Codex 的指令/配置存储在 ~/.codex/ 目录
        const instructionsDir = path.join(CODEX_DIR, 'instructions');
        if (fs.existsSync(instructionsDir)) {
            try {
                const entries = fs.readdirSync(instructionsDir, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path.join(instructionsDir, entry.name);
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: entry.name.replace(/\.md$/, ''),
                                description: extractDescription(content),
                                enabled: true,
                                filePath,
                            });
                        } catch { /* skip */ }
                    }
                }
            } catch { /* ignore */ }
        }

        return skills;
    }

    async loadMcpServers(): Promise<McpServerInfo[]> {
        // Codex MCP 配置（如有）
        const configFile = path.join(CODEX_DIR, 'config.json');
        if (!fs.existsSync(configFile)) {
            return [];
        }

        try {
            const raw = fs.readFileSync(configFile, 'utf-8');
            const config = JSON.parse(raw);
            const servers: McpServerInfo[] = [];

            if (config.mcpServers && typeof config.mcpServers === 'object') {
                for (const [name, serverConfig] of Object.entries(config.mcpServers as Record<string, {
                    command?: string;
                }>)) {
                    servers.push({
                        name,
                        type: inferServerType(serverConfig.command),
                        command: serverConfig.command ?? '',
                        enabled: true,
                    });
                }
            }

            return servers;
        } catch {
            return [];
        }
    }

    async dispose(): Promise<void> {
        this.client = null;
        this.sessionIdToThreadId.clear();
        this.threadIdToSessionId.clear();
    }

    // === 内部方法 ===

    /** 动态导入并创建 Codex 客户端 */
    private async createClient(): Promise<InstanceType<typeof import('@openai/codex-sdk').Codex>> {
        const {Codex} = await import('@openai/codex-sdk');
        return new Codex();
    }

    /** 确保客户端已初始化 */
    private async ensureClient(): Promise<InstanceType<typeof import('@openai/codex-sdk').Codex>> {
        if (!this.client) {
            this.client = await this.createClient();
        }
        return this.client;
    }
}

// === 辅助函数 ===

/** 从 Markdown 内容提取描述 */
function extractDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
        }
        if (trimmed.startsWith('#')) {
            const headerText = trimmed.replace(/^#+\s*/, '');
            return headerText.length > 100 ? headerText.substring(0, 100) + '...' : headerText;
        }
    }
    return '';
}

/** 根据命令推断服务器类型 */
function inferServerType(command?: string): string {
    if (!command) return 'custom';
    if (command.includes('node') || command.includes('npx')) return 'node';
    if (command.includes('python') || command.includes('uvx')) return 'python';
    if (command.includes('docker')) return 'docker';
    return 'custom';
}
