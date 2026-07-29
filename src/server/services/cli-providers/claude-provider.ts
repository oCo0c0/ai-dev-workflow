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
import {findSkillMdFile} from '../../utils/skill-utils.js';
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
/** 全局命令目录（slash commands，支持子目录） */
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
/** 个人技能目录 */
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');
/** 已安装插件清单（权威插件 installPath 来源） */
const INSTALLED_PLUGINS_FILE = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json');
/** Claude 设置文件 */
const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');

/**
 * 读取 ~/.claude/settings.json 的 env 块（CLI 注入环境变量的来源）
 *
 * adw 进程本身不读 settings.json，导致其 process.env 缺失 ANTHROPIC_BASE_URL /
 * ANTHROPIC_API_KEY / ANTHROPIC_DEFAULT_*_MODEL。bridge 子进程继承 adw 的空 env，
 * SDK 只能改走 claude.exe 间接读取 settings.json 的路径，该路径下模型解析与 CLI
 * 直读 env 不一致，会触发中转 API 限流（529）。注入此 env 块使 bridge 与 CLI 对齐。
 *
 * @returns settings.json 中 env 对象，读取失败返回空对象
 */
function loadClaudeSettingsEnv(): Record<string, string> {
    try {
        if (!fs.existsSync(SETTINGS_FILE)) return {};
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as { env?: Record<string, string> };
        return (settings.env && typeof settings.env === 'object') ? settings.env : {};
    } catch {
        return {};
    }
}

/** 待处理请求的内部数据结构 */
interface PendingRequest {
    onOutput?: (data: string, meta?: Record<string, unknown>) => void;
    onError?: (data: string) => void;
    onPermissionRequest?: (meta: Record<string, unknown>) => void;
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
    private healthCheckTimer: NodeJS.Timeout | null = null;

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
                onPermissionRequest: options?.onPermissionRequest,
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

            // 合并模型配置到请求消息（传递给 bridge 进程）
            const messagePayload: Record<string, unknown> = {requestId, ...input};
            // 启用权限确认：透传给 bridge，由其在 options 注入 canUseTool
            if (options?.onPermissionRequest) messagePayload.permission = {enabled: true};
            if (options?.model) messagePayload.model = options.model;
            if (options?.reasoningEffort) messagePayload.reasoningEffort = options.reasoningEffort;
            if (options?.extendedThinking !== undefined) messagePayload.extendedThinking = options.extendedThinking;

            const message = JSON.stringify(messagePayload) + '\n';
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
        // 用 name 去重（同源同名只保留一个），保留插入顺序
        const map = new Map<string, SkillInfo>();

        // 1. 个人技能 ~/.claude/skills/<name>/SKILL.md（含根 .md）
        scanSkillsDir(SKILLS_DIR, '', 'personal', map);

        // 2. 命令 ~/.claude/commands/**/*.md（子目录 → dir:name）
        scanCommandsDir(COMMANDS_DIR, '', map);

        // 3. 插件技能（权威：installed_plugins.json 的 installPath）
        scanPluginSkills(INSTALLED_PLUGINS_FILE, map);

        return Array.from(map.values());
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
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
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
            // 清除 NODE_OPTIONS 中的 inspector 参数，避免子进程启动 debugger
            const env = {...process.env, ...loadClaudeSettingsEnv()};
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
                console.error(`[claude-provider] stderr: ${text.trim().slice(0, 500)}`);
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

