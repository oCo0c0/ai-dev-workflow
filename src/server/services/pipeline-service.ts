/**
 * @file 工作流管线服务
 * @description 提供工作流管线（Pipeline）的持久化存储和管理能力。
 *   管线定义了 AI 辅助开发工作流的完整配置，包括需求来源、工作空间绑定、
 *   各阶段使用的技能集合、MCP 工具集配置以及测试策略等。
 *   所有管线数据以 JSON 格式存储在用户主目录下的 ~/.ai-dev-workbench/pipelines.json 文件中。
 */

import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';
import crypto from 'crypto';

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
 * 阶段工具配置接口（新模型）
 * @description 按流水线阶段（plan/execution/test）独立配置技能和 MCP 服务器。
 *   取代旧的 SkillSetConfig + 全局 MCPToolSetConfig 组合：每个阶段一份配置，
 *   技能和 MCP 同处一体。空数组表示该阶段不启用对应工具——无 all/selected mode 概念。
 *   向后兼容：旧字段（planSkills/executionSkills/testSkills/mcpToolSet）仍保留，
 *   当新阶段字段缺失时由 skill-utils 回退解析。
 */
export interface PhaseToolsConfig {
    /** 该阶段启用的技能名称列表，空数组 = 不启用任何技能 */
    skills: string[];
    /** 该阶段启用的 MCP 服务器名称列表，空数组 = 不启用任何 MCP（claude 走全局默认） */
    mcpServers: string[];
    /** Agent模式：'skill' 传统技能模式（默认），'agent' Agent自主决策模式（不需要指定agentId） */
    agentMode?: 'agent' | 'skill';
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
    /** 需求来源配置（可选——需求获取方式现由运行时向导决定，保留以兼容旧配置） */
    requirementSource?: RequirementSourceConfig;
    /** 工作空间配置 */
    workspace: WorkspaceStepConfig;
    /** 文档解析配置（MinerU） */
    documentParsing?: DocumentParsingConfig;
    /** 规划阶段工具配置（新模型：技能 + MCP 按阶段独立） */
    plan?: PhaseToolsConfig;
    /** 代码执行阶段工具配置（新模型：技能 + MCP 按阶段独立） */
    execution?: PhaseToolsConfig;
    /** 测试阶段工具配置（新模型：技能 + MCP 按阶段独立） */
    test?: PhaseToolsConfig;
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
    /** Agent自主决策模式：开启后不需要配置steps中的工具细节 */
    agentMode?: boolean;
    /** 创建时间（ISO 8601 格式） */
    createdAt: string;
    /** 最后更新时间（ISO 8601 格式） */
    updatedAt: string;
    /** 管线步骤配置（agentMode=false时需要配置） */
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
path.join(APP_DATA_DIR, 'pipelines.json');
/**
 * 管线服务类
 * @description 提供 CRUD 操作和验证能力，管理所有工作流管线的生命周期。
 *   数据以 JSON 数组形式持久化到磁盘，支持自定义存储路径以便测试。
 */
export class PipelineService {
    /** 配置文件所在目录 */
    private readonly configDir: string;
    /** 管线数据存储文件的完整路径 */
    private readonly pipelinesFile: string;

    /**
     * 构造函数
     * @param configDir - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir?: string) {
        this.configDir = configDir ?? APP_DATA_DIR;
        this.pipelinesFile = path.join(this.configDir, 'pipelines.json');
    }

    /**
     * 确保配置目录存在
     * @description 如果目录不存在则递归创建，包括所有必要的父目录
     */
    private ensureConfigDir(): void {
        if (!fs.existsSync(this.configDir)) {
            fs.mkdirSync(this.configDir, {recursive: true});
        }
    }

