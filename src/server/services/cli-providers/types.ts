/**
 * @module cli-providers/types
 * @description CLI Provider 统一接口定义
 *
 * 定义了 CLI Provider 的抽象接口，支持 Claude Code 和 OpenAI Codex 两种 CLI 后端。
 * 所有 Provider 必须实现此接口，由 CLIRunnerService 作为 facade 代理调用。
 */

/**
 * CLI Provider 统一接口
 * @description 所有 CLI 后端必须实现的抽象契约
 */
export interface CLIProvider {
    /** Provider 唯一标识 */
    readonly id: 'claude' | 'codex';
    /** 显示名称 */
    readonly label: string;

    /**
     * 检测本地是否安装了此 CLI
     * @returns 检测结果（是否可用、版本号、安装路径等）
     */
    detect(): Promise<CLIProviderStatus>;

    /**
     * 初始化连接（用户选择后调用）
     * @description 启动必要的子进程或客户端连接
     */
    initialize(): Promise<void>;

    /**
     * 执行一次对话，支持流式输出
     * @param input - 对话输入参数
     * @param options - 运行选项（回调、中止信号等）
     * @returns 执行结果
     */
    run(input: CLIProviderInput, options?: CLIProviderOptions): Promise<CLIProviderResult>;

    /**
     * 读取此 CLI 的 skills 配置
     * @returns skill 信息列表
     */
    loadSkills(): Promise<SkillInfo[]>;

    /**
     * 读取此 CLI 的 MCP 服务器配置
     * @returns MCP 服务器配置列表
     */
    loadMcpServers(): Promise<McpServerInfo[]>;

    /**
     * 释放资源（杀子进程、关闭连接等）
     */
    dispose(): Promise<void>;
}

/**
 * CLI Provider 可用性状态
 */
export interface CLIProviderStatus {
    /** 是否可用 */
    available: boolean;
    /** 版本号 */
    version?: string;
    /** 安装路径 */
    path?: string;
    /** 不可用时的错误信息 */
    error?: string;
}

/**
 * CLI Provider 对话输入
 */
export interface CLIProviderInput {
    /** 提示词 */
    prompt: string;
    /** 工作目录 */
    cwd?: string;
    /** 会话 ID（用于续接已有会话） */
    sessionId?: string;
    /** 最大对话轮次 */
    maxTurns?: number;
    /** 技能列表 */
    skills?: string[] | 'all';
}

/**
 * CLI Provider 运行选项
 */
export interface CLIProviderOptions {
    /** 工作区路径 */
    workspacePath?: string;
    /** 中止信号 */
    signal?: AbortSignal;
    /** 实时输出回调 */
    onOutput?: (data: string) => void;
    /** 错误输出回调 */
    onError?: (data: string) => void;
}

/**
 * CLI Provider 执行结果
 */
export interface CLIProviderResult {
    /** 进程退出码 */
    exitCode: number | null;
    /** 标准输出 */
    stdout: string;
    /** 标准错误 */
    stderr?: string;
    /** 会话 ID（用于后续续接） */
    sessionId?: string;
    /** 是否被中止 */
    aborted?: boolean;
}

/**
 * Skill 信息摘要
 */
export interface SkillInfo {
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description: string;
    /** 是否启用 */
    enabled: boolean;
    /** 文件路径 */
    filePath: string;
}

/**
 * MCP 服务器信息摘要
 */
export interface McpServerInfo {
    /** 服务器名称 */
    name: string;
    /** 运行时类型 */
    type: string;
    /** 启动命令 */
    command: string;
    /** 是否启用 */
    enabled: boolean;
    /** 连接状态 */
    status?: 'connected' | 'disconnected' | 'error';
}
