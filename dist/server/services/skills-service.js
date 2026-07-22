"use strict";
/**
 * @file Claude 技能管理服务
 * @description 提供对 Claude Code 技能（Skills / Slash Commands）的扫描、读取、创建、更新和删除能力。
 *   技能以 Markdown 文件的形式存储在用户主目录下的两个位置：
 *   - ~/.claude/commands/ - 全局自定义命令（扁平结构，每个 .md 文件为一个技能）
 *   - ~/.claude/skills/ - 技能目录（支持子目录结构，每个子目录为一个技能）
 *   该服务会同时扫描两个目录，合并返回所有可用的技能列表。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const markdown_utils_js_1 = require("../utils/markdown-utils.js");
const skill_utils_js_1 = require("../utils/skill-utils.js");
/** Claude 配置根目录 */
const CLAUDE_DIR = path_1.default.join(os_1.default.homedir(), '.claude');
/** 全局命令目录，存放扁平结构的 .md 命令文件 */
const COMMANDS_DIR = path_1.default.join(CLAUDE_DIR, 'commands');
/** 技能目录，支持子目录结构 */
const SKILLS_DIR = path_1.default.join(CLAUDE_DIR, 'skills');
/**
 * 技能管理服务类
 * @description 提供技能的完整生命周期管理，包括：
 *   - 扫描：同时从 commands/ 和 skills/ 两个目录发现技能
 *   - 读取：获取技能的完整内容和元信息
 *   - 创建/更新：在 commands/ 目录下创建或修改 .md 文件
 *   - 删除：移除指定技能的 .md 文件
 */
