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
/**
 * 工作区基本信息
 * @interface WorkspaceInfo
 * @property {string} path - 工作区的绝对路径
 * @property {'node'|'python'|'java'|'rust'|'unknown'} projectType - 检测到的项目类型
 * @property {string[]} contextFiles - 工作区中发现的上下文文件列表
 * @property {boolean} hasClaudeMd - 工作区根目录是否包含 .claude.md 文件
 * @property {'clean'|'dirty'|'not_git'} gitStatus - Git 仓库状态：
 *   - clean: Git 仓库且无未提交更改
 *   - dirty: Git 仓库但存在未提交更改
 *   - not_git: 非 Git 仓库
 */
export interface WorkspaceInfo {
    path: string;
    projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
    contextFiles: string[];
    hasClaudeMd: boolean;
    gitStatus: 'clean' | 'dirty' | 'not_git';
}
/**
 * 已保存（收藏）的工作区信息
 * @interface SavedWorkspace
 * @property {string} id - 工作区的唯一标识符（格式: ws-{timestamp}）
 * @property {string} path - 工作区的绝对路径
 * @property {string} name - 用户自定义的显示名称（默认取目录名）
 * @property {'node'|'python'|'java'|'rust'|'unknown'} projectType - 项目类型
 * @property {string} addedAt - 收藏时间（ISO 8601 格式）
 */
export interface SavedWorkspace {
    id: string;
    path: string;
    name: string;
    projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
    addedAt: string;
    /** 多任务配置：基础分支（默认 main） */
    baseBranch?: string;
    /** 多任务配置：默认流水线 ID */
    defaultPipelineId?: string;
}
/**
 * 目录条目信息
 * @interface DirectoryEntry
 * @property {string} name - 文件或目录名称
 * @property {string} path - 完整的绝对路径
 * @property {boolean} isDirectory - 是否为目录
 * @property {number|undefined} size - 文件大小（字节），目录时为 undefined
 * @property {string} modifiedAt - 最后修改时间（ISO 8601 格式）
 * @property {string|undefined} extension - 文件扩展名（含点号），目录时为 undefined
 */
export interface DirectoryEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    modifiedAt: string;
    extension?: string;
}
/**
 * 工作区路径验证结果
 * @interface WorkspaceValidationResult
 * @property {boolean} valid - 路径是否为有效的工作区目录
 * @property {string|undefined} error - 验证失败时的错误描述信息
 */
export interface WorkspaceValidationResult {
    valid: boolean;
    error?: string;
}
/**
 * Git 文件变更状态码
 * - M: Modified（已修改）
 * - A: Added（已添加）
 * - D: Deleted（已删除）
 * - R: Renamed（已重命名）
 * - ?: Untracked（未跟踪）
 * - !: Ignored（被忽略）
 */
export interface GitChange {
    path: string;
    status: 'M' | 'A' | 'D' | 'R' | '?' | '!';
    staged: boolean;
}
/**
 * Git 状态查询结果
 * @interface GitStatusResult
 * @property {boolean} isGit - 当前路径是否为 Git 仓库
 * @property {string} branch - 当前分支名称（非 Git 仓库时为空字符串）
 * @property {GitChange[]} changes - 文件变更列表
 */
export interface GitStatusResult {
    isGit: boolean;
    branch: string;
    changes: GitChange[];
}
/**
 * Git 差异比较结果
 * @interface GitDiffResult
 * @property {string} path - 文件路径（查询整个工作树时为空字符串）
 * @property {string} diff - unified diff 格式的差异内容
 * @property {number} additions - 新增行数
 * @property {number} deletions - 删除行数
 */
