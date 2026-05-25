"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
exports.validateConfig = validateConfig;
/**
 * @module config-service
 * @description 应用配置管理服务模块
 *
 * 该模块负责管理 AI 开发工作台的全局应用配置，包括服务器设置、Claude CLI 路径配置、
 * UI 偏好设置和默认流水线 ID 等选项。配置文件以 JSON 格式存储在用户主目录下的
 * `.ai-dev-workbench/config.json` 文件中。
 *
 * 主要功能：
 * - 加载和保存应用配置（自动处理默认值和目录创建）
 * - 配置字段的类型验证，确保配置文件的完整性
 * - 提供默认配置的访问接口
 *
 * @example
 * ```typescript
 * const configService = new ConfigService();
 * const config = configService.load();
 * config.server!.port = 3000;
 * configService.save(config);
 * ```
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
/** 配置文件完整路径 */
const CONFIG_FILE = path_1.default.join(constants_js_1.APP_DATA_DIR, 'config.json');
/**
 * 默认配置对象
 * 当配置文件不存在或首次加载时使用此默认值
 */
const DEFAULT_CONFIG = {
    server: {
        host: 'localhost',
    },
    claudeCodeCli: {
        path: 'claude',
    },
    ui: {
        theme: 'dark',
        sidebarCollapsed: false,
    },
    daytona: {
        enabled: false,
        apiUrl: 'https://app.daytona.io',
    },
    cliProvider: {
        active: 'claude',
        setupCompleted: false,
    },
    mineru: {
        enabled: true,
        apiUrl: 'http://47.116.44.130:8002',
    },
};
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
function validateConfig(config) {
    const errors = [];
    // 根对象类型检查
    if (config === null || typeof config !== 'object') {
        errors.push({ field: 'root', message: 'Config must be a non-null object' });
        return errors;
    }
    const obj = config;
    // 验证 server 配置块
    if (obj.server !== undefined) {
        if (typeof obj.server !== 'object' || obj.server === null) {
            errors.push({ field: 'server', message: 'server must be an object' });
        }
        else {
            const server = obj.server;
            // 端口号必须是 1-65535 范围内的整数
            if (server.port !== undefined && (typeof server.port !== 'number' || !Number.isInteger(server.port) || server.port < 1 || server.port > 65535)) {
                errors.push({ field: 'server.port', message: 'server.port must be an integer between 1 and 65535' });
            }
            if (server.host !== undefined && typeof server.host !== 'string') {
                errors.push({ field: 'server.host', message: 'server.host must be a string' });
            }
        }
    }
    // 验证 claudeCodeCli 配置块
    if (obj.claudeCodeCli !== undefined) {
        if (typeof obj.claudeCodeCli !== 'object' || obj.claudeCodeCli === null) {
            errors.push({ field: 'claudeCodeCli', message: 'claudeCodeCli must be an object' });
        }
        else {
            const cli = obj.claudeCodeCli;
            if (cli.path !== undefined && typeof cli.path !== 'string') {
                errors.push({ field: 'claudeCodeCli.path', message: 'claudeCodeCli.path must be a string' });
            }
        }
    }
    // 验证 ui 配置块
    if (obj.ui !== undefined) {
        if (typeof obj.ui !== 'object' || obj.ui === null) {
            errors.push({ field: 'ui', message: 'ui must be an object' });
        }
        else {
            const ui = obj.ui;
            // 主题只能是预定义的两种值
            if (ui.theme !== undefined && ui.theme !== 'dark' && ui.theme !== 'light') {
                errors.push({ field: 'ui.theme', message: 'ui.theme must be "dark" or "light"' });
            }
            if (ui.sidebarCollapsed !== undefined && typeof ui.sidebarCollapsed !== 'boolean') {
                errors.push({ field: 'ui.sidebarCollapsed', message: 'ui.sidebarCollapsed must be a boolean' });
            }
        }
    }
    // 验证默认流水线 ID
    if (obj.defaultPipelineId !== undefined && typeof obj.defaultPipelineId !== 'string') {
        errors.push({ field: 'defaultPipelineId', message: 'defaultPipelineId must be a string' });
    }
    // 验证 daytona 配置块
    if (obj.daytona !== undefined) {
        if (typeof obj.daytona !== 'object' || obj.daytona === null) {
            errors.push({ field: 'daytona', message: 'daytona must be an object' });
        }
        else {
            const daytona = obj.daytona;
            if (daytona.apiKey !== undefined && typeof daytona.apiKey !== 'string') {
                errors.push({ field: 'daytona.apiKey', message: 'daytona.apiKey must be a string' });
            }
            if (daytona.apiUrl !== undefined && typeof daytona.apiUrl !== 'string') {
                errors.push({ field: 'daytona.apiUrl', message: 'daytona.apiUrl must be a string' });
            }
            if (daytona.enabled !== undefined && typeof daytona.enabled !== 'boolean') {
                errors.push({ field: 'daytona.enabled', message: 'daytona.enabled must be a boolean' });
            }
            if (daytona.template !== undefined && typeof daytona.template !== 'string') {
                errors.push({ field: 'daytona.template', message: 'daytona.template must be a string' });
            }
            if (daytona.sandboxId !== undefined && typeof daytona.sandboxId !== 'string') {
                errors.push({ field: 'daytona.sandboxId', message: 'daytona.sandboxId must be a string' });
            }
        }
    }
    // 验证 cliProvider 配置块
    if (obj.cliProvider !== undefined) {
        if (typeof obj.cliProvider !== 'object' || obj.cliProvider === null) {
            errors.push({ field: 'cliProvider', message: 'cliProvider must be an object' });
        }
        else {
            const cliProvider = obj.cliProvider;
            if (cliProvider.active !== undefined && cliProvider.active !== 'claude' && cliProvider.active !== 'codex') {
                errors.push({ field: 'cliProvider.active', message: 'cliProvider.active must be "claude" or "codex"' });
            }
            if (cliProvider.setupCompleted !== undefined && typeof cliProvider.setupCompleted !== 'boolean') {
                errors.push({
                    field: 'cliProvider.setupCompleted',
                    message: 'cliProvider.setupCompleted must be a boolean'
                });
            }
            if (cliProvider.codex !== undefined) {
                if (typeof cliProvider.codex !== 'object' || cliProvider.codex === null) {
                    errors.push({ field: 'cliProvider.codex', message: 'cliProvider.codex must be an object' });
                }
                else {
                    const codex = cliProvider.codex;
                    if (codex.model !== undefined && typeof codex.model !== 'string') {
                        errors.push({
                            field: 'cliProvider.codex.model',
                            message: 'cliProvider.codex.model must be a string'
                        });
                    }
                }
            }
        }
    }
    // 验证 MinerU 配置块
    if (obj.mineru !== undefined) {
        if (typeof obj.mineru !== 'object' || obj.mineru === null) {
            errors.push({ field: 'mineru', message: 'mineru must be an object' });
        }
        else {
            const mineru = obj.mineru;
            if (mineru.apiUrl !== undefined && typeof mineru.apiUrl !== 'string') {
                errors.push({ field: 'mineru.apiUrl', message: 'mineru.apiUrl must be a string' });
            }
            if (mineru.enabled !== undefined && typeof mineru.enabled !== 'boolean') {
                errors.push({ field: 'mineru.enabled', message: 'mineru.enabled must be a boolean' });
            }
            if (mineru.defaultBackend !== undefined && typeof mineru.defaultBackend !== 'string') {
                errors.push({ field: 'mineru.defaultBackend', message: 'mineru.defaultBackend must be a string' });
            }
            if (mineru.defaultLangList !== undefined && !Array.isArray(mineru.defaultLangList)) {
                errors.push({ field: 'mineru.defaultLangList', message: 'mineru.defaultLangList must be an array' });
            }
        }
    }
    return errors;
}
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
class ConfigService {
    /** 配置文件所在目录的绝对路径 */
    configDir;
    /** 配置文件的绝对路径（config.json） */
    configFile;
    /**
     * 构造配置服务
     * @param configDir - 可选的自定义配置目录路径，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir) {
        this.configDir = configDir ?? constants_js_1.APP_DATA_DIR;
        this.configFile = path_1.default.join(this.configDir, 'config.json');
    }
    /**
     * 确保配置目录存在
     * 如果目录不存在，则递归创建（包括所有必要的父目录）。
     */
    ensureConfigDir() {
        if (!fs_1.default.existsSync(this.configDir)) {
            fs_1.default.mkdirSync(this.configDir, { recursive: true });
        }
    }
    /**
     * 从磁盘加载配置
     *
     * 如果配置文件不存在，则使用默认配置创建新文件并返回默认配置的副本。
     * 如果文件存在但包含无效 JSON 或验证失败，则抛出错误。
     *
     * @returns AppConfig 加载并验证通过的配置对象
     * @throws {Error} 配置文件包含无效 JSON 或验证失败时抛出
     */
    load() {
        this.ensureConfigDir();
        // 配置文件不存在时，创建默认配置文件
        if (!fs_1.default.existsSync(this.configFile)) {
            this.save(DEFAULT_CONFIG);
            return { ...DEFAULT_CONFIG }; // 返回副本，防止外部修改影响默认值
        }
        const raw = fs_1.default.readFileSync(this.configFile, 'utf-8');
        // 解析 JSON，无效格式时抛出明确错误
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch {
            throw new Error('Config file contains invalid JSON');
        }
        // 对解析后的配置进行类型验证
        const errors = validateConfig(parsed);
        if (errors.length > 0) {
            throw new Error(`Config validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
        }
        return parsed;
    }
    /**
     * 保存配置到磁盘
     *
     * 先对配置进行验证，验证通过后以格式化的 JSON 写入文件。
     * 如果验证失败，拒绝写入并抛出错误，避免将无效配置持久化。
     *
     * @param config - 要保存的配置对象
     * @throws {Error} 配置验证失败时抛出
     */
    save(config) {
        // 保存前进行验证，防止将无效数据写入磁盘
        const errors = validateConfig(config);
        if (errors.length > 0) {
            throw new Error(`Config validation failed: ${errors.map(e => `${e.field}: ${e.message}`).join('; ')}`);
        }
        this.ensureConfigDir();
        // 以 2 空格缩进的格式化 JSON 写入，便于人工阅读和版本对比
        fs_1.default.writeFileSync(this.configFile, JSON.stringify(config, null, 2), 'utf-8');
    }
    /**
     * 获取配置目录路径
     * @returns string 配置目录的绝对路径
     */
    getConfigDir() {
        return this.configDir;
    }
    /**
     * 获取配置文件路径
     * @returns string 配置文件的绝对路径
     */
    getConfigFile() {
        return this.configFile;
    }
    /**
     * 获取默认配置
     * @returns AppConfig 默认配置对象的副本（防止外部修改影响内部默认值）
     */
    getDefaultConfig() {
        return { ...DEFAULT_CONFIG };
    }
}
exports.ConfigService = ConfigService;
//# sourceMappingURL=config-service.js.map