            child.on('exit', (code, signal) => {
                console.error(`[claude-provider] process exited with code ${code}, signal ${signal}`);
                clearTimeout(timeout);
                this.ready = false;
                this.process = null;
                this.startPromise = null;

                // 健止健康检测
                if (this.healthCheckTimer) {
                    clearInterval(this.healthCheckTimer);
                    this.healthCheckTimer = null;
                }

                // Reject 所有 pending 请求（状态同步）
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error(`Bridge process exited with code ${code}`));
                }
                this.pendingRequests.clear();
            });

            this.readyCallbacks.push(() => {
                clearTimeout(timeout);
                console.log('[claude-provider] bridge process ready');
                // 启动健康检测（每 30 秒检查进程存活）
                this.startHealthCheck(child);
                resolve();
            });
        });
    }

    /**
     * 启动健康检测定时器
     * 每 30 秒检查进程是否存活，异常退出时清理 pending 请求
     */
    private startHealthCheck(proc: ChildProcess): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.healthCheckTimer = setInterval(() => {
            if (!proc || proc.killed) {
                console.error('[claude-provider] health check: process not alive, cleaning up');
                this.ready = false;
                this.process = null;
                this.startPromise = null;

                if (this.healthCheckTimer) {
                    clearInterval(this.healthCheckTimer);
                    this.healthCheckTimer = null;
                }

                // Reject 所有 pending 请求
                for (const [, req] of this.pendingRequests) {
                    req.reject(new Error('Bridge process not alive (health check)'));
                }
                this.pendingRequests.clear();
            }
        }, 30000); // 30 秒检查一次
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

            case 'thinking':
                if (msg.content) {
                    req.stdout += msg.content as string;
                    req.onOutput?.(msg.content as string, {type: 'thinking'});
                }
                break;

            case 'tool_use':
                req.onOutput?.('', {
                    type: 'tool_use',
                    toolName: msg.toolName as string,
                    toolInput: msg.toolInput,
                    toolUseId: msg.toolUseId as string,
                });
                break;

            case 'tool_result':
                req.onOutput?.(msg.content as string, {
                    type: 'tool_result',
                    toolUseId: msg.toolUseId as string,
                    isError: msg.isError as boolean,
                });
                break;

            case 'permission_request':
                // bridge 内 canUseTool 触发，转发给调用方（coordinator）走前端确认
                req.onPermissionRequest?.({
                    permissionRequestId: msg.permissionRequestId,
                    toolName: msg.toolName,
                    toolInput: msg.toolInput,
                    toolUseId: msg.toolUseId,
                    title: msg.title,
                    displayName: msg.displayName,
                });
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

    /**
     * 反向写回工具权限决策给 bridge，唤醒挂起的 canUseTool
     */
    confirmPermission(permissionRequestId: string, decision: 'allow' | 'deny', message?: string): void {
        const proc = this.process;
        if (proc && proc.stdin) {
            proc.stdin.write(JSON.stringify({
                type: 'permission_response',
                permissionRequestId,
                decision,
                message,
            }) + '\n');
        }
    }
}

/** 读 .md 文件并写入 map（已存在则跳过） */
function addMdSkill(filePath: string, name: string, source: string, map: Map<string, SkillInfo>): void {
    if (map.has(name)) return;
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        map.set(name, {
            name,
            description: extractDescription(content),
            enabled: true,
            filePath,
            source,
        });
    } catch { /* skip unreadable */
    }
}

/**
 * 扫描个人技能目录 ~/.claude/skills/
 * - 子目录 <name>/SKILL.md → 名 <name>
 * - 根 .md 文件 → 名 <name>（去 .md）
 */
function scanSkillsDir(dir: string, _prefix: string, source: string, map: Map<string, SkillInfo>): void {
    if (!fs.existsSync(dir)) return;
    try {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (entry.isDirectory()) {
                const mdFile = findSkillMdFile(path.join(dir, entry.name));
                if (mdFile) addMdSkill(mdFile, entry.name, source, map);
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
                addMdSkill(path.join(dir, entry.name), entry.name.replace(/\.md$/, ''), source, map);
            }
        }
    } catch { /* ignore */
    }
}

/**
 * 递归扫描命令目录（commands 下所有 md 文件，含子目录）
 * 子目录命令名带前缀：paddleocr/http-doc-workflow.md → paddleocr:http-doc-workflow
 * @param dir    当前目录
 * @param prefix 已积累的前缀（含末尾冒号，顶层为空）
 */
function scanCommandsDir(dir: string, prefix: string, map: Map<string, SkillInfo>): void {
    if (!fs.existsSync(dir)) return;
    try {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            if (entry.isFile() && entry.name.endsWith('.md')) {
                const name = `${prefix}${entry.name.replace(/\.md$/, '')}`;
                addMdSkill(path.join(dir, entry.name), name, 'command', map);
            } else if (entry.isDirectory()) {
                // 递归子目录，前缀累积
                scanCommandsDir(path.join(dir, entry.name), `${prefix}${entry.name}:`, map);
            }
        }
    } catch { /* ignore */
    }
}

/** installed_plugins.json 中单个插件的安装条目 */
interface InstalledPluginEntry {
    installPath: string;
}

