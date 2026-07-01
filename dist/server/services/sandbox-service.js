"use strict";
/**
 * @file Daytona 沙箱服务
 * @description 封装 Daytona SDK，提供统一的沙箱管理接口。
 *   当 Daytona 未配置时，所有方法返回 null/false，上层服务透明回退到本地执行。
 *   沙箱按 workspacePath 复用，避免重复创建。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SandboxService = void 0;
const sdk_1 = require("@daytona/sdk");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * Daytona 沙箱服务
 *
 * 封装 Daytona SDK 客户端，提供沙箱生命周期管理和命令执行能力。
 * 设计原则：Daytona 未配置时所有操作静默降级，不抛异常。
 */
class SandboxService {
    client = null;
    config;
    /** workspacePath → Sandbox 实例缓存 */
    sandboxes = new Map();
    constructor(config) {
        this.config = config ?? {};
        this.initClient();
    }
    /** 初始化 Daytona 客户端 */
    initClient() {
        if (!this.config.enabled || !this.config.apiKey)
            return;
        try {
            this.client = new sdk_1.Daytona({
                apiKey: this.config.apiKey,
                apiUrl: this.config.apiUrl ?? constants_js_1.DAYTONA_DEFAULTS.API_URL,
            });
            console.log(`[sandbox] Daytona client initialized (${this.config.apiUrl ?? constants_js_1.DAYTONA_DEFAULTS.API_URL})`);
        }
        catch (err) {
            console.error(`[sandbox] Failed to initialize Daytona client: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            this.client = null;
        }
    }
    /** Daytona 沙箱是否启用 */
    isEnabled() {
        return this.client !== null && this.config.enabled === true;
    }
    /** 获取或创建沙箱 */
    async getSandbox(workspacePath, overrideSandboxId) {
        if (!this.isEnabled() || !this.client)
            return null;
        // 确定使用的 sandboxId：调用参数 > 配置文件
        const targetSandboxId = overrideSandboxId || this.config.sandboxId;
        // 模式一：指定了 sandboxId，直接获取（不创建新的）
        if (targetSandboxId) {
            const cached = this.sandboxes.get(targetSandboxId);
            if (cached) {
                try {
                    await cached.refreshData();
                    if (cached.state === sdk_1.SandboxState.STARTED)
                        return cached;
                }
                catch {
                    this.sandboxes.delete(targetSandboxId);
                }
            }
            try {
                const sandbox = await this.client.get(targetSandboxId);
                this.sandboxes.set(targetSandboxId, sandbox);
                console.log(`[sandbox] Using sandbox: ${targetSandboxId} (${sandbox.state})`);
                return sandbox;
            }
            catch (err) {
                console.error(`[sandbox] Failed to get sandbox "${targetSandboxId}": ${(0, error_utils_js_1.getErrorMessage)(err)}`);
                return null;
            }
        }
        // 模式二：自动创建（按 workspacePath 复用）
        const cached = this.sandboxes.get(workspacePath);
        if (cached) {
            try {
                // 刷新沙箱状态
                await cached.refreshData();
                if (cached.state === sdk_1.SandboxState.STARTED)
                    return cached;
            }
            catch (err) {
                // 沙箱已失效，移除缓存
                console.warn(`[sandbox] Cached sandbox for "${workspacePath}" is stale, removing: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
                this.sandboxes.delete(workspacePath);
            }
        }
        try {
            const sandboxName = `aiwb-${Buffer.from(workspacePath).toString('base64url').slice(0, 20)}`;
            console.log(`[sandbox] Creating sandbox "${sandboxName}" for workspace: ${workspacePath}`);
            const sandbox = await this.client.create({
                name: sandboxName,
                snapshot: this.config.template || constants_js_1.DAYTONA_DEFAULTS.DEFAULT_TEMPLATE,
                labels: { 'aiwb-workspace': workspacePath },
                autoStopInterval: 60, // 60 分钟无活动后停止
            }, { timeout: constants_js_1.TIMEOUTS.BRIDGE_START });
            this.sandboxes.set(workspacePath, sandbox);
            console.log(`[sandbox] Sandbox "${sandboxName}" created successfully`);
            return sandbox;
        }
        catch (err) {
            console.error(`[sandbox] Failed to create sandbox for "${workspacePath}": ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            return null;
        }
    }
    /** 在沙箱中执行命令 */
    async executeCommand(workspacePath, command, cwd, env, sandboxId) {
        const sandbox = await this.getSandbox(workspacePath, sandboxId);
        if (!sandbox)
            return null;
        try {
            const result = await sandbox.process.executeCommand(command, cwd, env, constants_js_1.TIMEOUTS.TEST_EXECUTION);
            return {
                exitCode: result.exitCode,
                stdout: result.result,
                stderr: '',
            };
        }
        catch (err) {
            console.error(`[sandbox] Command execution failed in sandbox for "${workspacePath}": ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            return null;
        }
    }
    /**
     * 将本地工作区的变更文件同步到沙箱
     *
     * 使用 git 获取变更文件列表（包括未提交的新文件），
     * 通过 Daytona SDK 的 uploadFiles API 上传到沙箱。
     * 无 git 仓库时回退到全量同步最近修改的文件。
     *
     * @param localPath - 本地工作区路径
     * @param sandboxId - 目标沙箱 ID
     * @returns 是否同步成功
     */
    async syncChangedFiles(localPath, sandboxId) {
        const sandbox = await this.getSandbox(localPath, sandboxId);
        if (!sandbox)
            return false;
        try {
            // 获取变更文件列表：git 索引中的所有文件 + 未跟踪的新文件
            let filesToSync = [];
            try {
                const tracked = (0, child_process_1.execSync)('git ls-files', { cwd: localPath, encoding: 'utf-8' }).trim();
                const untracked = (0, child_process_1.execSync)('git ls-files --others --exclude-standard', { cwd: localPath, encoding: 'utf-8' }).trim();
                const allFiles = [...tracked.split('\n'), ...untracked.split('\n')]
                    .map(f => f.trim())
                    .filter(f => f.length > 0);
                filesToSync = allFiles;
            }
            catch {
                // 无 git 仓库，尝试获取最近修改的文件
                console.warn(`[sandbox] Not a git repo, falling back to recent file scan: ${localPath}`);
                filesToSync = this.getRecentFiles(localPath);
            }
            if (filesToSync.length === 0) {
                console.warn(`[sandbox] No files to sync from ${localPath}`);
                return true;
            }
            // 分批上传（避免单次请求过大）
            const BATCH_SIZE = 50;
            for (let i = 0; i < filesToSync.length; i += BATCH_SIZE) {
                const batch = filesToSync.slice(i, i + BATCH_SIZE);
                const uploads = batch
                    .filter(f => {
                    const fullPath = path_1.default.join(localPath, f);
                    return fs_1.default.existsSync(fullPath) && fs_1.default.statSync(fullPath).isFile();
                })
                    .map(f => ({
                    source: path_1.default.join(localPath, f),
                    destination: `/workspace/${f}`,
                }));
                if (uploads.length > 0) {
                    await sandbox.fs.uploadFiles(uploads, 600);
                }
            }
            console.log(`[sandbox] Synced ${filesToSync.length} files to sandbox`);
            return true;
        }
        catch (err) {
            console.error(`[sandbox] File sync failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            return false;
        }
    }
    /**
     * 获取最近修改的文件列表（非 git 仓库的回退方案）
     * 递归扫描目录，返回最近 24 小时内修改的文件，排除 node_modules 等
     */
    getRecentFiles(rootPath) {
        const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.gradle', 'target']);
        const result = [];
        const now = Date.now();
        const ONE_DAY = 24 * 60 * 60 * 1000;
        const walk = (dir) => {
            try {
                const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (EXCLUDE.has(entry.name))
                        continue;
                    const fullPath = path_1.default.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath);
                    }
                    else if (entry.isFile()) {
                        const stat = fs_1.default.statSync(fullPath);
                        if (now - stat.mtimeMs < ONE_DAY) {
                            result.push(path_1.default.relative(rootPath, fullPath).replace(/\\/g, '/'));
                        }
                    }
                }
            }
            catch {
                // 忽略权限错误等
            }
        };
        walk(rootPath);
        return result;
    }
    /** 获取所有活跃沙箱信息 */
    async listActive() {
        if (!this.isEnabled() || !this.client)
            return [];
        try {
            const iterator = await this.client.list();
            const items = [];
            for await (const s of iterator)
                items.push(s);
            return items
                .filter((s) => s.state === sdk_1.SandboxState.STARTED)
                .map((s) => ({
                id: s.id,
                name: s.name ?? '',
                state: s.state ?? 'unknown',
                workspacePath: s.labels?.['aiwb-workspace'] ?? '',
            }));
        }
        catch {
            return [];
        }
    }
    /** 销毁指定沙箱 */
    async destroySandbox(workspacePath) {
        const sandbox = this.sandboxes.get(workspacePath);
        if (!sandbox)
            return false;
        try {
            await sandbox.delete();
            this.sandboxes.delete(workspacePath);
            return true;
        }
        catch {
            return false;
        }
    }
    /** 销毁所有缓存沙箱（服务关闭时调用） */
    async cleanup() {
        const paths = [...this.sandboxes.keys()];
        await Promise.allSettled(paths.map(p => this.destroySandbox(p)));
    }
    /** 获取当前配置状态（用于调试/状态接口） */
    getStatus() {
        return {
            enabled: this.isEnabled(),
            apiUrl: this.config.apiUrl ?? constants_js_1.DAYTONA_DEFAULTS.API_URL,
            sandboxId: this.config.sandboxId || undefined,
            template: this.config.sandboxId ? undefined : (this.config.template || constants_js_1.DAYTONA_DEFAULTS.DEFAULT_TEMPLATE),
            activeCount: this.sandboxes.size,
        };
    }
}
exports.SandboxService = SandboxService;
//# sourceMappingURL=sandbox-service.js.map