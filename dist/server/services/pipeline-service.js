"use strict";
/**
 * @file 工作流管线服务
 * @description 提供工作流管线（Pipeline）的持久化存储和管理能力。
 *   管线定义了 AI 辅助开发工作流的完整配置，包括需求来源、工作空间绑定、
 *   各阶段使用的技能集合、MCP 工具集配置以及测试策略等。
 *   所有管线数据以 JSON 格式存储在用户主目录下的 ~/.ai-dev-workbench/pipelines.json 文件中。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
const crypto_1 = __importDefault(require("crypto"));
/** 默认管线存储文件路径 */
const PIPELINES_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'pipelines.json');
/**
 * 管线服务类
 * @description 提供 CRUD 操作和验证能力，管理所有工作流管线的生命周期。
 *   数据以 JSON 数组形式持久化到磁盘，支持自定义存储路径以便测试。
 */
class PipelineService {
    /** 配置文件所在目录 */
    configDir;
    /** 管线数据存储文件的完整路径 */
    pipelinesFile;
    /**
     * 构造函数
     * @param configDir - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir) {
        this.configDir = configDir ?? constants_js_1.APP_DATA_DIR;
        this.pipelinesFile = path_1.default.join(this.configDir, 'pipelines.json');
    }
    /**
     * 确保配置目录存在
     * @description 如果目录不存在则递归创建，包括所有必要的父目录
     */
    ensureConfigDir() {
        if (!fs_1.default.existsSync(this.configDir)) {
            fs_1.default.mkdirSync(this.configDir, { recursive: true });
        }
    }
    /**
     * 从磁盘加载所有管线数据
     * @returns 管线数组，文件不存在或解析失败时返回空数组
     */
    loadPipelines() {
        if (!fs_1.default.existsSync(this.pipelinesFile)) {
            return [];
        }
        try {
            const raw = fs_1.default.readFileSync(this.pipelinesFile, 'utf-8');
            const parsed = JSON.parse(raw);
            // 确保解析结果为数组类型
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed;
        }
        catch {
            return [];
        }
    }
    /**
     * 将所有管线数据保存到磁盘
     * @param pipelines - 要保存的管线数组
     */
    savePipelines(pipelines) {
        this.ensureConfigDir();
        fs_1.default.writeFileSync(this.pipelinesFile, JSON.stringify(pipelines, null, 2), 'utf-8');
    }
    /**
     * 列出所有管线
     * @returns 管线数组
     */
    list() {
        return this.loadPipelines();
    }
    /**
     * 根据 ID 获取指定管线
     * @param id - 管线的唯一标识符
     * @returns 匹配的管线对象，未找到时返回 undefined
     */
    get(id) {
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
    create(input) {
        const pipelines = this.loadPipelines();
        const now = new Date().toISOString();
        const pipeline = {
            id: crypto_1.default.randomUUID(),
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
    update(id, input) {
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
        const updated = {
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
    delete(id) {
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
    setDefault(id) {
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
    validate(pipeline, availableMCPServers) {
        const errors = [];
        // 验证管线名称
        if (!pipeline.name || pipeline.name.trim() === '') {
            errors.push({ field: 'name', message: 'Pipeline name is required' });
        }
        // 验证步骤配置是否存在
        if (!pipeline.steps) {
            errors.push({ field: 'steps', message: 'Pipeline steps configuration is required' });
            return { valid: false, errors };
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
        return { valid: errors.length === 0, errors };
    }
}
exports.PipelineService = PipelineService;
//# sourceMappingURL=pipeline-service.js.map