/** 读取插件 manifest（installPath/.claude-plugin/plugin.json），失败返回 null */
function readPluginManifest(installPath: string): Record<string, unknown> | null {
    const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
    try {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * 解析插件声明的技能目录（绝对路径）。严格只认 skills 目录，不扫插件根：
 * - manifest 有 skills 字段（字符串或数组，如 "./skills/"）：仅保留指向 skills 的目录
 * - 无 manifest 或无 skills 字段：回退到约定 installPath/skills（不存在则空）
 */
function resolvePluginSkillDirs(installPath: string): string[] {
    const manifest = readPluginManifest(installPath);
    const dirs: string[] = [];

    if (manifest && manifest.skills !== undefined) {
        const raw = manifest.skills as unknown;
        const arr = Array.isArray(raw) ? raw : [raw];
        for (const rel of arr) {
            if (typeof rel !== 'string') continue;
            // ponytail: 只认 skills 类目录，忽略 ./commands/ 等非技能声明
            if (!rel.includes('skills')) continue;
            const abs = path.resolve(installPath, rel);
            if (fs.existsSync(abs)) dirs.push(abs);
        }
        if (dirs.length) return dirs;
    }

    // 约定回退：仅 installPath/skills
    const skillsSub = path.join(installPath, 'skills');
    return fs.existsSync(skillsSub) ? [skillsSub] : [];
}

/** 计算 SKILL.md 内容指纹（大小 + 前 1KB 文本），用于跨插件去重 monorepo 重复内容 */
function skillContentFingerprint(filePath: string): string {
    try {
        const stat = fs.statSync(filePath);
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(1024);
        const bytes = fs.readSync(fd, buf, 0, 1024, 0);
        fs.closeSync(fd);
        return `${stat.size}:${buf.subarray(0, bytes).toString('utf-8')}`;
    } catch {
        return '';
    }
}

/**
 * 扫描插件技能（权威来源 installed_plugins.json）：
 * 1. 对每个插件按 manifest 解析技能目录
 * 2. 扫目录下 SKILL.md，名 <plugin>:<skillDir>
 * 3. 用内容指纹全局去重（context-engineering 等 monorepo 多插件共享内容，避免重复）
 */
function scanPluginSkills(installedFile: string, map: Map<string, SkillInfo>): void {
    let raw: string;
    try {
        raw = fs.readFileSync(installedFile, 'utf-8');
    } catch {
        return; // 无插件清单则跳过
    }

    let pluginsObj: Record<string, InstalledPluginEntry[]>;
    try {
        const parsed = JSON.parse(raw);
        pluginsObj = parsed?.plugins ?? parsed; // 兼容 {plugins:{...}} 或直接 {...}
        if (!pluginsObj || typeof pluginsObj !== 'object') return;
    } catch {
        return;
    }

    const contentSeen = new Set<string>(); // 全局内容指纹去重

    for (const [key, entries] of Object.entries(pluginsObj)) {
        const pluginName = key.split('@')[0];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (!entry?.installPath || !fs.existsSync(entry.installPath)) continue;
            for (const skillDir of resolvePluginSkillDirs(entry.installPath)) {
                // 每个 skills 目录只取一层：<skillName>/SKILL.md
                for (const skillMd of findSkillMdFiles(skillDir, 1)) {
                    const fp = skillContentFingerprint(skillMd);
                    if (fp && contentSeen.has(fp)) continue; // monorepo 重复内容跳过
                    if (fp) contentSeen.add(fp);
                    const skillName = path.basename(path.dirname(skillMd));
                    addMdSkill(skillMd, `${pluginName}:${skillName}`, 'plugin', map);
                }
            }
        }
    }
}

/** 递归查找目录下所有 SKILL.md（限定深度避免无限递归，跳过 .git/node_modules） */
function findSkillMdFiles(rootDir: string, maxDepth = 2): string[] {
    const results: string[] = [];
    const walk = (dir: string, depth: number): void => {
        if (depth > maxDepth) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, {withFileTypes: true});
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === '.git' || entry.name === 'node_modules') continue;
                walk(path.join(dir, entry.name), depth + 1);
            } else if (entry.isFile() && entry.name === 'SKILL.md') {
                results.push(path.join(dir, entry.name));
            }
        }
    };
    walk(rootDir, 0);
    return results;
}

/** 根据命令推断 MCP 服务器类型 */
function inferServerType(command?: string): string {
    if (!command) return 'custom';
    if (command.includes('node') || command.includes('npx')) return 'node';
    if (command.includes('python') || command.includes('uvx')) return 'python';
    if (command.includes('docker')) return 'docker';
    return 'custom';
}
