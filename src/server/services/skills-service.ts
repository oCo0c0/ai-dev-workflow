/**
 * @file Claude 技能管理服务
 * @description 提供对 Claude Code 技能（Skills / Slash Commands）的扫描、读取、创建、更新和删除能力。
 *   技能以 Markdown 文件的形式存储在用户主目录下的两个位置：
 *   - ~/.claude/commands/ - 全局自定义命令（扁平结构，每个 .md 文件为一个技能）
 *   - ~/.claude/skills/ - 技能目录（支持子目录结构，每个子目录为一个技能）
 *   该服务会同时扫描两个目录，合并返回所有可用的技能列表。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * 技能基本信息接口
 * @description 表示一个 Claude 技能的摘要信息，用于列表展示
 */
export interface Skill {
    /** 技能名称（对应文件名或目录名） */
    name: string;
    /** 技能描述（从文件内容中自动提取的第一行非空文本） */
    description: string;
    /** 技能是否启用（当前版本始终为 true） */
    enabled: boolean;
    /** 技能文件的完整路径 */
    filePath: string;
    /** 是否为自动生成的技能 */
    isAutoDerived?: boolean;
}

/**
 * 技能详细信息接口
 * @description 继承 Skill，包含技能的完整 Markdown 文件内容
 */
export interface SkillDetail extends Skill {
    /** 技能的完整 Markdown 内容 */
    content: string;
}

/** Claude 配置根目录 */
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
/** 全局命令目录，存放扁平结构的 .md 命令文件 */
const COMMANDS_DIR = path.join(CLAUDE_DIR, 'commands');
/** 技能目录，支持子目录结构 */
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills');

/**
 * 技能管理服务类
 * @description 提供技能的完整生命周期管理，包括：
 *   - 扫描：同时从 commands/ 和 skills/ 两个目录发现技能
 *   - 读取：获取技能的完整内容和元信息
 *   - 创建/更新：在 commands/ 目录下创建或修改 .md 文件
 *   - 删除：移除指定技能的 .md 文件
 */
export class SkillsService {
    /** 全局命令目录路径 */
    private commandsDir: string;
    /** 技能目录路径 */
    private skillsDir: string;

    /**
     * 构造函数
     * @param commandsDir - 可选的自定义命令目录路径，默认为 ~/.claude/commands
     * @param skillsDir - 可选的自定义技能目录路径，默认为 ~/.claude/skills
     */
    constructor(commandsDir?: string, skillsDir?: string) {
        this.commandsDir = commandsDir ?? COMMANDS_DIR;
        this.skillsDir = skillsDir ?? SKILLS_DIR;
    }

    /**
     * 确保命令目录存在
     * @description 如果目录不存在则递归创建
     */
    private ensureCommandsDir(): void {
        if (!fs.existsSync(this.commandsDir)) {
            fs.mkdirSync(this.commandsDir, {recursive: true});
        }
    }

    /**
     * 从技能文件内容中提取描述信息
     * @description 优先使用第一个非空的非标题行作为描述；
     *   如果第一个有意义的行就是 Markdown 标题，则使用标题文本。
     *   描述文本超过 100 个字符时自动截断并添加省略号。
     * @param content - 技能的 Markdown 文件内容
     * @returns 提取的描述文本，无法提取时返回空字符串
     */
    private extractDescription(content: string): string {
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // 跳过 Markdown 标题行，使用第一个非标题内容行
            if (trimmed && !trimmed.startsWith('#')) {
                return trimmed.length > 100 ? trimmed.substring(0, 100) + '...' : trimmed;
            }
            // 如果第一个有意义的行是标题，使用标题文本
            if (trimmed.startsWith('#')) {
                const headerText = trimmed.replace(/^#+\s*/, '');
                return headerText.length > 100 ? headerText.substring(0, 100) + '...' : headerText;
            }
        }
        return '';
    }

