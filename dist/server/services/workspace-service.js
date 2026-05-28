"use strict";
/**
 * @module workspace-service
 * @description 工作区管理服务模块
 *
 * 提供工作区的完整生命周期管理功能，包括：
 * - 工作区浏览、验证与选择
 * - 项目类型自动检测（Node.js / Python / Java / Rust）
 * - 上下文文件扫描（如 .claude.md、package.json 等）
 * - Git 状态查询与差异比较
 * - 工作区访问历史记录管理（最多保留 10 条）
 * - 工作区收藏夹（持久化存储）
 * - 文件内容安全读取（含路径遍历防护）
 *
 * 配置文件默认存储在用户主目录下的 ~/.ai-dev-workbench/ 中。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const constants_js_1 = require("../utils/constants.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/**
 * 将 Git porcelain 输出的双字符状态码映射为单一状态字母。
 *
 * Git status --porcelain 输出格式为 "XY filename"：
 * - X 列表示暂存区（index）状态
 * - Y 列表示工作区（working tree）状态
 *
 * 优先级规则：删除 > 添加 > 重命名 > 修改 > 未跟踪/忽略
 *
 * @param {string} x - 暂存区状态字符
 * @param {string} y - 工作区状态字符
 * @returns {GitChange['status']} 归一化后的单一状态码
 */
function gitStatusCode(x, y) {
    if (x === '?' && y === '?')
        return '?';
    if (x === '!' && y === '!')
        return '!';
    if (x === 'D' || y === 'D')
        return 'D';
    if (x === 'A' || y === 'A')
        return 'A';
    if (x === 'R' || y === 'R')
        return 'R';
    return 'M';
}
/**
 * 合并暂存区和工作区的 diff 输出，避免重复的文件头信息。
 *
 * 当两段 diff 都存在时，用换行符拼接；
 * 当其中一段为空时，直接返回另一段。
 *
 * @param {string} staged - 暂存区的 diff 输出
 * @param {string} unstaged - 工作区的 diff 输出
 * @returns {string} 合并后的完整 diff 内容
 */
function joinDiffs(staged, unstaged) {
    if (!staged)
        return unstaged;
    if (!unstaged)
        return staged;
    return staged + '\n' + unstaged;
}
/** 默认配置目录 */
const CONFIG_DIR = constants_js_1.APP_DATA_DIR;
/** 工作区历史记录最大保存条数 */
const MAX_HISTORY = 10;
/**
 * 项目类型检测映射表。
 * 根据工作区根目录下是否存在特定的配置文件来判断项目类型。
 * 检测顺序即为对象遍历顺序。
 *
 * @type {Record<string, WorkspaceInfo['projectType']>}
 */
const PROJECT_TYPE_MAP = {
    'package.json': 'node',
    'pom.xml': 'java',
    'build.gradle': 'java',
    'build.gradle.kts': 'java',
    'Cargo.toml': 'rust',
    'requirements.txt': 'python',
    'pyproject.toml': 'python',
    'go.mod': 'unknown',
};
/**
 * 需要扫描的上下文文件列表。
 * 这些文件通常包含项目的关键配置和元信息，
 * 用于在工作区选择阶段快速了解项目结构。
 *
 * @type {string[]}
 */
const CONTEXT_FILES = [
    '.claude.md',
    'package.json',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
    'Cargo.toml',
    'requirements.txt',
    'pyproject.toml',
    'tsconfig.json',
    '.gitignore',
    'Makefile',
    'Dockerfile',
];
/**
 * 工作区管理服务类
 *
 * 提供工作区的浏览、验证、选择、Git 操作、历史记录管理和收藏管理等功能。
 * 所有路径操作均使用绝对路径，确保跨平台一致性。
 *
 * @class WorkspaceService
 * @example
 * ```typescript
 * const service = new WorkspaceService();
 * const info = service.select('/path/to/project');
 * console.log(info.projectType); // 'node'
 * ```
 */