    /**
     * 从磁盘加载所有管线数据
     * @returns 管线数组，文件不存在或解析失败时返回空数组
     */
    private loadPipelines(): WorkflowPipeline[] {
        if (!fs.existsSync(this.pipelinesFile)) {
            return [];
        }

        try {
            const raw = fs.readFileSync(this.pipelinesFile, 'utf-8');
            const parsed = JSON.parse(raw);
            // 确保解析结果为数组类型
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed as WorkflowPipeline[];
        } catch {
            return [];
        }
    }

    /**
     * 将所有管线数据保存到磁盘
     * @param pipelines - 要保存的管线数组
     */
    private savePipelines(pipelines: WorkflowPipeline[]): void {
        this.ensureConfigDir();
        fs.writeFileSync(this.pipelinesFile, JSON.stringify(pipelines, null, 2), 'utf-8');
    }

    /**
     * 列出所有管线（按创建时间倒序，新创建的在最前面）
     * @returns 管线数组
     */
    list(): WorkflowPipeline[] {
        const pipelines = this.loadPipelines();
        // 按创建时间倒序排列（新创建的在最前面）
        return pipelines.sort((a, b) => {
            const dateA = new Date(a.createdAt).getTime();
            const dateB = new Date(b.createdAt).getTime();
            return dateB - dateA; // 倒序
        });
    }

    /**
     * 根据 ID 获取指定管线
     * @param id - 管线的唯一标识符
     * @returns 匹配的管线对象，未找到时返回 undefined
     */
    get(id: string): WorkflowPipeline | undefined {
        const pipelines = this.loadPipelines();
        return pipelines.find(p => p.id === id);
    }

    /**
     * 创建新管线
     * @description 自动生成 UUID 作为 ID，记录创建和更新时间。
     *   如果新管线设置为默认，则自动取消其他管线的默认状态。
     * @param input - 新管线的配置（不含 id、createdAt、updatedAt）
     * @returns 创建后的完整管线对象
     */
    create(input: Omit<WorkflowPipeline, 'id' | 'createdAt' | 'updatedAt'>): WorkflowPipeline {
        const pipelines = this.loadPipelines();
        const now = new Date().toISOString();

        const pipeline: WorkflowPipeline = {
            id: crypto.randomUUID(),
            name: input.name,
            description: input.description,
            isDefault: input.isDefault,
            createdAt: now,
            updatedAt: now,
            steps: input.steps,
        };

        // 如果新管线被设为默认，则取消其他所有管线的默认状态，确保唯一性
        if (pipeline.isDefault) {
            for (const p of pipelines) {
                p.isDefault = false;
            }
        }

        pipelines.push(pipeline);
        this.savePipelines(pipelines);
        return pipeline;
    }

    /**
     * 更新现有管线
     * @description 使用浅合并策略更新指定字段，自动更新 updatedAt 时间戳。
     *   ID 和 createdAt 不可修改。如果设为默认，则取消其他管线的默认状态。
     * @param id - 要更新的管线 ID
     * @param input - 要更新的字段（不含 id、createdAt）
     * @returns 更新后的完整管线对象
     * @throws 当指定 ID 的管线不存在时抛出错误
     */
    update(id: string, input: Partial<Omit<WorkflowPipeline, 'id' | 'createdAt'>>): WorkflowPipeline {
        const pipelines = this.loadPipelines();
        const index = pipelines.findIndex(p => p.id === id);

        if (index === -1) {
            throw new Error(`Pipeline not found: ${id}`);
        }

        const existing = pipelines[index];

        // 如果设置为默认，先取消所有其他管线的默认状态
        if (input.isDefault) {
            for (const p of pipelines) {
                p.isDefault = false;
            }
        }

        // 合并更新，保留不可变字段
        const updated: WorkflowPipeline = {
            ...existing,
            ...input,
            id: existing.id,
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        };

        pipelines[index] = updated;
        this.savePipelines(pipelines);
        return updated;
    }