    /**
     * 从文件名推导技能名称
     * @description 移除 .md 文件扩展名，得到技能名称
     * @param filename - 文件名（如 "my-skill.md"）
     * @returns 技能名称（如 "my-skill"）
     */
    private fileNameToSkillName(filename: string): string {
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
    list(): Skill[] {
        const skills: Skill[] = [];

        // 扫描 commands/ 目录中的 .md 文件
        if (fs.existsSync(this.commandsDir)) {
            try {
                const entries = fs.readdirSync(this.commandsDir, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        const filePath = path.join(this.commandsDir, entry.name);
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: this.fileNameToSkillName(entry.name),
                                description: this.extractDescription(content),
                                enabled: true,
                                filePath,
                                isAutoDerived: entry.name.startsWith('auto-derived-'),
                            });
                        } catch {
                            // 跳过无法读取的文件
                        }
                    }
                }
            } catch {
                // 忽略目录读取错误
            }
        }

        // 扫描 skills/ 目录（子目录结构和根目录 .md 文件）
        if (fs.existsSync(this.skillsDir)) {
            try {
                const entries = fs.readdirSync(this.skillsDir, {withFileTypes: true});
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        // 子目录模式：每个子目录代表一个技能
                        const skillDir = path.join(this.skillsDir, entry.name);
                        const mdFile = this.findSkillMdFile(skillDir);
                        if (mdFile) {
                            try {
                                const content = fs.readFileSync(mdFile, 'utf-8');
                                skills.push({
                                    name: entry.name,
                                    description: this.extractDescription(content),
                                    enabled: true,
                                    filePath: mdFile,
                                });
                            } catch {
                                // 跳过
                            }
                        }
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        // 根目录 .md 文件模式：与 commands/ 相同的处理方式
                        const filePath = path.join(this.skillsDir, entry.name);
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            skills.push({
                                name: this.fileNameToSkillName(entry.name),
                                description: this.extractDescription(content),
                                enabled: true,
                                filePath,
                                isAutoDerived: entry.name.startsWith('auto-derived-'),
                            });
                        } catch {
                            // 跳过
                        }
                    }
                }
            } catch {
                // 忽略目录读取错误
            }
        }

        return skills;
    }

    /**
     * 在技能子目录中查找主要的 .md 文件
     * @description 优先查找 SKILL.md（Claude Code 标准入口），其次 index.md，再次第一个 .md 文件
     * @param dirPath - 技能子目录的完整路径
     * @returns 找到的 .md 文件完整路径，未找到时返回 null
     */
    private findSkillMdFile(dirPath: string): string | null {
        try {
            const files = fs.readdirSync(dirPath);
            // 优先使用 SKILL.md（Claude Code 标准技能入口）
            const skillMd = files.find(f => f === 'SKILL.md');
            if (skillMd) return path.join(dirPath, skillMd);
            // 其次使用 index.md
            const indexMd = files.find(f => f === 'index.md');
            if (indexMd) return path.join(dirPath, indexMd);
            // 最后使用第一个 .md 文件
            const firstMd = files.find(f => f.endsWith('.md'));
            if (firstMd) return path.join(dirPath, firstMd);
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 获取指定技能的完整详情（包括内容）
     * @description 同时搜索 commands/ 和 skills/ 两个目录
     * @param name - 技能名称
     * @returns 技能详情对象，未找到时返回 undefined
     */
    get(name: string): SkillDetail | undefined {
        // 1. 搜索 commands/ 目录（扁平 .md 文件）
        const commandFile = path.join(this.commandsDir, `${name}.md`);
        if (fs.existsSync(commandFile)) {
            try {
                const content = fs.readFileSync(commandFile, 'utf-8');
                return {
                    name,
                    description: this.extractDescription(content),
                    enabled: true,
                    filePath: commandFile,
                    content,
                };
            } catch {
                // 继续搜索 skills/ 目录
            }
        }

        // 2. 搜索 skills/ 目录（子目录结构）
        const skillDir = path.join(this.skillsDir, name);
        if (fs.existsSync(skillDir)) {
            try {
                const stat = fs.statSync(skillDir);
                if (stat.isDirectory()) {
                    const mdFile = this.findSkillMdFile(skillDir);
                    if (mdFile) {
                        const content = fs.readFileSync(mdFile, 'utf-8');
                        return {
                            name,
                            description: this.extractDescription(content),
                            enabled: true,
                            filePath: mdFile,
                            content,
                        };
                    }
                }
            } catch {
                // 忽略
            }
        }

        // 3. 搜索 skills/ 根目录的 .md 文件
        const skillFile = path.join(this.skillsDir, `${name}.md`);
        if (fs.existsSync(skillFile)) {
            try {
                const content = fs.readFileSync(skillFile, 'utf-8');
                return {
                    name,
                    description: this.extractDescription(content),
                    enabled: true,
                    filePath: skillFile,
                    content,
                };
            } catch {
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
    create(name: string, content: string): SkillDetail {
        if (!name || name.trim() === '') {
            throw new Error('Skill name is required');
        }

        if (!content || content.trim() === '') {
            throw new Error('Skill content cannot be empty');
        }

        // 清理技能名称：仅保留字母、数字、连字符和下划线
        const sanitizedName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
        const filePath = path.join(this.commandsDir, `${sanitizedName}.md`);

        if (fs.existsSync(filePath)) {
            throw new Error(`Skill "${sanitizedName}" already exists`);
        }

        this.ensureCommandsDir();
        fs.writeFileSync(filePath, content, 'utf-8');

        return {
            name: sanitizedName,
            description: this.extractDescription(content),
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
    update(name: string, content: string): SkillDetail {
        if (!content || content.trim() === '') {
            throw new Error('Skill content cannot be empty');
        }

        const filePath = path.join(this.commandsDir, `${name}.md`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Skill "${name}" not found`);
        }

        fs.writeFileSync(filePath, content, 'utf-8');

        return {
            name,
            description: this.extractDescription(content),
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
    delete(name: string): boolean {
        const filePath = path.join(this.commandsDir, `${name}.md`);

        if (!fs.existsSync(filePath)) {
            return false;
        }

        fs.unlinkSync(filePath);
        return true;
    }

}
