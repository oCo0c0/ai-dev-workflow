/**
 * @module cli-providers/types
 * @description CLI Provider 统一接口定义
 *
 * 定义了 CLI Provider 的抽象接口，支持 Claude Code 和 OpenAI Codex 两种 CLI 后端。
 * 所有 Provider 必须实现此接口，由 CLIRunnerService 作为 facade 代理调用。
 */

/**
 * CLI Provider 能力声明
 * @description 声明 Provider 支持哪些可选能力。调用方应根据此声明决定是否传递对应参数，
 *              前端根据此声明决定是否显示对应 UI 控件。
 */
export interface CLIProviderCapabilities {
    /** 是否支持工具权限确认（canUseTool 回调） */
    supportsPermission: boolean;
    /** 是否支持运行时动态注入技能（run() 的 input.skills 参数） */
    supportsRuntimeSkills: boolean;
    /** 是否支持运行时动态注入 MCP 服务器（run() 的 input.mcpServers 参数） */
    supportsRuntimeMcp: boolean;
    /** 是否支持最大对话轮次限制（input.maxTurns） */
    supportsMaxTurns: boolean;
    /** 是否支持推理强度配置（options.reasoningEffort） */
    supportsReasoningEffort: boolean;
    /** 是否支持扩展思考（options.extendedThinking） */
    supportsExtendedThinking: boolean;
}

/**
 * CLI Provider 统一接口
 * @description 所有 CLI 后端必须实现的抽象契约
 */
export interface CLIProvider {
    /** Provider 能力声明 */
    readonly capabilities: CLIProviderCapabilities;
    /** Provider 唯一标识 */
    readonly id: 'claude' | 'codex' | 'pi';
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

    /**
     * 反向写回工具权限决策，唤醒挂起的 canUseTool（仅 Claude 实现真正逻辑）
     * @param modifiedInput - 可选，修改工具输入（如 AskUserQuestion 的用户答案）
     */
    confirmPermission(permissionRequestId: string, decision: 'allow' | 'deny', message?: string, modifiedInput?: Record<string, unknown>): void;
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
    /** Provider 特定的元数据 */
    meta?: Record<string, unknown>;
}

/**
 * SDK query options.mcpServers 的 stdio 配置 map。
 * key 为服务器名，value 为 stdio 启动配置。type 固定 'stdio'（传输协议），
 * 与 McpServerInfo.type（运行时推断 node/python/docker）语义不同，不可混用。
 */
export type McpStdioMap = Record<string, {
    type: 'stdio';
    command: string;
    args: string[];
    env: Record<string, string>;
}>;

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
    /** 历史消息数量限制（避免token爆炸导致529） */
    maxHistoryMessages?: number;
    /** 技能列表 */
    skills?: string[] | 'all';
    /** MCP 服务器 stdio 配置 map，undefined = 不注入（claude 走全局默认 MCP） */
    mcpServers?: McpStdioMap;
}

/**
 * CLI Provider 运行选项
 */
export interface CLIProviderOptions {
    /** 工作区路径 */
    workspacePath?: string;
    /** 中止信号 */
    signal?: AbortSignal;
    /** 实时输出回调（meta 用于传递结构化事件类型） */
    onOutput?: (data: string, meta?: Record<string, unknown>) => void;
    /** 错误输出回调 */
    onError?: (data: string) => void;
    /** 工具权限请求回调（agent 执行时注入；不传则 bridge 不启用权限确认） */
    onPermissionRequest?: (meta: Record<string, unknown>) => void;
    /** 模型名称（覆盖配置文件中的默认模型） */
    model?: string;
    /** 推理强度（Claude 专用） */
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** 是否启用扩展思考（Claude 专用） */
    extendedThinking?: boolean;
    /** 是否启用流式输出 */
    streaming?: boolean;
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
    /** 来源：builtin（内置）/ external（外部 cc/codex） */
    source?: string;
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
    /** 命令参数 */
    args?: string[];
    /** 环境变量 */
    env?: Record<string, string>;
    /** 是否启用 */
    enabled: boolean;
    /** 连接状态 */
    status?: 'connected' | 'disconnected' | 'error';
}
