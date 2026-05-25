/**
 * @file 工作流管线服务
 * @description 提供工作流管线（Pipeline）的持久化存储和管理能力。
 *   管线定义了 AI 辅助开发工作流的完整配置，包括需求来源、工作空间绑定、
 *   各阶段使用的技能集合、MCP 工具集配置以及测试策略等。
 *   所有管线数据以 JSON 格式存储在用户主目录下的 ~/.ai-dev-workbench/pipelines.json 文件中。
 */
/**
 * 需求来源配置接口
 * @description 定义工作流中需求的获取方式，支持通过 MCP 服务器（ONES、Jira、GitLab）或手动输入
 */
export interface RequirementSourceConfig {
    /** 需求来源类型 */
    type: 'ones' | 'jira' | 'gitlab' | 'manual';
    /** 当 type 不为 'manual' 时，指定要使用的 MCP 服务器名称 */
    mcpServerName?: string;
}
/**
 * 工作空间步骤配置接口
 * @description 定义工作流中工作空间的绑定路径
 */
export interface WorkspaceStepConfig {
    /** 绑定的项目工作空间路径，为空则使用当前工作目录 */
    boundPath?: string;
}
/**
 * 技能集合配置接口
 * @description 定义在特定阶段可使用的 Claude 技能（Slash Commands）范围
 */
export interface SkillSetConfig {
    /** 技能选择模式：'all' 使用全部技能，'selected' 仅使用指定技能 */
    mode: 'all' | 'selected';
    /** 当 mode 为 'selected' 时，指定启用的技能名称列表 */
    selectedSkills: string[];
}
/**
 * MCP 工具集配置接口
 * @description 定义工作流中可使用的 MCP 服务器工具范围
 */
export interface MCPToolSetConfig {
    /** 工具选择模式：'all' 使用全部服务器工具，'selected' 仅使用指定服务器 */
    mode: 'all' | 'selected';
    /** 当 mode 为 'selected' 时，指定启用的 MCP 服务器名称列表 */
    selectedServers: string[];
}
/**
 * 测试策略配置接口
 * @description 定义工作流中测试阶段的执行策略，包括执行环境配置
 */
export interface TestStrategyConfig {
    /** 测试模式：
     *   'ai_generate' - AI 直接生成并执行测试（输出为文本）
     *   'run_existing' - 运行已有测试文件
     *   'ai_generate_e2e' - AI 生成 Playwright 测试文件保存到项目，再通过 Provider 执行
     */
    mode: 'ai_generate' | 'run_existing' | 'ai_generate_e2e';
    /** 仅在 run_existing 模式下有效，指定测试框架名称（如 vitest、jest、pytest） */
    framework?: string;
    /** 仅在 run_existing 模式下有效，指定测试执行命令 */
    command?: string;
    /** 是否在代码执行完成后自动运行测试 */
    autoRunAfterExecution: boolean;
    /** 是否仅运行变更文件相关的测试（基于 Provider 的变更点感知） */
    changedFilesOnly?: boolean;
    /** 测试执行环境：'local' 本地执行（默认），'sandbox' 在远程沙箱中执行 */
    environment?: 'local' | 'sandbox';
    /** Daytona 沙箱 ID（environment 为 sandbox 时必填，预创建的沙箱实例 ID） */
    sandboxId?: string;
}
/**
 * 文档解析配置接口
 * @description 定义工作流中文档解析的配置（MinerU），支持自动解析需求附件和额外文件路径
 */
export interface DocumentParsingConfig {
    /** 额外需要解析的文件路径（相对于 workspace） */
    extraPaths?: string[];
}
/**
 * 管线步骤配置接口
 * @description 定义管线中所有步骤的配置集合，是管线的核心配置单元
 */
export interface PipelineStepConfig {
    /** 需求来源配置 */
    requirementSource: RequirementSourceConfig;
    /** 工作空间配置 */
    workspace: WorkspaceStepConfig;
    /** 文档解析配置（MinerU） */
    documentParsing?: DocumentParsingConfig;
    /** 规划阶段使用的技能配置（推荐使用，按阶段细分） */
    planSkills?: SkillSetConfig;
    /** 代码执行阶段使用的技能配置 */
    executionSkills?: SkillSetConfig;
    /** 测试阶段使用的技能配置 */
    testSkills?: SkillSetConfig;
    /** 旧版单一技能配置（保留用于向后兼容） */
    skillSet?: SkillSetConfig;
    /** MCP 工具集配置 */
    mcpToolSet: MCPToolSetConfig;
    /** 测试策略配置 */
    testStrategy: TestStrategyConfig;
}
/**
 * 工作流管线接口
 * @description 表示一个完整的工作流管线定义，包含基本元信息和步骤配置
 */