class WorkspaceService {
    /** 配置文件存储目录 */
    configDir;
    /** 工作区访问历史记录文件路径 */
    historyFile;
    /** 已保存工作区（收藏夹）文件路径 */
    savedWorkspacesFile;
    /**
     * 创建 WorkspaceService 实例
     * @param {string} [configDir] - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir) {
        this.configDir = configDir ?? CONFIG_DIR;
        this.historyFile = path_1.default.join(this.configDir, 'workspace-history.json');
        this.savedWorkspacesFile = path_1.default.join(this.configDir, 'saved-workspaces.json');
    }
    /**
     * 浏览指定目录，返回其包含的文件和子目录列表。
     *
     * 对每个条目尝试获取文件状态信息，若因权限不足等原因失败则跳过该条目。
     * 返回结果不进行排序，顺序取决于操作系统文件系统的返回顺序。
     *
     * @param {string} dirPath - 要浏览的目录路径
     * @returns {DirectoryEntry[]} 目录条目数组
     * @throws {Error} 目录不存在或路径不是目录时抛出异常
     */
    browse(dirPath) {
        const resolvedPath = path_1.default.resolve(dirPath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error(`Directory does not exist: ${resolvedPath}`);
        }
        const stat = fs_1.default.statSync(resolvedPath);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${resolvedPath}`);
        }
        const entries = fs_1.default.readdirSync(resolvedPath, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
            const entryPath = path_1.default.join(resolvedPath, entry.name);
            try {
                const entryStat = fs_1.default.statSync(entryPath);
                result.push({
                    name: entry.name,
                    path: entryPath,
                    isDirectory: entry.isDirectory(),
                    size: entry.isDirectory() ? undefined : entryStat.size,
                    modifiedAt: entryStat.mtime.toISOString(),
                });
            }
            catch {
                // 跳过因权限问题等无法读取状态的条目
            }
        }
        return result;
    }
    /**
     * 验证指定路径是否为有效的工作区目录。
     *
     * 检查内容包括：
     * 1. 路径是否存在
     * 2. 路径是否为目录
     * 3. 是否具有读权限
     * 4. 是否具有写权限
     *
     * @param {string} workspacePath - 待验证的工作区路径
     * @returns {WorkspaceValidationResult} 验证结果，包含是否有效及错误信息
     */
    validate(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        if (!fs_1.default.existsSync(resolvedPath)) {
            return { valid: false, error: 'Directory does not exist' };
        }
        let stat;
        try {
            stat = fs_1.default.statSync(resolvedPath);
        }
        catch {
            return { valid: false, error: 'Cannot access directory' };
        }
        if (!stat.isDirectory()) {
            return { valid: false, error: 'Path is not a directory' };
        }
        // 检查读权限
        try {
            fs_1.default.accessSync(resolvedPath, fs_1.default.constants.R_OK);
        }
        catch {
            return { valid: false, error: 'Directory is not readable' };
        }
        // 检查写权限
        try {
            fs_1.default.accessSync(resolvedPath, fs_1.default.constants.W_OK);
        }
        catch {
            return { valid: false, error: 'Directory is not writable' };
        }
        return { valid: true };
    }
    /**
     * 根据工作区中存在的配置文件自动检测项目类型。
     *
     * 检测规则基于 PROJECT_TYPE_MAP 映射表，按优先级匹配：
     * package.json -> Node.js, pom.xml -> Java, Cargo.toml -> Rust, requirements.txt -> Python。
     * 若无匹配项则返回 'unknown'。
     *
     * @private
     * @param {string} workspacePath - 工作区路径
     * @returns {WorkspaceInfo['projectType']} 检测到的项目类型
     */
    detectProjectType(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        for (const [filename, projectType] of Object.entries(PROJECT_TYPE_MAP)) {
            if (fs_1.default.existsSync(path_1.default.join(resolvedPath, filename))) {
                return projectType;
            }
        }
        return 'unknown';
    }
    /**
     * 扫描工作区根目录，查找 CONTEXT_FILES 中定义的上下文文件。
     *
     * @private
     * @param {string} workspacePath - 工作区路径
     * @returns {string[]} 找到的上下文文件名列表
     */
    scanContextFiles(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        const found = [];
        for (const filename of CONTEXT_FILES) {
            if (fs_1.default.existsSync(path_1.default.join(resolvedPath, filename))) {
                found.push(filename);
            }
        }
        return found;
    }
    /**
     * 选择并初始化一个工作区。
     *
     * 执行完整的初始化流程：
     * 1. 验证路径有效性
     * 2. 检测项目类型
     * 3. 扫描上下文文件
     * 4. 检查 .claude.md 是否存在
     * 5. 检测 Git 状态
     *
     * @param {string} workspacePath - 工作区路径
     * @returns {WorkspaceInfo} 工作区完整信息
     * @throws {Error} 路径验证失败时抛出异常
     */
    select(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        const validation = this.validate(resolvedPath);
        if (!validation.valid) {
            throw new Error(validation.error ?? 'Invalid workspace');
        }
        const projectType = this.detectProjectType(resolvedPath);
        const contextFiles = this.scanContextFiles(resolvedPath);
        const hasClaudeMd = fs_1.default.existsSync(path_1.default.join(resolvedPath, '.claude.md'));
        const gitStatus = this.detectGitStatus(resolvedPath);
        return {
            path: resolvedPath,
            projectType,
            contextFiles,
            hasClaudeMd,
            gitStatus,
        };
    }
    /**
     * 检测工作区的 Git 仓库状态（简易启发式检测）。
     *
     * 仅通过判断 .git 目录是否存在来区分 Git 仓库和非 Git 仓库。
     * 注意：此处不执行实际的 `git status` 命令，仅做轻量级检测。
     * 详细的 Git 状态（clean/dirty）需通过 gitStatus() 方法获取。
     *
     * @private
     * @param {string} workspacePath - 工作区路径
     * @returns {WorkspaceInfo['gitStatus']} Git 状态：'not_git' 或 'clean'
     */
    detectGitStatus(workspacePath) {
        const gitDir = path_1.default.join(workspacePath, '.git');
        if (!fs_1.default.existsSync(gitDir)) {
            return 'not_git';
        }
        return 'clean';
    }
    // ==================== Git 操作 ====================
    /**
     * 获取工作区的详细 Git 状态信息。
     *
     * 通过并行执行 `git branch --show-current` 和 `git status --porcelain` 命令，
     * 获取当前分支名称和所有文件变更状态。
     *
     * porcelain 格式的输出每行结构为 "XY filename"：
     * - X（第 1 列）：暂存区状态
     * - Y（第 2 列）：工作区状态
     * - 空格分隔后为文件路径
     *
     * @async
     * @param {string} workspacePath - 工作区路径
     * @returns {Promise<GitStatusResult>} Git 状态结果，包含分支名和变更列表
     */
    async gitStatus(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        const gitDir = path_1.default.join(resolvedPath, '.git');
        if (!fs_1.default.existsSync(gitDir)) {
            return { isGit: false, branch: '', changes: [] };
        }
        // 并行获取分支名和文件状态，减少等待时间
        const [branch, porcelain] = await Promise.all([
            this.execGit(resolvedPath, ['branch', '--show-current']),
            this.execGit(resolvedPath, ['status', '--porcelain', '-u']),
        ]);
        const changes = [];
        for (const line of porcelain.split('\n').filter(Boolean)) {
            const x = line[0]; // 暂存区状态
            const y = line[1]; // 工作区状态
            let filePath = line.slice(3);
            // Renamed 文件格式：XY old_path -> new_path，取新路径
            const renameArrow = filePath.indexOf(' -> ');
            if (renameArrow !== -1) {
                filePath = filePath.slice(renameArrow + 4);
            }
            // 去除引号（git 对含特殊字符的文件名会加引号）
            if (filePath.startsWith('"') && filePath.endsWith('"')) {
                filePath = filePath.slice(1, -1);
            }
            // 跳过目录条目（git status 不会返回纯目录，但防御性检查）
            // 如果路径不以文件名结尾（即目录），检查文件系统中是否存在
            const fullPath = path_1.default.join(resolvedPath, filePath);
            try {
                const stat = fs_1.default.statSync(fullPath);
                if (stat.isDirectory())
                    continue;
            }
            catch {
                // 文件不存在（可能是已删除文件），仍然显示
            }
            // 将双字符状态码归一化为单一状态字母
            const status = gitStatusCode(x, y);
            // X 列非空且非 '?' 表示该文件已被暂存
            const staged = x !== ' ' && x !== '?';
            changes.push({ path: filePath, status, staged });
        }
        return { isGit: true, branch: branch.trim(), changes };
    }
    /**
     * 获取指定文件或整个工作树的 unified diff 差异内容。
     *
     * 对于未跟踪文件（untracked），会读取文件内容并生成模拟的 diff 输出，
     * 表现为从 /dev/null 新增的纯添加内容。
     * 对于已跟踪文件，合并暂存区和工作区的差异，暂存区差异优先显示。
     *
     * @async
     * @param {string} workspacePath - 工作区路径
     * @param {string} [filePath] - 可选的指定文件路径；不传则返回整个工作树的差异
     * @returns {Promise<GitDiffResult>} 差异结果，包含 diff 内容及增删行数统计
     */
    async gitDiff(workspacePath, filePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        let diff = '';
        if (filePath) {
            // 检查文件是否为未跟踪状态
            const statusLine = await this.execGit(resolvedPath, ['status', '--porcelain', '--', filePath]).catch(() => '');
            if (statusLine.startsWith('??')) {
                // 未跟踪文件：读取文件内容，生成模拟的纯新增 diff
                const fullPath = path_1.default.join(resolvedPath, filePath);
                try {
                    const content = fs_1.default.readFileSync(fullPath, 'utf-8');
                    const lines = content.split('\n');
                    diff = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
                    for (const line of lines) {
                        diff += `+${line}\n`;
                    }
                }
                catch {
                    diff = '';
                }
            }
            else {
                // 已跟踪文件：并行获取暂存区和工作区的 diff，然后合并
                const [unstaged, staged] = await Promise.all([
                    this.execGit(resolvedPath, ['diff', '--', filePath]).catch(() => ''),
                    this.execGit(resolvedPath, ['diff', '--cached', '--', filePath]).catch(() => ''),
                ]);
                diff = joinDiffs(staged, unstaged);
            }
        }
        else {
            // 整个工作树：并行获取暂存区和工作区的 diff
            const [unstaged, staged] = await Promise.all([
                this.execGit(resolvedPath, ['diff']).catch(() => ''),
                this.execGit(resolvedPath, ['diff', '--cached']).catch(() => ''),
            ]);
            diff = joinDiffs(staged, unstaged);
        }
        // 统计新增行数和删除行数（排除 diff 文件头行）
        let additions = 0;
        let deletions = 0;
        for (const line of diff.split('\n')) {
            if (line.startsWith('+') && !line.startsWith('+++'))
                additions++;
            if (line.startsWith('-') && !line.startsWith('---'))
                deletions++;
        }
        return { path: filePath || '', diff, additions, deletions };
    }
    // ==================== Git 分支操作 ====================
    async gitBranchList(workspacePath) {
        const cwd = path_1.default.resolve(workspacePath);
        const output = await this.execGit(cwd, ['branch', '--list', '--format=%(refname:short)']);
        const current = (await this.execGit(cwd, ['branch', '--show-current'])).trim();
        const branches = output.trim().split('\n')
            .map(name => name.trim())
            .filter(Boolean)
            .map(name => ({ name, current: name === current }));
        return { branches, current };
    }
    async gitCheckout(workspacePath, branch) {
        const cwd = path_1.default.resolve(workspacePath);
        try {
            await this.execGit(cwd, ['checkout', '--quiet', branch]);
            return { success: true, branch };
        }
        catch (err) {
            const msg = (0, error_utils_js_1.getErrorMessage)(err) || '';
            const files = [];
            const m = msg.match(/would be overwritten by merge:\s*([\s\S]*?)\n/i);
            if (m) {
                m[1].split('\n').forEach(f => { const t = f.trim(); if (t)
                    files.push(t); });
            }
            if (files.length === 0) {
                try {
                    const s = await this.gitStatus(workspacePath);
                    files.push(...s.changes.map(c => c.path));
                }
                catch { /* */ }
            }
            return { success: false, branch, conflicts: files.length > 0 ? files : undefined, message: msg.split('\n')[0] };
        }
    }
    async gitStash(workspacePath, message) {
        const cwd = path_1.default.resolve(workspacePath);
        const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
        try {
            const output = await this.execGit(cwd, args);
            return { success: true, message: output.trim() || 'Stashed' };
        }
        catch (err) {
            return { success: false, message: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    async gitStashPop(workspacePath) {
        const cwd = path_1.default.resolve(workspacePath);
        try {
            const output = await this.execGit(cwd, ['stash', 'pop']);
            return { success: true, branch: '', message: output.trim() };
        }
        catch (err) {
            const msg = (0, error_utils_js_1.getErrorMessage)(err) || '';
            const conflicts = [];
            const m = msg.match(/Merge conflict in (.+)/g);
            if (m)
                m.forEach(x => { const f = x.replace('Merge conflict in ', '').trim(); if (f)
                    conflicts.push(f); });
            return { success: conflicts.length === 0, branch: '', conflicts: conflicts.length > 0 ? conflicts : undefined, message: msg };
        }
    }
    async gitCheckoutForce(workspacePath, branch) {
        const cwd = path_1.default.resolve(workspacePath);
        try {
            await this.execGit(cwd, ['checkout', '-f', branch]);
            return { success: true, branch };
        }
        catch (err) {
            return { success: false, branch, message: (0, error_utils_js_1.getErrorMessage)(err) };
        }
    }
    async gitMergeBranch(workspacePath, sourceBranch) {
        const cwd = path_1.default.resolve(workspacePath);
        try {
            const output = await this.execGit(cwd, ['merge', sourceBranch]);
            return { success: true, branch: sourceBranch, message: output.trim() };
        }
        catch (err) {
            const msg = (0, error_utils_js_1.getErrorMessage)(err) || '';
            const conflicts = [];
            const m = msg.match(/CONFLICT \(.*\): Merge conflict in (.+)/g);
            if (m)
                m.forEach(x => { const f = x.replace(/.*Merge conflict in /, '').trim(); if (f)
                    conflicts.push(f); });
            return {
                success: false, branch: sourceBranch, conflicts: conflicts.length > 0 ? conflicts : undefined,
                message: msg.split('\n').find((l) => l.includes('CONFLICT')) || msg.split('\n')[0],
            };
        }
    }
    async gitConflictDiff(workspacePath, filePath) {
        const cwd = path_1.default.resolve(workspacePath);
        const fullPath = path_1.default.join(cwd, filePath);
        if (!fs_1.default.existsSync(fullPath))
            return '';
        return fs_1.default.readFileSync(fullPath, 'utf-8');
    }
    /**
     * 执行 Git 命令并返回标准输出内容。
     *
     * 通过 child_process.spawn 启动 git 子进程，捕获 stdout 和 stderr。
     * 退出码为 0 表示命令成功执行，退出码为 1 在 diff 命令中表示存在差异
     * （这是 git diff 的正常行为，不视为错误），其他退出码视为失败。
     *
     * @private
     * @async
     * @param {string} cwd - Git 命令的工作目录
     * @param {string[]} args - 传递给 git 的参数数组
     * @returns {Promise<string>} git 命令的标准输出内容
     * @throws {Error} 命令执行失败时抛出异常，包含 stderr 或退出码信息
     */
    execGit(cwd, args) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d) => {
                stdout += d.toString();
            });
            child.stderr.on('data', (d) => {
                stderr += d.toString();
            });
            child.on('close', (code) => {
                // code=0: 命令执行成功; code=1: diff 命令检测到差异（非错误）
                if (code === 0 || code === 1)
                    resolve(stdout);
                else
                    reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`));
            });
            child.on('error', (err) => reject(err));
        });
    }
    // ==================== 历史记录管理 ====================
    /**
     * 获取工作区访问历史记录。
     *
     * 历史记录按最近访问时间降序排列（最新在前）。
     * 最多返回 MAX_HISTORY（10）条记录。
     * 若历史文件不存在或内容格式异常，返回空数组。
     *
     * @returns {string[]} 历史记录中的工作区绝对路径数组
     */
    getHistory() {
        if (!fs_1.default.existsSync(this.historyFile)) {
            return [];
        }
        try {
            const raw = fs_1.default.readFileSync(this.historyFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            // 类型守卫：过滤掉非字符串元素，确保返回值类型安全
            return parsed.filter((item) => typeof item === 'string');
        }
        catch {
            return [];
        }
    }
    /**
     * 将工作区路径添加到访问历史记录中。
     *
     * 处理逻辑：
     * 1. 去重：若路径已存在则先移除旧记录
     * 2. 置顶：将路径插入到列表最前面（最新访问）
     * 3. 截断：超过 MAX_HISTORY 条时裁剪末尾的旧记录
     * 4. 持久化：将更新后的历史写入 JSON 文件
     *
     * @param {string} workspacePath - 要添加的工作区路径
     */
    addToHistory(workspacePath) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        let history = this.getHistory();
        // 去重：移除已有的相同路径记录
        history = history.filter(p => p !== resolvedPath);
        // 将新记录插入到列表头部（最近访问排在最前）
        history.unshift(resolvedPath);
        // 限制最大条数，保留最新的记录
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }
        // 确保配置目录存在
        if (!fs_1.default.existsSync(this.configDir)) {
            fs_1.default.mkdirSync(this.configDir, { recursive: true });
        }
        fs_1.default.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf-8');
    }
    /**
     * 检查目标路径是否在工作区边界内。
     *
     * 这是一项安全措施，用于防止路径遍历攻击（Path Traversal）。
     * 例如，攻击者可能使用 "../../etc/passwd" 等方式尝试访问工作区之外的文件。
     *
     * @private
     * @param {string} workspacePath - 工作区根路径
     * @param {string} targetPath - 待检查的目标路径（可以是绝对路径或相对路径）
     * @returns {boolean} 目标路径是否在工作区范围内
     */
    isWithinWorkspace(workspacePath, targetPath) {
        const resolvedWorkspace = path_1.default.resolve(workspacePath);
        const resolvedTarget = path_1.default.resolve(workspacePath, targetPath);
        // 目标路径与工作区路径完全相同也视为在范围内
        if (resolvedTarget === resolvedWorkspace) {
            return true;
        }
        // 目标路径必须以工作区路径加上路径分隔符为前缀
        return resolvedTarget.startsWith(resolvedWorkspace + path_1.default.sep);
    }
    // ==================== 已保存工作区（收藏夹）管理 ====================
    /**
     * 从持久化存储中加载已保存的工作区列表。
     *
     * @private
     * @returns {SavedWorkspace[]} 已保存的工作区数组；文件不存在或解析失败时返回空数组
     */
    loadSavedWorkspaces() {
        if (!fs_1.default.existsSync(this.savedWorkspacesFile))
            return [];
        try {
            const raw = fs_1.default.readFileSync(this.savedWorkspacesFile, 'utf-8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    /**
     * 将已保存的工作区列表持久化写入文件。
     *
     * @private
     * @param {SavedWorkspace[]} workspaces - 要保存的工作区数组
     */
    saveSavedWorkspaces(workspaces) {
        if (!fs_1.default.existsSync(this.configDir)) {
            fs_1.default.mkdirSync(this.configDir, { recursive: true });
        }
        fs_1.default.writeFileSync(this.savedWorkspacesFile, JSON.stringify(workspaces, null, 2), 'utf-8');
    }
    /**
     * 获取所有已保存（收藏）的工作区列表。
     *
     * @returns {SavedWorkspace[]} 已保存的工作区数组
     */
    listSavedWorkspaces() {
        return this.loadSavedWorkspaces();
    }
    /**
     * 添加一个新的工作区到收藏夹。
     *
     * 流程：
     * 1. 验证路径有效性
     * 2. 去重检查：若路径已收藏则直接返回已有记录
     * 3. 检测项目类型
     * 4. 生成显示名称（优先使用用户提供的名称，否则取路径末段目录名）
     * 5. 持久化存储
     *
     * @param {string} workspacePath - 工作区路径
     * @param {string} [name] - 可选的自定义显示名称
     * @returns {SavedWorkspace} 新创建或已存在的已保存工作区记录
     * @throws {Error} 路径验证失败时抛出异常
     */
    addSavedWorkspace(workspacePath, name) {
        const resolvedPath = path_1.default.resolve(workspacePath);
        const validation = this.validate(resolvedPath);
        if (!validation.valid) {
            throw new Error(validation.error ?? 'Invalid workspace path');
        }
        const workspaces = this.loadSavedWorkspaces();
        // 去重检查：路径已存在则直接返回
        const existing = workspaces.find(w => w.path === resolvedPath);
        if (existing)
            return existing;
        const projectType = this.detectProjectType(resolvedPath);
        // 若未提供名称，则取路径最后一段作为显示名称
        const displayName = name || resolvedPath.split(path_1.default.sep).pop() || resolvedPath;
        const saved = {
            id: `ws-${Date.now()}`, // 使用时间戳生成唯一 ID
            path: resolvedPath,
            name: displayName,
            projectType,
            addedAt: new Date().toISOString(),
        };
        workspaces.push(saved);
        this.saveSavedWorkspaces(workspaces);
        return saved;
    }
    /**
     * 从收藏夹中移除指定的工作区。
     *
     * @param {string} id - 工作区的唯一标识符
     * @returns {boolean} 是否成功移除（false 表示未找到对应的工作区记录）
     */
    removeSavedWorkspace(id) {
        const workspaces = this.loadSavedWorkspaces();
        const idx = workspaces.findIndex(w => w.id === id);
        if (idx < 0)
            return false;
        workspaces.splice(idx, 1);
        this.saveSavedWorkspaces(workspaces);
        return true;
    }
    /**
     * 更新已保存工作区的显示名称。
     *
     * @param {string} id - 工作区的唯一标识符
     * @param {string} name - 新的显示名称
     * @returns {SavedWorkspace|undefined} 更新后的工作区记录；未找到时返回 undefined
     */
    updateSavedWorkspaceName(id, name) {
        const workspaces = this.loadSavedWorkspaces();
        const ws = workspaces.find(w => w.id === id);
        if (!ws)
            return undefined;
        ws.name = name;
        this.saveSavedWorkspaces(workspaces);
        return ws;
    }
    // ==================== 文件内容读取 ====================
    /**
     * 安全地读取工作区内的文件内容。
     *
     * 安全措施：
     * - 路径遍历防护：通过 isWithinWorkspace 确保文件在工作区范围内
     * - 文件大小限制：超过 1MB 的文件返回提示信息而非完整内容
     * - 二进制文件检测：根据扩展名识别二进制文件并返回标识信息
     * - 编码错误处理：UTF-8 解码失败时返回错误提示
     *
     * @param {string} filePath - 文件路径（绝对路径）
     * @param {string} workspacePath - 工作区根路径（用于安全边界检查）
     * @returns {{ content: string; encoding: 'text'|'binary'; size: number }} 文件读取结果：
     *   - content: 文件内容或状态提示文本
     *   - encoding: 'text' 表示文本文件，'binary' 表示二进制文件
     *   - size: 文件大小（字节）
     * @throws {Error} 文件在工作区外、不存在、或是目录时抛出异常
     */
    readFileContent(filePath, workspacePath) {
        const resolvedPath = path_1.default.resolve(filePath);
        // 安全检查：确保目标文件在工作区边界内，防止路径遍历攻击
        if (!this.isWithinWorkspace(workspacePath, resolvedPath)) {
            throw new Error('Access denied: file is outside workspace');
        }
        if (!fs_1.default.existsSync(resolvedPath)) {
            throw new Error('File not found');
        }
        const stat = fs_1.default.statSync(resolvedPath);
        if (stat.isDirectory()) {
            throw new Error('Path is a directory, not a file');
        }
        // 文件预览大小限制：1MB
        const MAX_SIZE = 1024 * 1024;
        if (stat.size > MAX_SIZE) {
            return {
                content: `[File too large to preview: ${(stat.size / 1024).toFixed(1)}KB]`,
                encoding: 'text',
                size: stat.size,
            };
        }
        // 根据扩展名检测二进制文件
        const binaryExtensions = new Set([
            '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
            '.pdf', '.zip', '.tar', '.gz', '.jar', '.war', '.class',
            '.exe', '.dll', '.so', '.dylib',
        ]);
        const ext = path_1.default.extname(resolvedPath).toLowerCase();
        if (binaryExtensions.has(ext)) {
            return { content: `[Binary file: ${ext}]`, encoding: 'binary', size: stat.size };
        }
        try {
            const content = fs_1.default.readFileSync(resolvedPath, 'utf-8');
            return { content, encoding: 'text', size: stat.size };
        }
        catch {
            // UTF-8 解码失败时返回错误提示（可能是其他编码的二进制文件）
            return { content: '[Cannot read file: encoding error]', encoding: 'binary', size: stat.size };
        }
    }
    // ==================== 任务分支管理 ====================
    /**
     * 为任务创建独立的 Git 分支。
     *
     * 流程：stash 未提交改动 → checkout 基础分支 → 创建新分支
     *
     * @param {string} workspacePath - 工作区路径
     * @param {string} baseBranch - 基础分支名（如 main）
     * @param {string} taskName - 任务名称（用于生成分支名）
     * @returns {Promise<string>} 新创建的分支名
     */
    /**
     * 为任务创建分支（在项目目录内操作）
     *
     * 1. stash 当前改动
     * 2. checkout baseBranch
     * 3. 创建新分支 task/{name}-{id}
     * 4. 返回分支名（worktreePath 等于 workspacePath）
     *
     * @param {string} workspacePath - 原始仓库路径
     * @param {string} baseBranch - 基础分支名
     * @param {string} taskName - 任务名称
     * @returns {Promise<{branch: string, worktreePath: string}>}
     */
    async createTaskBranch(workspacePath, baseBranch, taskName) {
        const sanitized = taskName
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 40);
        const shortId = crypto_1.default.randomBytes(3).toString('hex');
        const branchName = `task/${sanitized}-${shortId}`;
        const cwd = path_1.default.resolve(workspacePath);
        // stash 当前改动（忽略失败）
        try {
            await this.execGit(cwd, ['stash', 'push', '-m', `auto-stash before ${branchName}`]);
        }
        catch { /* */ }
        // checkout 基础分支
        await this.execGit(cwd, ['checkout', '--quiet', baseBranch]);
        // 创建新分支
        await this.execGit(cwd, ['checkout', '-b', branchName]);
        // worktreePath 等于 workspacePath（项目内操作）
        return { branch: branchName, worktreePath: workspacePath };
    }
    /**
     * 任务完成后 stash 代码（按需求号标记）
     *
     * @param {string} workspacePath - 仓库路径
     * @param {string} requirementId - 需求ID
     */
    async stashTaskChanges(workspacePath, requirementId) {
        const cwd = path_1.default.resolve(workspacePath);
        // 先 add 所有改动
        try {
            await this.execGit(cwd, ['add', '-A']);
        }
        catch { /* */ }
        // stash
        try {
            await this.execGit(cwd, ['stash', 'push', '-m', `req-${requirementId}`]);
        }
        catch { /* 可能没有改动 */ }
    }
    /**
     * 将任务分支合并回基础分支（用于依赖任务链）
     *
     * @param {string} workspacePath - 仓库路径
     * @param {string} branch - 任务分支名
     * @param {string} baseBranch - 目标基础分支
     */
    async mergeBranchToBase(workspacePath, branch, baseBranch) {
        const cwd = path_1.default.resolve(workspacePath);
        await this.execGit(cwd, ['checkout', '--quiet', baseBranch]);
        try {
            await this.execGit(cwd, ['merge', '--no-ff', branch, '-m', `Merge task branch ${branch}`]);
        }
        catch (err) {
            try {
                await this.execGit(cwd, ['merge', '--abort']);
            }
            catch { /* */ }
            throw new Error(`Merge conflict: ${branch} → ${baseBranch}. ${err instanceof Error ? err.message : ''}`);
        }
    }
    /**
     * 删除任务分支
     */
    async removeTaskBranch(workspacePath, baseBranch, branch) {
        const cwd = path_1.default.resolve(workspacePath);
        try {
            await this.execGit(cwd, ['checkout', '--quiet', baseBranch]);
        }
        catch { /* */ }
        try {
            await this.execGit(cwd, ['branch', '-D', branch]);
        }
        catch { /* */ }
    }
    /**
     * 列出所有任务分支（以 task/ 前缀开头的分支）
     *
     * @param {string} workspacePath - 工作区路径
     * @returns {Promise<GitBranch[]>} 任务分支列表
     */
    async listTaskBranches(workspacePath) {
        const result = await this.gitBranchList(workspacePath);
        return result.branches.filter(b => b.name.startsWith('task/'));
    }
    /**
     * 列出远程分支（去重，去掉 remote 前缀）
     *
     * @param {string} workspacePath - 工作区路径
     * @returns {Promise<string[]>} 远程分支名列表（如 main, develop, feature-x）
     */
    async listRemoteBranches(workspacePath) {
        const cwd = path_1.default.resolve(workspacePath);
        // 先 fetch 保证最新
        try {
            await this.execGit(cwd, ['fetch', '--quiet']);
        }
        catch { /* no remote */ }
        const output = await this.execGit(cwd, ['branch', '-r', '--format=%(refname:short)']);
        const seen = new Set();
        return output.trim().split('\n')
            .map(line => line.trim().replace(/^[^/]+\//, '')) // origin/main → main
            .filter(name => name && !name.startsWith('HEAD') && !seen.has(name) && seen.add(name));
    }
}
exports.WorkspaceService = WorkspaceService;
//# sourceMappingURL=workspace-service.js.map