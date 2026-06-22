/**
 * @module claude-provider
 * @description Claude Code CLI Provider 实现
 *
 * 封装 Claude Agent SDK 的桥接进程管理，从原有的 BridgeProcess 类迁移而来。
 * 通过持久化子进程（claude-bridge.mjs）+ JSON 行协议实现双向通信。
 */

import {ChildProcess, spawn} from 'child_process';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import {getErrorMessage} from '../../utils/error-utils.js';
import {extractDescription} from '../../utils/markdown-utils.js';
import type {
    CLIProvider,
    CLIProviderInput,
    CLIProviderOptions,
    CLIProviderResult,
    CLIProviderStatus,
    McpServerInfo,
    SkillInfo,
} from './types.js';

/** 桥接脚本路径（编译后相对 dist/server/services/） */
const BRIDGE_SCRIPT = path.resolve(__dirname, '../../../bridge/claude-bridge.mjs');

/** Claude 配置根目录 */
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
/** 全局命令目录 */
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
/** 技能目录 */
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
/** Claude 设置文件 */
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

/** 待处理请求的内部数据结构 */
interface PendingRequest {
    onOutput?: (data: string) => void;
    onError?: (data: string) => void;
    resolve: (result: CLIProviderResult) => void;
    reject: (err: Error) => void;
    stdout: string;
    sessionId?: string;
    aborted: boolean;
    abortHandler?: () => void;
}

/**
 * Claude Code CLI Provider
 * @description 通过持久化桥接子进程与 Claude Agent SDK 通信
 */
export class ClaudeProvider implements CLIProvider {
    readonly id = 'claude' as const;
    readonly label = 'Claude Code';

    private process: ChildProcess | null = null;
    private ready = false;
    private buffer = '';
    private pendingRequests = new Map<string, PendingRequest>();
    private readyCallbacks: Array<() => void> = [];
    private startPromise: Promise<void> | null = null;

    async detect(): Promise<CLIProviderStatus> {
        try {
            // 检查桥接脚本是否存在
            if (!fs.existsSync(BRIDGE_SCRIPT)) {
                return {available: false, error: `Bridge script not found: ${BRIDGE_SCRIPT}`};
            }

            // 检查 @anthropic-ai/claude-agent-sdk 是否可导入
            let sdkPath: string | undefined;
            try {
                sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
            } catch {
                return {available: false, error: '@anthropic-ai/claude-agent-sdk not installed'};
            }

            return {
                available: true,
                version: 'claude-agent-sdk',
                path: sdkPath,
            };
        } catch (err) {
            return {available: false, error: getErrorMessage(err)};
        }
    }

    async initialize(): Promise<void> {
        await this.ensureStarted();
    }

    async run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult> {
        await this.ensureStarted();

        if (!this.process || !this.ready) {
            throw new Error('Bridge process is not ready');
        }

        const requestId = crypto.randomUUID();

        return new Promise((resolve, reject) => {
            const req: PendingRequest = {
                onOutput: options?.onOutput,
                onError: options?.onError,
                resolve,
                reject,
                stdout: '',
                aborted: false,
            };

            if (options?.signal) {
                if (options.signal.aborted) {
                    resolve({exitCode: null, stdout: '', stderr: '', aborted: true});
                    return;
                }
                const abortHandler = () => {
                    req.aborted = true;
                    this.pendingRequests.delete(requestId);
                    resolve({exitCode: null, stdout: req.stdout, stderr: '', aborted: true});
                };
                req.abortHandler = abortHandler;
                options.signal.addEventListener('abort', abortHandler, {once: true});
            }

            this.pendingRequests.set(requestId, req);

            const message = JSON.stringify({requestId, ...input}) + '\n';
            const proc = this.process;
            if (proc && proc.stdin) {
                proc.stdin.write(message);
            } else {
                this.pendingRequests.delete(requestId);
                reject(new Error('Bridge process stdin not available'));
            }
        });
    }

