/**
 * 应用配置接口
 * @interface AppConfig
 * @description 定义了应用全局配置的完整结构，所有字段均为可选
 */
export interface AppConfig {
    /** 服务器相关配置 */
    server?: {
        /** 服务监听端口号（有效范围 1-65535） */
        port?: number;
        /** 服务监听主机地址（默认 'localhost'） */
        host?: string;
    };
    /** Claude Code CLI 相关配置 */
    claudeCodeCli?: {
        /** Claude CLI 可执行文件路径（默认 'claude'） */
        path?: string;
    };
    /** 用户界面偏好设置 */
    ui?: {
        /** 界面主题，支持深色和浅色模式 */
        theme?: 'dark' | 'light';
        /** 侧边栏是否默认折叠 */
        sidebarCollapsed?: boolean;
    };
    /** 默认流水线 ID，用于指定启动时自动加载的流水线 */
    defaultPipelineId?: string;
    /** Daytona 沙箱配置 */
    daytona?: {
        /** Daytona API Key（从 app.daytona.io 获取） */
        apiKey?: string;
        /** Daytona API 地址（默认 https://app.daytona.io/api，self-hosted 时改为本地地址） */
        apiUrl?: string;
        /** 是否启用 Daytona 沙箱（默认 false，启用时 agent 命令在沙箱内执行） */
        enabled?: boolean;
        /** 沙箱镜像模板名称（sandboxId 为空时生效） */
        template?: string;
        /** 预创建的沙箱 ID（指定后不再自动创建，所有工作空间共用此沙箱） */
        sandboxId?: string;
    };
    /** CLI Provider 配置（Claude Code / OpenAI Codex） */
    cliProvider?: {
        /** 当前激活的 CLI Provider ID */
        active?: 'claude' | 'codex';
        /** 是否已完成首次引导选择 */
        setupCompleted?: boolean;
        /** Codex 特定配置 */
        codex?: {
            /** 使用的模型名称（默认 'codex-mini-latest'） */
            model?: string;
        };
    };
    /** MinerU 文档解析服务配置 */
    mineru?: {
        /** MinerU 服务地址 */
        apiUrl?: string;
        /** 是否启用 MinerU 解析（默认 true） */
        enabled?: boolean;
        /** 默认解析后端 */
        defaultBackend?: string;
        /** 默认语言列表 */
        defaultLangList?: string[];
    };
}
/**
 * 配置验证错误接口
 * @interface ConfigValidationError
 * @description 描述单个配置字段的验证错误信息
 */
export interface ConfigValidationError {
    /** 出错字段名称（支持点号分隔的嵌套路径，如 'server.port'） */
    field: string;
    /** 错误描述信息 */
    message: string;
}
/**
 * 验证配置对象的字段类型是否正确
 *
 * 对配置对象进行递归的类型检查，确保每个字段都符合预期的类型约束。
 * 验证规则包括：
 * - 根对象必须是非 null 的对象
 * - server.port 必须是 1-65535 范围内的整数
 * - server.host 必须是字符串
 * - claudeCodeCli.path 必须是字符串
 * - ui.theme 只能是 'dark' 或 'light'
 * - ui.sidebarCollapsed 必须是布尔值
 * - defaultPipelineId 必须是字符串
 *
 * @param config - 待验证的配置对象（类型为 unknown，需先进行类型检查）
 * @returns ConfigValidationError[] 验证错误数组，空数组表示验证通过
 */
export declare function validateConfig(config: unknown): ConfigValidationError[];
/**
 * 配置服务类
 *
 * 提供应用配置的加载、保存、验证和默认值管理功能。
 * 配置文件以 JSON 格式存储在磁盘上，每次操作都会进行验证，
 * 确保配置数据的完整性和正确性。
 *
 * @example
 * ```typescript
 * // 使用默认路径
 * const configService = new ConfigService();
 * // 使用自定义路径
 * const configService = new ConfigService('/custom/config/dir');
 * ```
 */
export declare class ConfigService {
    /** 配置文件所在目录的绝对路径 */
    private configDir;
    /** 配置文件的绝对路径（config.json） */
    private configFile;
    /**
     * 构造配置服务
     * @param configDir - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir?: string);
    /**
     * 确保配置目录存在
     * 如果目录不存在，则递归创建（包括所有必要的父目录）。
     */
    ensureConfigDir(): void;
    /**
     * 从磁盘加载配置
     *
     * 如果配置文件不存在，则使用默认配置创建新文件并返回默认配置的副本。
     * 如果文件存在但包含无效 JSON 或验证失败，则抛出错误。
     *
     * @returns AppConfig 加载并验证通过的配置对象
     * @throws {Error} 配置文件包含无效 JSON 或验证失败时抛出
     */
    load(): AppConfig;
    /**
     * 保存配置到磁盘
     *
     * 先对配置进行验证，验证通过后以格式化的 JSON 写入文件。
     * 如果验证失败，拒绝写入并抛出错误，避免将无效配置持久化。
     *
     * @param config - 要保存的配置对象
     * @throws {Error} 配置验证失败时抛出
     */
    save(config: AppConfig): void;
    /**
     * 获取配置目录路径
     * @returns string 配置目录的绝对路径
     */
    getConfigDir(): string;
    /**
     * 获取配置文件路径
     * @returns string 配置文件的绝对路径
     */
    getConfigFile(): string;
    /**
     * 获取默认配置
     * @returns AppConfig 默认配置对象的副本（防止外部修改影响内部默认值）
     */
    getDefaultConfig(): AppConfig;
}
//# sourceMappingURL=config-service.d.ts.map