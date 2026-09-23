/**
 * @module command-registry-service
 * @description 斜杠命令与技能的注册中心（应用自管存储，参考 DeepSeek Harness 的 commands / skills 分层）。
 *
 * 存储位置 —— 全部在应用自己的工作区内，不依赖外部 CLI 目录：
 * - `~/.ai-dev-workbench/commands/<name>.md`      用户自定义命令（扁平 .md，支持 YAML front-matter:
 *                                                 `description` / `argument-hint`）
 * - `~/.ai-dev-workbench/skills/<name>/SKILL.md`  用户技能（目录式，SKILL.md 为正文）
 *
 * 清单来源（按优先级去重，先到先得）：
 *   1. 内置命令（代码定义：compact / memory / skills / clear / help）
 *   2. 应用命令目录（commands/）
 *   3. 应用技能目录（skills/）
 *   4. 调用方传入的外部技能（仓库内置 skills/ 与各 CLI provider 扫描结果）
 *
 * 模板变量：用户命令与技能正文中的 `$ARGUMENTS` 与 `{{args}}` 会被替换为命令后输入的参数。
 */

import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';
import {extractDescription} from '../utils/markdown-utils.js';

/** 条目类别：斜杠命令 / 技能 */
export type CommandKind = 'command' | 'skill';

/** 条目来源（前端分组与来源徽标用） */
export type CommandSource = 'builtin' | 'app-command' | 'app-skill' | 'builtin-skill' | 'provider-skill';

/** 命令/技能清单条目 */
export interface CommandEntry {
    name: string;
    description: string;
    /** 参数提示（如 `[list | add <内容>]`） */
    argsHint?: string;
    kind: CommandKind;
    source: CommandSource;
    /** 技能/命令的文件路径（需要读取正文注入时使用） */
    filePath?: string;
}

/** 清单分组（前端按组渲染：命令组 + 技能组） */
export interface CommandGroup {
    source: 'command' | 'skill';
    items: CommandEntry[];
}

/** 外部技能（来自仓库内置 skills/ 或 CLI provider 扫描） */
export interface ExternalSkill {
    name: string;
    description: string;
    filePath: string;
    source?: string;
}

/** 内置命令：由应用代码提供实现（见 command-dispatch） */
export const BUILTIN_COMMANDS: ReadonlyArray<CommandEntry> = [
    {
        name: 'compact',
        kind: 'command',
        source: 'builtin',
        description: '压缩当前会话上下文：摘要历史并开启新会话，释放上下文窗口',
        argsHint: '[补充说明]',
    },
    {
        name: 'memory',
        kind: 'command',
        source: 'builtin',
        description: '记忆：查看 / 新增 / 检索项目记忆与用户画像',
        argsHint: '[list | add <内容> | search <关键词>]',
    },
    {
        name: 'skills',
        kind: 'command',
        source: 'builtin',
        description: '列出所有可用技能',
        argsHint: '',
    },
    {
        name: 'clear',
        kind: 'command',
        source: 'builtin',
        description: '清空当前执行的日志显示（不影响会话上下文）',
        argsHint: '',
    },
    {
        name: 'help',
        kind: 'command',
        source: 'builtin',
        description: '列出全部命令与技能',
        argsHint: '',
    },
];

/** 名称合法化（仅字母数字连字符下划线，与技能页保持一致） */
export function sanitizeCommandName(name: string): string {
    return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
}