    /**
     * 根据 ID 删除管线
     * @param id - 要删除的管线 ID
     * @returns 是否删除成功（false 表示未找到指定管线）
     */
    delete(id: string): boolean {
        const pipelines = this.loadPipelines();
        const index = pipelines.findIndex(p => p.id === id);

        if (index === -1) {
            return false;
        }

        pipelines.splice(index, 1);
        this.savePipelines(pipelines);
        return true;
    }

    /**
     * 设置指定管线为默认管线
     * @description 同时取消其他所有管线的默认状态，确保全局只有一个默认管线
     * @param id - 要设为默认的管线 ID
     * @throws 当指定 ID 的管线不存在时抛出错误
     */
    setDefault(id: string): void {
        const pipelines = this.loadPipelines();
        const target = pipelines.find(p => p.id === id);

        if (!target) {
            throw new Error(`Pipeline not found: ${id}`);
        }

        // 仅将目标管线设为默认，其余全部取消
        for (const p of pipelines) {
            p.isDefault = p.id === id;
        }

        this.savePipelines(pipelines);
    }

    /**
     * 验证管线配置的有效性
     * @description 检查管线名称是否非空、步骤配置是否存在，
     *   以及引用的 MCP 服务器是否在可用服务器列表中。
     * @param pipeline - 待验证的管线对象
     * @param availableMCPServers - 当前可用的 MCP 服务器名称列表
     * @returns 验证结果，包含是否通过和错误详情列表
     */
    validate(pipeline: WorkflowPipeline, availableMCPServers: string[]): PipelineValidationResult {
        const errors: PipelineValidationError[] = [];

        // 验证管线名称
        if (!pipeline.name || pipeline.name.trim() === '') {
            errors.push({field: 'name', message: 'Pipeline name is required'});
        }

        // 验证步骤配置是否存在
        if (!pipeline.steps) {
            errors.push({field: 'steps', message: 'Pipeline steps configuration is required'});
            return {valid: false, errors};
        }

        // 验证需求来源中引用的 MCP 服务器是否存在
        const reqSource = pipeline.steps.requirementSource;
        if (reqSource && reqSource.type !== 'manual' && reqSource.mcpServerName) {
            if (!availableMCPServers.includes(reqSource.mcpServerName)) {
                errors.push({
                    field: 'steps.requirementSource.mcpServerName',
                    message: `Referenced MCP Server "${reqSource.mcpServerName}" does not exist`,
                });
            }
        }

        // 验证 MCP 工具集中引用的服务器是否都存在
        const mcpToolSet = pipeline.steps.mcpToolSet;
        if (mcpToolSet && mcpToolSet.mode === 'selected') {
            for (const serverName of mcpToolSet.selectedServers) {
                if (!availableMCPServers.includes(serverName)) {
                    errors.push({
                        field: 'steps.mcpToolSet.selectedServers',
                        message: `Referenced MCP Server "${serverName}" does not exist`,
                    });
                }
            }
        }

        // 验证新模型阶段配置（plan/execution/test）：结构为数组 + 引用的 MCP 服务器存在
        const phases = ['plan', 'execution', 'test'] as const;
        for (const phase of phases) {
            const phaseCfg = pipeline.steps[phase];
            if (!phaseCfg) continue;
            if (!Array.isArray(phaseCfg.skills)) {
                errors.push({
                    field: `steps.${phase}.skills`,
                    message: `${phase}.skills must be an array of skill names`,
                });
            }
            if (!Array.isArray(phaseCfg.mcpServers)) {
                errors.push({
                    field: `steps.${phase}.mcpServers`,
                    message: `${phase}.mcpServers must be an array of MCP server names`,
                });
                continue;
            }
            for (const serverName of phaseCfg.mcpServers) {
                if (!availableMCPServers.includes(serverName)) {
                    errors.push({
                        field: `steps.${phase}.mcpServers`,
                        message: `Referenced MCP Server "${serverName}" does not exist`,
                    });
                }
            }
        }

        return {valid: errors.length === 0, errors};
    }
}
