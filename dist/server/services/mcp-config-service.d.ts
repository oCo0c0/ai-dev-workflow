/**
 * MCP 服务器配置接口
 * @interface MCPServerConfig
 * @description 描述一个 MCP 服务器的完整配置信息
 */
export interface MCPServerConfig {
    /** 服务器名称，作为配置中的唯一标识 */
    name: string;
    /** 服务器运行时类型（由系统根据命令自动推断：node/python/docker/custom） */
    type: string;
    /** 启动服务器的可执行命令 */
    command: string;
    /** 传递给命令的参数数组 */
    args: string[];
    /** 环境变量键值对 */
    env: Record<string, string>;
    /** 服务器是否启用 */
    enabled: boolean;
    /** 服务器连接状态（运行时动态值，非持久化） */
    status?: 'connected' | 'disconnected' | 'error';
}
/**
 * MCP 配置服务类
 *
 * 管理 Claude 的 MCP 服务器配置，直接读写 Claude Code CLI 的 settings.json 文件。
 * 提供服务器配置的完整生命周期管理：列出、查询、添加、更新、删除和连接测试。
 * 在读写配置时会保留 settings.json 中的其他字段（如 permissions 等）不被破坏。
 *
 * @example
 * ```typescript
 * // 使用默认路径（~/.claude/settings.json）
 * const mcpService = new MCPConfigService();
 * // 使用自定义配置文件路径
 * const mcpService = new MCPConfigService('/path/to/custom-settings.json');
 * ```
 */
export declare class MCPConfigService {
    /** Claude 设置文件的绝对路径 */
    private settingsFile;
    /** Claude 配置目录的绝对路径 */
    private claudeDir;
    /**
     * 构造 MCP 配置服务
     * @param settingsFile - 可选的自定义设置文件路径，默认为 ~/.claude/settings.json
     */
    constructor(settingsFile?: string);
    /**
     * 确保 Claude 配置目录存在
     * 如果目录不存在，则递归创建所有必要的父目录。
     */
    private ensureClaudeDir;
    /**
     * 从磁盘加载 Claude 设置文件
     *
     * 容错策略：
     * - 文件不存在时返回空对象
     * - JSON 解析失败或内容不是对象时返回空对象
     *
     * @returns ClaudeSettingsFile 解析后的设置对象
     */
    private loadSettings;
    /**
     * 保存 Claude 设置文件到磁盘
     * 保存前确保目录存在。写入格式化的 JSON，保留文件中的所有字段。
     *
     * @param settings - 要保存的完整设置对象
     */
    private saveSettings;
    /**
     * 列出所有已配置的 MCP 服务器
     *
     * 同时读取 ~/.claude/settings.json 和 ~/.claude.json 两个配置文件，
     * 合并两边的 mcpServers（settings.json 优先，同名服务器以 settings.json 为准）。
     * 这样无论用户通过 Claude CLI 还是手动编辑哪个文件，都能被正确识别。
     *
     * @returns MCPServerConfig[] 服务器配置数组
     */
    list(): MCPServerConfig[];
    /**
     * 从指定文件中读取 mcpServers 配置
     * @param filePath - 配置文件路径
     * @returns mcpServers 映射表，读取失败返回空对象
     */
    private loadMcpServersFromFile;
    /**
     * 根据名称获取单个 MCP 服务器配置
     * 同时查找 ~/.claude/settings.json 和 ~/.claude.json，settings.json 优先。
     *
     * @param name - 服务器名称
     * @returns MCPServerConfig | undefined 找到则返回配置，未找到返回 undefined
     */
    get(name: string): MCPServerConfig | undefined;
    /**
     * 添加新的 MCP 服务器配置
     *
     * 验证名称和命令不为空，检查是否已存在同名服务器，通过验证后写入配置文件。
     *
     * @param config - 要添加的服务器配置（必须包含 name 和 command）
     * @returns MCPServerConfig 添加后的服务器配置（含自动推断的类型）
     * @throws {Error} 名称或命令为空、或同名服务器已存在时抛出
     */
    add(config: MCPServerConfig): MCPServerConfig;
    /**
     * 更新已有的 MCP 服务器配置
     *
     * 支持部分更新（Partial），未指定的字段保持原值。
     * 更新后的配置会写入磁盘。
     *
     * @param name - 要更新的服务器名称
     * @param config - 要更新的配置字段（部分更新）
     * @returns MCPServerConfig 更新后的完整服务器配置
     * @throws {Error} 指定名称的服务器不存在时抛出
     */
    update(name: string, config: Partial<Omit<MCPServerConfig, 'name'>>): MCPServerConfig;
    /**
     * 删除 MCP 服务器配置
     *
     * @param name - 要删除的服务器名称
     * @returns boolean 删除成功返回 true，服务器不存在返回 false
     */
    delete(name: string): boolean;
    /**
     * 测试 MCP 服务器连接
     *
     * 通过实际启动 MCP 服务器的命令来验证其是否可用。测试逻辑如下：
     * - 在指定超时时间内进程仍在运行 → 判定为连接成功
     * - 进程正常退出（退出码 0）→ 判定为连接成功
     * - 进程异常退出（非零退出码）→ 判定为连接失败
     * - 进程启动失败（spawn 错误）→ 判定为连接失败
     *
     * 注意：测试完成后会自动终止启动的进程，不会留下残留进程。
     *
     * @param name - 要测试的服务器名称
     * @param timeoutMs - 超时时间（毫秒），默认 5000ms
     * @returns Promise<{ status: 'connected' | 'error'; message: string }> 测试结果
     */
    testConnection(name: string, timeoutMs?: number): Promise<{
        status: 'connected' | 'error';
        message: string;
    }>;
    /**
     * 获取设置文件路径
     * @returns string 设置文件的绝对路径
     */
    getSettingsFile(): string;
    /**
     * 根据命令和参数推断 MCP 服务器的运行时类型
     *
     * 通过检查命令和参数中是否包含特定关键字来判断服务器类型：
     * - 包含 npx/node/.js → 'node'
     * - 包含 python/.py → 'python'
     * - 包含 docker → 'docker'
     * - 其他 → 'custom'
     *
     * @param command - 启动命令
     * @param args - 命令参数（可选）
     * @returns string 推断出的运行时类型标识
     */
    private inferType;
}
//# sourceMappingURL=mcp-config-service.d.ts.map