/**
 * @module cli-providers/types
 * @description CLI Provider 统一接口定义
 *
 * 定义了 CLI Provider 的抽象接口（开放扩展：新增 Provider 无需修改本文件）。
 * 所有 Provider 必须实现此接口，由 CLIRunnerService 作为 facade 代理调用，
 * 并通过 cli-providers/index.ts 的注册表登记工厂函数。
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
    /**
     * 是否支持注入自定义模型端点（setModelRecord：Anthropic 兼容 baseUrl/apiKey）。
     * 调用方据此决定是否允许将自定义供应商记录路由到此 Provider。
     */
    supportsCustomEndpoint: boolean;
}

/**
 * 自定义模型端点连接信息
 * @description 激活自定义供应商记录（models.json 中 kind='custom'）时注入，
 *              仅 capabilities.supportsCustomEndpoint = true 的 Provider 需要实现 setModelRecord。
 */
export interface CLIProviderModelConnection {
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
}

/**
 * 单个 Provider 的模型运行配置（持久化于 config.json 的 cliProvider.models[id]）
 * @description 字段松散联合：哪些字段生效由各 Provider 的 capabilities 决定，
 *              新增 Provider 无需扩展本结构即可复用全部通用字段。
 */
export interface ProviderModelSettings {
    /** 模型名称（或 SDK 可解析的档位别名，如 'sonnet'） */
    model?: string;
    /** 是否启用流式输出 */
    streaming?: boolean;
    /** 推理强度（capabilities.supportsReasoningEffort 的 Provider 生效） */
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** 扩展思考（capabilities.supportsExtendedThinking 的 Provider 生效） */
    extendedThinking?: boolean;
    /** 最大 token 数 */
    maxTokens?: number;
    /** 底层 LLM 提供商（如 pi 的 'anthropic' | 'openai' | 'deepseek' 等） */
    modelProvider?: string;
}

/**
 * Provider 可提供的模型选项（供前端渲染模型选择 UI）
 * @description loadModelOptions 的返回值，按 Provider 能力部分提供。
 */
export interface CLIProviderModelOptions {
    /** 档位别名列表（如 Claude 的 haiku/sonnet/opus，value 为 SDK 可识别别名） */
    tiers?: Array<{ value: string; label: string; model: string }>;
    /** 从 Provider 本地配置读取的当前模型名（如 Codex 的 config.toml model） */
    current?: string | null;
}

/**
 * CLI Provider 统一接口
 * @description 所有 CLI 后端必须实现的抽象契约
 */
export interface CLIProvider {
    /** Provider 能力声明 */
    readonly capabilities: CLIProviderCapabilities;
    /** Provider 唯一标识（开放字符串：由各 Provider 自行声明，新增后端不要求修改本接口） */
    readonly id: string;
    /** 显示名称 */
    readonly label: string;
    /**
     * 默认模型运行配置（cliProvider.models[id] 无存储值时使用）
     * @description 由 Provider 自带默认，新增 Provider 无需修改 ConfigService 或路由层
     */
    readonly defaultModelSettings?: ProviderModelSettings;

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
     * 注入自定义模型端点配置（可选能力，见 capabilities.supportsCustomEndpoint）。
     * 传入 null 清除。实现方需在下次 initialize 重启时加载新 env。
     */
    setModelRecord?(rec: CLIProviderModelConnection | null): void;

    /**
     * 读取本地可提供的模型选项（可选：用于前端渲染模型选择 UI）。
     * 未实现的 Provider 返回 undefined，前端回退为手动输入模型名。
     */
    loadModelOptions?(): Promise<CLIProviderModelOptions>;

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
    /** 底层 LLM 提供商（多后端聚合型 Provider 使用，如 pi 的 'anthropic'/'openai'/'deepseek'） */
    modelProvider?: string;
    /** 推理强度（capabilities.supportsReasoningEffort 的 Provider 生效） */
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** 是否启用扩展思考（capabilities.supportsExtendedThinking 的 Provider 生效） */
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