export interface GitDiffResult {
    path: string;
    diff: string;
    additions: number;
    deletions: number;
}
/** Git 分支信息 */
export interface GitBranch {
    name: string;
    current: boolean;
}
/** 分支列表查询结果 */
export interface GitBranchListResult {
    branches: GitBranch[];
    current: string;
}
/** 切换/合并分支操作结果 */
export interface GitCheckoutResult {
    success: boolean;
    branch: string;
    conflicts?: string[];
    message?: string;
}
/** Stash 操作结果 */
export interface GitStashResult {
    success: boolean;
    message: string;
}
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
export declare class WorkspaceService {
    /** 配置文件存储目录 */
    private configDir;
    /** 工作区访问历史记录文件路径 */
    private historyFile;
    /** 已保存工作区（收藏夹）文件路径 */
    private savedWorkspacesFile;
    /**
     * 创建 WorkspaceService 实例
     * @param {string} [configDir] - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir?: string);
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
    browse(dirPath: string): DirectoryEntry[];
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
    validate(workspacePath: string): WorkspaceValidationResult;
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
    private detectProjectType;
    /**
     * 扫描工作区根目录，查找 CONTEXT_FILES 中定义的上下文文件。
     *
     * @private
     * @param {string} workspacePath - 工作区路径
     * @returns {string[]} 找到的上下文文件名列表
     */
    private scanContextFiles;
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
    select(workspacePath: string): WorkspaceInfo;
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
    private detectGitStatus;
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
    gitStatus(workspacePath: string): Promise<GitStatusResult>;
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
    gitDiff(workspacePath: string, filePath?: string): Promise<GitDiffResult>;
    /**
     * 获取工作区中的 git 变更文件列表。
     * 包含已跟踪文件的修改/删除、已暂存文件、未跟踪的新文件。
     *
     * @param workspacePath - 工作区路径
     * @returns 变更文件相对路径列表（无 git 仓库时返回空数组）
     */
    getChangedFiles(workspacePath: string): Promise<string[]>;
    gitBranchList(workspacePath: string): Promise<GitBranchListResult>;
    gitCheckout(workspacePath: string, branch: string): Promise<GitCheckoutResult>;
    gitStash(workspacePath: string, message?: string): Promise<GitStashResult>;
    gitStashPop(workspacePath: string): Promise<GitCheckoutResult>;
    gitCheckoutForce(workspacePath: string, branch: string): Promise<GitCheckoutResult>;
    gitMergeBranch(workspacePath: string, sourceBranch: string): Promise<GitCheckoutResult>;
    gitConflictDiff(workspacePath: string, filePath: string): Promise<string>;
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
    private execGit;
    /**
     * 获取工作区访问历史记录。
     *
     * 历史记录按最近访问时间降序排列（最新在前）。
     * 最多返回 MAX_HISTORY（10）条记录。
     * 若历史文件不存在或内容格式异常，返回空数组。
     *
     * @returns {string[]} 历史记录中的工作区绝对路径数组
     */
    getHistory(): string[];
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
    addToHistory(workspacePath: string): void;
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
    private isWithinWorkspace;
    /**
     * 从持久化存储中加载已保存的工作区列表。
     *
     * @private
     * @returns {SavedWorkspace[]} 已保存的工作区数组；文件不存在或解析失败时返回空数组
     */
    private loadSavedWorkspaces;
    /**
     * 将已保存的工作区列表持久化写入文件。
     *
     * @private
     * @param {SavedWorkspace[]} workspaces - 要保存的工作区数组
     */
    private saveSavedWorkspaces;
    /**
     * 获取所有已保存（收藏）的工作区列表。
     *
     * @returns {SavedWorkspace[]} 已保存的工作区数组
     */
    listSavedWorkspaces(): SavedWorkspace[];
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
    addSavedWorkspace(workspacePath: string, name?: string): SavedWorkspace;
    /**
     * 从收藏夹中移除指定的工作区。
     *
     * @param {string} id - 工作区的唯一标识符
     * @returns {boolean} 是否成功移除（false 表示未找到对应的工作区记录）
     */
    removeSavedWorkspace(id: string): boolean;
    /**
     * 更新已保存工作区的显示名称。
     *
     * @param {string} id - 工作区的唯一标识符
     * @param {string} name - 新的显示名称
     * @returns {SavedWorkspace|undefined} 更新后的工作区记录；未找到时返回 undefined
     */
    updateSavedWorkspaceName(id: string, name: string): SavedWorkspace | undefined;
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
    readFileContent(filePath: string, workspacePath: string): {
        content: string;
        encoding: 'text' | 'binary';
        size: number;
    };
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
    createTaskBranch(workspacePath: string, baseBranch: string, taskName: string): Promise<{
        branch: string;
        worktreePath: string;
    }>;
    /**
     * 任务完成后 stash 代码（按需求号标记）
     *
     * @param {string} workspacePath - 仓库路径
     * @param {string} requirementId - 需求ID
     */
    stashTaskChanges(workspacePath: string, requirementId: string): Promise<void>;
    /**
     * 将任务分支合并回基础分支（用于依赖任务链）
     *
     * @param {string} workspacePath - 仓库路径
     * @param {string} branch - 任务分支名
     * @param {string} baseBranch - 目标基础分支
     */
    mergeBranchToBase(workspacePath: string, branch: string, baseBranch: string): Promise<void>;
    /**
     * 删除任务分支
     */
    removeTaskBranch(workspacePath: string, baseBranch: string, branch: string): Promise<void>;
    /**
     * 列出所有任务分支（以 task/ 前缀开头的分支）
     *
     * @param {string} workspacePath - 工作区路径
     * @returns {Promise<GitBranch[]>} 任务分支列表
     */
    listTaskBranches(workspacePath: string): Promise<GitBranch[]>;
    /**
     * 列出远程分支（去重，去掉 remote 前缀）
     *
     * @param {string} workspacePath - 工作区路径
     * @returns {Promise<string[]>} 远程分支名列表（如 main, develop, feature-x）
     */
    listRemoteBranches(workspacePath: string): Promise<string[]>;
}
//# sourceMappingURL=workspace-service.d.ts.map