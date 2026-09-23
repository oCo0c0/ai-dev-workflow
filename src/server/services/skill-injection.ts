/**
 * @module skill-injection
 * @description 技能手势识别与正文注入（服务端，对齐 DeepSeek Harness 的 agent/pre-step 注入）。
 *
 * 设计决策（照 DSH 的结论）：
 * - **确定性放在服务端**：前端只把字面 `/name args` 写回输入框并原样发送，
 *   由服务端在「发送前」扫描用户消息里的技能手势，把技能正文作为额外上下文注入；
 *   这样菜单选中、手打、以及其它客户端（CLI/API）走的是同一条路。
 * - 只扫描**用户消息**（模型输出里的 `/xxx` 不构成手势，避免被外部文本伪造）。
 * - 命中但未知/不可用户调用的名字**按普通散文处理**（不报错、不注入）。
 * - 注入标记 `<skill_content name="…">` 与 DSH 的 renderSkillContent 形态一致。
 */

import fs from 'fs';
import path from 'path';
import {CommandRegistryService, renderCommandTemplate, type ExternalSkill} from './command-registry-service.js';
import {getAllProviders} from './cli-providers/index.js';
import {extractDescription} from '../utils/markdown-utils.js';

/** 仓库内置技能目录（项目 skills/ → 编译后 dist/skills/） */
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, '..', '..', '..', 'skills');

/**
 * 技能手势正则（DSH 同款）：`/name` 出现在行首或空白之后，且以空白或行尾结束。
 * 名称限小写字母开头、kebab/下划线风格，与 parseSlashCommand 的语法保持一致。
 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:[-_][a-z0-9]+)*)(?=\s|$)/g;

/**
 * 从一段用户消息里提取被调用的技能名（去重，保持出现顺序）。
 */
export function invokedSkillNames(text: string): string[] {
    const names: string[] = [];
    const seen = new Set<string>();
    // 每行独立扫描：多行输入里逐个匹配
    for (const line of text.split('\n')) {
        SKILL_GESTURE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SKILL_GESTURE.exec(line)) !== null) {
            const name = m[2];
            if (seen.has(name)) continue;
            seen.add(name);
            names.push(name);
        }
    }
    return names;
}

/**
 * 收集外部技能：仓库内置 skills/ + 各 CLI provider 扫描结果（按 name 去重）。
 */
export async function collectExternalSkills(): Promise<ExternalSkill[]> {
    const out: ExternalSkill[] = [];

    if (fs.existsSync(BUILTIN_SKILLS_DIR)) {
        try {
            for (const entry of fs.readdirSync(BUILTIN_SKILLS_DIR, {withFileTypes: true})) {
                if (!entry.isDirectory()) continue;
                const md = path.join(BUILTIN_SKILLS_DIR, entry.name, 'SKILL.md');
                if (!fs.existsSync(md)) continue;
                const content = fs.readFileSync(md, 'utf-8');
                out.push({name: entry.name, description: extractDescription(content), filePath: md, source: 'builtin'});
            }
        } catch { /* 内置技能目录不可读时忽略 */ }
    }

    const seen = new Set(out.map(s => s.name));
    for (const provider of getAllProviders()) {
        try {
            for (const skill of await provider.loadSkills()) {
                if (seen.has(skill.name)) continue;
                seen.add(skill.name);
                out.push({
                    name: skill.name,
                    description: skill.description,
                    filePath: skill.filePath,
                    source: skill.source ?? provider.id,
                });
            }
        } catch { /* 单个 provider 失败不影响其它 */ }
    }

    return out;
}

/** 把技能正文渲染为注入块（形态对齐 DSH 的 renderSkillContent） */
export function renderSkillBlock(name: string, content: string): string {
    return `<skill_content name="${name}">\n${content.trim()}\n</skill_content>`;
}

/**
 * 扫描用户消息里的技能手势，生成注入块。
 *
 * @param replies - 用户消息（本轮要发给模型的原文，保留 `/name args` 字面文本）
 * @param argsOverride - 命中的技能名 → 参数（未提供时用整条消息作为参数）
 * @param registry - 命令/技能注册中心（可注入测试用目录）
 * @returns 注入文本（无命中返回空串）；多个技能按出现顺序拼接
 */
export async function buildSkillInjections(
    replies: string[],
    registry: CommandRegistryService = new CommandRegistryService(),
): Promise<string> {
    const external = await collectExternalSkills();
    const blocks: string[] = [];
    const done = new Set<string>();

    for (const reply of replies) {
        for (const name of invokedSkillNames(reply)) {
            if (done.has(name)) continue;
            const entry = registry.find(name, external);
            // 未知或不可用户调用 → 当普通散文处理（不注入、不报错）
            if (!entry || entry.kind !== 'skill') continue;
            const content = registry.readContent(entry);
            if (!content) continue;
            // 参数 = 手势之后该行的剩余原文（与命令语义一致：整行剩余文本）
            const args = argsAfterGesture(reply, name);
            blocks.push(renderSkillBlock(entry.name, renderCommandTemplate(content, args)));
            done.add(entry.name);
        }
    }

    return blocks.join('\n\n');
}

/** 取某个技能手势之后的剩余原文（手柄在行中时只取手势之后的部分） */
export function argsAfterGesture(text: string, name: string): string {
    for (const line of text.split('\n')) {
        const re = new RegExp(`(^|\\s)/${name}(?=\\s|$)`);
        const m = re.exec(line);
        if (m) return line.slice(m.index + m[0].length).trim();
    }
    return '';
}
