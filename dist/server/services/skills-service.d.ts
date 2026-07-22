/**
 * @file Claude 技能管理服务
 * @description 提供对 Claude Code 技能（Skills / Slash Commands）的扫描、读取、创建、更新和删除能力。
 *   技能以 Markdown 文件的形式存储在用户主目录下的两个位置：
 *   - ~/.claude/commands/ - 全局自定义命令（扁平结构，每个 .md 文件为一个技能）
 *   - ~/.claude/skills/ - 技能目录（支持子目录结构，每个子目录为一个技能）
 *   该服务会同时扫描两个目录，合并返回所有可用的技能列表。
 */
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
/**
 * 技能管理服务类
 * @description 提供技能的完整生命周期管理，包括：
 *   - 扫描：同时从 commands/ 和 skills/ 两个目录发现技能
 *   - 读取：获取技能的完整内容和元信息
 *   - 创建/更新：在 commands/ 目录下创建或修改 .md 文件
 *   - 删除：移除指定技能的 .md 文件
 */
export declare class SkillsService {
    /** 全局命令目录路径 */
    private commandsDir;
    /** 技能目录路径 */
    private skillsDir;
    /**
     * 构造函数
     * @param commandsDir - 可选的自定义命令目录路径，默认为 ~/.claude/commands
     * @param skillsDir - 可选的自定义技能目录路径，默认为 ~/.claude/skills
     */
    constructor(commandsDir?: string, skillsDir?: string);
    /**
     * 确保命令目录存在
     * @description 如果目录不存在则递归创建
     */
    private ensureCommandsDir;
    /**
     * 从文件名推导技能名称
     * @description 移除 .md 文件扩展名，得到技能名称
     * @param filename - 文件名（如 "my-skill.md"）
     * @returns 技能名称（如 "my-skill"）
     */
    private fileNameToSkillName;
    /**
     * 列出所有可用技能
     * @description 同时扫描 commands/ 和 skills/ 两个目录：
     *   - commands/ 目录：直接读取其中的 .md 文件
     *   - skills/ 目录：读取子目录中的 .md 文件（优先 index.md），
     *     同时也支持直接放置在 skills/ 根目录下的 .md 文件
     * @returns 合并后的技能列表
     */
    list(): Skill[];
    /** 委托到 skill-utils.findSkillMdFile */
    private findSkillMdFile;
    /**
     * 获取指定技能的完整详情（包括内容）
     * @description 同时搜索 commands/ 和 skills/ 两个目录
     * @param name - 技能名称
     * @returns 技能详情对象，未找到时返回 undefined
     */
    get(name: string): SkillDetail | undefined;
    /**
     * 创建新技能
     * @description 在 commands/ 目录下创建新的 .md 文件。
     *   技能名称会被清理：仅允许字母、数字、连字符和下划线，其他字符替换为连字符。
     * @param name - 技能名称
     * @param content - 技能的 Markdown 内容
     * @returns 创建后的技能详情对象
     * @throws 当名称为空、内容为空或同名技能已存在时抛出错误
     */
    create(name: string, content: string): SkillDetail;
    /**
     * 更新现有技能的内容
     * @description 仅更新 commands/ 目录下的技能文件内容
     * @param name - 技能名称
     * @param content - 新的 Markdown 内容
     * @returns 更新后的技能详情对象
     * @throws 当内容为空或技能不存在时抛出错误
     */
    update(name: string, content: string): SkillDetail;
    /**
     * 删除指定技能
     * @description 仅删除 commands/ 目录下的技能文件
     * @param name - 技能名称
     * @returns 是否删除成功（false 表示技能不存在）
     */
    delete(name: string): boolean;
}
//# sourceMappingURL=skills-service.d.ts.map