class SkillsService {
    /** 全局命令目录路径 */
    commandsDir;
    /** 技能目录路径 */
    skillsDir;
    /**
     * 构造函数
     * @param commandsDir - 可选的自定义命令目录路径，默认为 ~/.claude/commands
     * @param skillsDir - 可选的自定义技能目录路径，默认为 ~/.claude/skills
     */
    constructor(commandsDir, skillsDir) {
        this.commandsDir = commandsDir ?? COMMANDS_DIR;
        this.skillsDir = skillsDir ?? SKILLS_DIR;
    }
    /**
     * 确保命令目录存在
     * @description 如果目录不存在则递归创建
     */
    ensureCommandsDir() {
        if (!fs_1.default.existsSync(this.commandsDir)) {
            fs_1.default.mkdirSync(this.commandsDir, { recursive: true });
        }
    }
    /**
     * 从文件名推导技能名称
     * @description 移除 .md 文件扩展名，得到技能名称
     * @param filename - 文件名（如 "my-skill.md"）
     * @returns 技能名称（如 "my-skill"）
     */
    fileNameToSkillName(filename) {
        return filename.replace(/\.md$/, '');
    }
    /**
     * 列出所有可用技能
     * @description 同时扫描 commands/ 和 skills/ 两个目录：
     *   - commands/ 目录：直接读取其中的 .md 文件
     *   - skills/ 目录：读取子目录中的 .md 文件（优先 index.md），
     *     同时也支持直接放置在 skills/ 根目录下的 .md 文件
     * @returns 合并后的技能列表
     */
    list() {
        const skills = [];
        // 扫描 commands/ 目录中的 .md 文件
        if (fs_1.default.existsSync(this.commandsDir)) {
            try {
                const entries = fs_1.default.readdirSync(this.commandsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path_1.default.join(this.commandsDir, entry.name);
                        try {
                            const content = fs_1.default.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: this.fileNameToSkillName(entry.name),
                                description: (0, markdown_utils_js_1.extractDescription)(content),
                                enabled: true,
                                filePath,
                                isAutoDerived: entry.name.startsWith('auto-derived-'),
                            });
                        }
                        catch {
                            // 跳过无法读取的文件
                        }
                    }
                }
            }
            catch {
                // 忽略目录读取错误
            }
        }
        // 扫描 skills/ 目录（子目录结构和根目录 .md 文件）
        if (fs_1.default.existsSync(this.skillsDir)) {
            try {
                const entries = fs_1.default.readdirSync(this.skillsDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        // 子目录模式：每个子目录代表一个技能
                        const skillDir = path_1.default.join(this.skillsDir, entry.name);
                        const mdFile = this.findSkillMdFile(skillDir);
                        if (mdFile) {
                            try {
                                const content = fs_1.default.readFileSync(mdFile, 'utf-8');
                                skills.push({
                                    name: entry.name,
                                    description: (0, markdown_utils_js_1.extractDescription)(content),
                                    enabled: true,
                                    filePath: mdFile,
                                });
                            }
                            catch {
                                // 跳过
                            }
                        }
                    }
                    else if (entry.isFile() && entry.name.endsWith('.md')) {
                        // 根目录 .md 文件模式：与 commands/ 相同的处理方式
                        const filePath = path_1.default.join(this.skillsDir, entry.name);
                        try {
                            const content = fs_1.default.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: this.fileNameToSkillName(entry.name),
                                description: (0, markdown_utils_js_1.extractDescription)(content),
                                enabled: true,
                                filePath,
                                isAutoDerived: entry.name.startsWith('auto-derived-'),
                            });
                        }
                        catch {
                            // 跳过
                        }
                    }
                }
            }
            catch {
                // 忽略目录读取错误
            }
        }
        return skills;
    }
    /** 委托到 skill-utils.findSkillMdFile */
    findSkillMdFile(dirPath) {
        return (0, skill_utils_js_1.findSkillMdFile)(dirPath);
    }
    /**
     * 获取指定技能的完整详情（包括内容）
     * @description 同时搜索 commands/ 和 skills/ 两个目录
     * @param name - 技能名称
     * @returns 技能详情对象，未找到时返回 undefined
     */
    get(name) {
        // 1. 搜索 commands/ 目录（扁平 .md 文件）
        const commandFile = path_1.default.join(this.commandsDir, `${name}.md`);
        if (fs_1.default.existsSync(commandFile)) {
            try {
                const content = fs_1.default.readFileSync(commandFile, 'utf-8');
                return {
                    name,
                    description: (0, markdown_utils_js_1.extractDescription)(content),
                    enabled: true,
                    filePath: commandFile,
                    content,
                };
            }
            catch {
                // 继续搜索 skills/ 目录
            }
        }
        // 2. 搜索 skills/ 目录（子目录结构）
        const skillDir = path_1.default.join(this.skillsDir, name);
        if (fs_1.default.existsSync(skillDir)) {
            try {
                const stat = fs_1.default.statSync(skillDir);
                if (stat.isDirectory()) {
                    const mdFile = this.findSkillMdFile(skillDir);
                    if (mdFile) {
                        const content = fs_1.default.readFileSync(mdFile, 'utf-8');
                        return {
                            name,
                            description: (0, markdown_utils_js_1.extractDescription)(content),
                            enabled: true,
                            filePath: mdFile,
                            content,
                        };
                    }
                }
            }
            catch {
                // 忽略
            }
        }
        // 3. 搜索 skills/ 根目录的 .md 文件
        const skillFile = path_1.default.join(this.skillsDir, `${name}.md`);
        if (fs_1.default.existsSync(skillFile)) {
            try {
                const content = fs_1.default.readFileSync(skillFile, 'utf-8');
                return {
                    name,
                    description: (0, markdown_utils_js_1.extractDescription)(content),
                    enabled: true,
                    filePath: skillFile,
                    content,
                };
            }
            catch {
                // 忽略
            }
        }
        return undefined;
    }
    /**
     * 创建新技能
     * @description 在 commands/ 目录下创建新的 .md 文件。
     *   技能名称会被清理：仅允许字母、数字、连字符和下划线，其他字符替换为连字符。
     * @param name - 技能名称
     * @param content - 技能的 Markdown 内容
     * @returns 创建后的技能详情对象
     * @throws 当名称为空、内容为空或同名技能已存在时抛出错误
     */
    create(name, content) {
        if (!name || name.trim() === '') {
            throw new Error('Skill name is required');
        }
        if (!content || content.trim() === '') {
            throw new Error('Skill content cannot be empty');
        }
        // 清理技能名称：仅保留字母、数字、连字符和下划线
        const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
        const filePath = path_1.default.join(this.commandsDir, `${sanitizedName}.md`);
        if (fs_1.default.existsSync(filePath)) {
            throw new Error(`Skill "${sanitizedName}" already exists`);
        }
        this.ensureCommandsDir();
        fs_1.default.writeFileSync(filePath, content, 'utf-8');
        return {
            name: sanitizedName,
            description: (0, markdown_utils_js_1.extractDescription)(content),
            enabled: true,
            filePath,
            content,
        };
    }
    /**
     * 更新现有技能的内容
     * @description 仅更新 commands/ 目录下的技能文件内容
     * @param name - 技能名称
     * @param content - 新的 Markdown 内容
     * @returns 更新后的技能详情对象
     * @throws 当内容为空或技能不存在时抛出错误
     */
    update(name, content) {
        if (!content || content.trim() === '') {
            throw new Error('Skill content cannot be empty');
        }
        if (!name || name.trim() === '') {
            throw new Error('Skill name is required');
        }
        // 清理技能名称：仅保留字母、数字、连字符和下划线，与 create 保持一致
        const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
        const filePath = path_1.default.join(this.commandsDir, `${sanitizedName}.md`);
        // 确保目标路径在 commandsDir 内，防止 ../ 绕过
        if (!filePath.startsWith(this.commandsDir)) {
            throw new Error(`Skill "${name}" is outside commands directory`);
        }
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`Skill "${sanitizedName}" not found`);
        }
        fs_1.default.writeFileSync(filePath, content, 'utf-8');
        return {
            name: sanitizedName,
            description: (0, markdown_utils_js_1.extractDescription)(content),
            enabled: true,
            filePath,
            content,
        };
    }
    /**
     * 删除指定技能
     * @description 仅删除 commands/ 目录下的技能文件
     * @param name - 技能名称
     * @returns 是否删除成功（false 表示技能不存在）
     */
    delete(name) {
        if (!name || name.trim() === '') {
            throw new Error('Skill name is required');
        }
        // 清理技能名称：仅保留字母、数字、连字符和下划线
        const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
        const filePath = path_1.default.join(this.commandsDir, `${sanitizedName}.md`);
        // 确保目标路径在 commandsDir 内
        if (!filePath.startsWith(this.commandsDir)) {
            throw new Error(`Skill "${name}" is outside commands directory`);
        }
        if (!fs_1.default.existsSync(filePath)) {
            return false;
        }
        fs_1.default.unlinkSync(filePath);
        return true;
    }
}
exports.SkillsService = SkillsService;
//# sourceMappingURL=skills-service.js.map