    async loadSkills(): Promise<SkillInfo[]> {
        const skills: SkillInfo[] = [];

        // 扫描 commands/ 目录
        if (fs.existsSync(COMMANDS_DIR)) {
            try {
                const entries = fs.readdirSync(COMMANDS_DIR, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path.join(COMMANDS_DIR, entry.name);
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: entry.name.replace(/\.md$/, ''),
                                description: extractDescription(content),
                                enabled: true,
                                filePath,
                            });
                        } catch { /* skip */
                        }
                    }
                }
            } catch { /* ignore */
            }
        }

        // 扫描 skills/ 目录
        if (fs.existsSync(SKILLS_DIR)) {
            try {
                const entries = fs.readdirSync(SKILLS_DIR, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const skillDir = path.join(SKILLS_DIR, entry.name);
                        const mdFile = findSkillMdFile(skillDir);
                        if (mdFile) {
                            try {
                                const content = fs.readFileSync(mdFile, 'utf-8');
                                skills.push({
                                    name: entry.name,
                                    description: extractDescription(content),
                                    enabled: true,
                                    filePath: mdFile,
                                });
                            } catch { /* skip */
                            }
                        }
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path.join(SKILLS_DIR, entry.name);
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: entry.name.replace(/\.md$/, ''),
                                description: extractDescription(content),
                                enabled: true,
                                filePath,
                            });
                        } catch { /* skip */
                        }
                    }
                }
            } catch { /* ignore */
            }
        }

        return skills;
    }

    async loadMcpServers(): Promise<McpServerInfo[]> {
        if (!fs.existsSync(SETTINGS_FILE)) {
            return [];
        }

        try {
            const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            const settings = JSON.parse(raw);
            const servers: McpServerInfo[] = [];

            if (settings.mcpServers && typeof settings.mcpServers === 'object') {
                for (const [name, config] of Object.entries(settings.mcpServers as Record<string, {
                    command?: string;
                    args?: string[];
                    env?: Record<string, string>;
                }>)) {
                    servers.push({
                        name,
                        type: inferServerType(config.command),
                        command: config.command ?? '',
                        args: config.args ?? [],
                        env: config.env ?? {},
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
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.ready = false;
        }
        this.startPromise = null;
    }

    private async ensureStarted(): Promise<void> {
        if (this.ready && this.process) return;
        if (this.startPromise) return this.startPromise;

        this.startPromise = this.start();
        return this.startPromise;
    }

    private start(): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`[claude-provider] spawning: node ${BRIDGE_SCRIPT}`);
            // 清除 NODE_OPTIONS 中的 inspector 参数，避免子进程启动 debugger
            const env = {...process.env};
            if (env.NODE_OPTIONS) {
                env.NODE_OPTIONS = env.NODE_OPTIONS
                    .split(/\s+/)
                    .filter((opt: string) => !opt.startsWith('--inspect') && !opt.startsWith('--debug'))
                    .join(' ');
            }

            const child = spawn('node', [BRIDGE_SCRIPT], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env,
            });

            this.process = child;

            const timeout = setTimeout(() => {
                reject(new Error('Bridge process failed to start within 30 seconds'));
                child.kill();
            }, 30000);

            child.stdout.on('data', (chunk: Buffer) => {
                this.buffer += chunk.toString();
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() ?? '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        this.handleMessage(JSON.parse(line));
                    } catch { /* ignore non-JSON */
                    }
                }
            });

            child.stderr.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                console.error(`[claude-provider] stderr: ${text.trim()}`);
                for (const req of this.pendingRequests.values()) {
                    req.onError?.(text);
                }
            });

            child.on('error', (err) => {
                console.error(`[claude-provider] process error: ${err.message}`);
                clearTimeout(timeout);
                this.ready = false;
                this.process = null;
                this.startPromise = null;
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error(`Bridge process error: ${err.message}`));
                }
                this.pendingRequests.clear();
                reject(err);
            });

            child.on('exit', (code) => {
                console.error(`[claude-provider] process exited with code ${code}`);
                clearTimeout(timeout);
                this.ready = false;
                this.process = null;
                this.startPromise = null;
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error(`Bridge process exited with code ${code}`));
                }
                this.pendingRequests.clear();
            });

            this.readyCallbacks.push(() => {
                clearTimeout(timeout);
                resolve();
            });
        });
    }

    private handleMessage(msg: Record<string, unknown>) {
        if (msg.type === 'ready') {
            this.ready = true;
            this.startPromise = null;
            for (const cb of this.readyCallbacks) cb();
            this.readyCallbacks = [];
            return;
        }

        const requestId = msg.requestId as string;
        if (!requestId) return;

        const req = this.pendingRequests.get(requestId);
        if (!req) return;

        switch (msg.type) {
            case 'output':
                if (msg.content) {
                    req.stdout += msg.content as string;
                    req.onOutput?.(msg.content as string);
                }
                break;

            case 'session':
                if (msg.sessionId) {
                    req.sessionId = msg.sessionId as string;
                }
                break;

            case 'error':
                req.onError?.(msg.message as string || 'Unknown error');
                this.pendingRequests.delete(requestId);
                req.resolve({
                    exitCode: 1,
                    stdout: req.stdout,
                    stderr: msg.message as string || '',
                    aborted: req.aborted,
                    sessionId: req.sessionId,
                });
                break;

            case 'done':
                this.pendingRequests.delete(requestId);
                req.resolve({
                    exitCode: (msg.exitCode as number) ?? 0,
                    stdout: req.stdout,
                    stderr: '',
                    aborted: req.aborted,
                    sessionId: req.sessionId,
                });
                break;
        }
    }
}

/** 在技能子目录中查找主 .md 文件 */
function findSkillMdFile(dirPath: string): string | null {
    try {
        const files = fs.readdirSync(dirPath);
        const skillMd = files.find(f => f === 'SKILL.md');
        if (skillMd) return path.join(dirPath, skillMd);
        const indexMd = files.find(f => f === 'index.md');
        if (indexMd) return path.join(dirPath, indexMd);
        const firstMd = files.find(f => f.endsWith('.md'));
        if (firstMd) return path.join(dirPath, firstMd);
        return null;
    } catch {
        return null;
    }
}

/** 根据命令推断 MCP 服务器类型 */
function inferServerType(command?: string): string {
    if (!command) return 'custom';
    if (command.includes('node') || command.includes('npx')) return 'node';
    if (command.includes('python') || command.includes('uvx')) return 'python';
    if (command.includes('docker')) return 'docker';
    return 'custom';
}