/** 从 front-matter 读取 `argument-hint`（缺失返回 undefined） */
function extractArgsHint(content: string): string | undefined {
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return undefined;
    const hit = fm[1].match(/^argument-hint:\s*(.+)$/m);
    if (!hit) return undefined;
    const value = hit[1].trim().replace(/^["']|["']$/g, '');
    return value || undefined;
}

/**
 * 命令与技能注册中心
 */
export class CommandRegistryService {
    /** 用户命令目录 */
    private readonly commandsDir: string;
    /** 用户技能目录 */
    private readonly skillsDir: string;

    constructor(commandsDir?: string, skillsDir?: string) {
        this.commandsDir = commandsDir ?? path.join(APP_DATA_DIR, 'commands');
        this.skillsDir = skillsDir ?? path.join(APP_DATA_DIR, 'skills');
    }

    /** 命令目录（设置页/文档展示用） */
    getCommandsDir(): string {
        return this.commandsDir;
    }

    /** 技能目录 */
    getSkillsDir(): string {
        return this.skillsDir;
    }

    /** 确保两个目录存在（首次使用时创建，便于用户直接往里放文件） */
    ensureDirs(): void {
        for (const dir of [this.commandsDir, this.skillsDir]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
        }
    }

    /** 扫描用户命令目录（扁平 .md） */
    listAppCommands(): CommandEntry[] {
        const out: CommandEntry[] = [];
        if (!fs.existsSync(this.commandsDir)) return out;
        for (const entry of fs.readdirSync(this.commandsDir, {withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
            const filePath = path.join(this.commandsDir, entry.name);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                out.push({
                    name: entry.name.replace(/\.md$/, ''),
                    description: extractDescription(content),
                    argsHint: extractArgsHint(content),
                    kind: 'command',
                    source: 'app-command',
                    filePath,
                });
            } catch { /* 跳过不可读文件 */ }
        }
        return out;
    }

    /** 扫描用户技能目录（<name>/SKILL.md 与根目录 .md 两种布局） */
    listAppSkills(): CommandEntry[] {
        const out: CommandEntry[] = [];
        if (!fs.existsSync(this.skillsDir)) return out;
        for (const entry of fs.readdirSync(this.skillsDir, {withFileTypes: true})) {
            try {
                if (entry.isDirectory()) {
                    const md = path.join(this.skillsDir, entry.name, 'SKILL.md');
                    if (!fs.existsSync(md)) continue;
                    const content = fs.readFileSync(md, 'utf-8');
                    out.push({
                        name: entry.name,
                        description: extractDescription(content),
                        argsHint: extractArgsHint(content),
                        kind: 'skill',
                        source: 'app-skill',
                        filePath: md,
                    });
                } else if (entry.isFile() && entry.name.endsWith('.md')) {
                    const filePath = path.join(this.skillsDir, entry.name);
                    const content = fs.readFileSync(filePath, 'utf-8');
                    out.push({
                        name: entry.name.replace(/\.md$/, ''),
                        description: extractDescription(content),
                        argsHint: extractArgsHint(content),
                        kind: 'skill',
                        source: 'app-skill',
                        filePath,
                    });
                }
            } catch { /* 跳过不可读项 */ }
        }
        return out;
    }

    /**
     * 汇总清单：内置命令 → 用户命令 → 用户技能 → 外部技能（按 name 去重，先到先得）。
     * @param externalSkills - 仓库内置技能与各 CLI provider 技能
     * @returns 按类别分好的两组（命令组在前）
     */
    list(externalSkills: ExternalSkill[] = []): CommandGroup[] {
        const seen = new Set<string>();
        const commands: CommandEntry[] = [];
        const skills: CommandEntry[] = [];

        const push = (entry: CommandEntry): void => {
            if (!entry.name || seen.has(entry.name)) return;
            seen.add(entry.name);
            (entry.kind === 'skill' ? skills : commands).push(entry);
        };

        for (const c of BUILTIN_COMMANDS) push({...c});
        for (const c of this.listAppCommands()) push(c);
        for (const s of this.listAppSkills()) push(s);
        for (const s of externalSkills) {
            push({
                name: s.name,
                description: s.description,
                kind: 'skill',
                source: s.source === 'builtin' ? 'builtin-skill' : 'provider-skill',
                filePath: s.filePath,
            });
        }

        const byName = (a: CommandEntry, b: CommandEntry): number => a.name.localeCompare(b.name);
        return [
            {source: 'command', items: commands.sort(byName)},
            {source: 'skill', items: skills.sort(byName)},
        ];
    }

    /** 按名字查找条目（含外部技能） */
    find(name: string, externalSkills: ExternalSkill[] = []): CommandEntry | undefined {
        for (const group of this.list(externalSkills)) {
            const hit = group.items.find(item => item.name === name);
            if (hit) return hit;
        }
        return undefined;
    }

    /** 读取条目正文（技能/命令注入用） */
    readContent(entry: CommandEntry): string | undefined {
        if (!entry.filePath) return undefined;
        try {
            return fs.readFileSync(entry.filePath, 'utf-8');
        } catch {
            return undefined;
        }
    }
}

/**
 * 模板渲染：把 `$ARGUMENTS` 与 `{{args}}` 替换为命令参数。
 * 参数为空时保留原文（不产生空占位）。
 */
export function renderCommandTemplate(content: string, args: string): string {
    if (!content) return content;
    const trimmed = args.trim();
    return content
        .replace(/\$ARGUMENTS/g, trimmed)
        .replace(/\{\{\s*args\s*\}\}/g, trimmed);
}