export interface WorkflowPipeline {
    /** 管线唯一标识符（UUID） */
    id: string;
    /** 管线显示名称 */
    name: string;
    /** 管线描述说明 */
    description: string;
    /** 是否为默认管线 */
    isDefault: boolean;
    /** 创建时间（ISO 8601 格式） */
    createdAt: string;
    /** 最后更新时间（ISO 8601 格式） */
    updatedAt: string;
    /** 管线步骤配置 */
    steps: PipelineStepConfig;
}
/**
 * 管线验证错误接口
 * @description 表示管线配置验证中的单个错误项
 */
export interface PipelineValidationError {
    /** 出错字段的路径（如 'name' 或 'steps.requirementSource.mcpServerName'） */
    field: string;
    /** 错误描述信息 */
    message: string;
}
/**
 * 管线验证结果接口
 * @description 表示管线配置验证的完整结果
 */
export interface PipelineValidationResult {
    /** 验证是否通过 */
    valid: boolean;
    /** 验证错误列表，为空表示验证通过 */
    errors: PipelineValidationError[];
}
/**
 * 管线服务类
 * @description 提供 CRUD 操作和验证能力，管理所有工作流管线的生命周期。
 *   数据以 JSON 数组形式持久化到磁盘，支持自定义存储路径以便测试。
 */
export declare class PipelineService {
    /** 配置文件所在目录 */
    private configDir;
    /** 管线数据存储文件的完整路径 */
    private pipelinesFile;
    /**
     * 构造函数
     * @param configDir - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir?: string);
    /**
     * 确保配置目录存在
     * @description 如果目录不存在则递归创建，包括所有必要的父目录
     */
    private ensureConfigDir;
    /**
     * 从磁盘加载所有管线数据
     * @returns 管线数组，文件不存在或解析失败时返回空数组
     */
    private loadPipelines;
    /**
     * 将所有管线数据保存到磁盘
     * @param pipelines - 要保存的管线数组
     */
    private savePipelines;
    /**
     * 列出所有管线
     * @returns 管线数组
     */
    list(): WorkflowPipeline[];
    /**
     * 根据 ID 获取指定管线
     * @param id - 管线的唯一标识符
     * @returns 匹配的管线对象，未找到时返回 undefined
     */
    get(id: string): WorkflowPipeline | undefined;
    /**
     * 创建新管线
     * @description 自动生成 UUID 作为 ID，记录创建和更新时间。
     *   如果新管线设置为默认，则自动取消其他管线的默认状态。
     * @param input - 新管线的配置（不含 id、createdAt、updatedAt）
     * @returns 创建后的完整管线对象
     */
    create(input: Omit<WorkflowPipeline, 'id' | 'createdAt' | 'updatedAt'>): WorkflowPipeline;
    /**
     * 更新现有管线
     * @description 使用浅合并策略更新指定字段，自动更新 updatedAt 时间戳。
     *   ID 和 createdAt 不可修改。如果设为默认，则取消其他管线的默认状态。
     * @param id - 要更新的管线 ID
     * @param input - 要更新的字段（不含 id、createdAt）
     * @returns 更新后的完整管线对象
     * @throws 当指定 ID 的管线不存在时抛出错误
     */
    update(id: string, input: Partial<Omit<WorkflowPipeline, 'id' | 'createdAt'>>): WorkflowPipeline;
    /**
     * 根据 ID 删除管线
     * @param id - 要删除的管线 ID
     * @returns 是否删除成功（false 表示未找到指定管线）
     */
    delete(id: string): boolean;
    /**
     * 设置指定管线为默认管线
     * @description 同时取消其他所有管线的默认状态，确保全局只有一个默认管线
     * @param id - 要设为默认的管线 ID
     * @throws 当指定 ID 的管线不存在时抛出错误
     */
    setDefault(id: string): void;
    /**
     * 验证管线配置的有效性
     * @description 检查管线名称是否非空、步骤配置是否存在，
     *   以及引用的 MCP 服务器是否在可用服务器列表中。
     * @param pipeline - 待验证的管线对象
     * @param availableMCPServers - 当前可用的 MCP 服务器名称列表
     * @returns 验证结果，包含是否通过和错误详情列表
     */
    validate(pipeline: WorkflowPipeline, availableMCPServers: string[]): PipelineValidationResult;
}
//# sourceMappingURL=pipeline-service.d.ts.map