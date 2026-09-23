/**
 * @module command-dispatch-service
 * @description 斜杠命令分发 —— 把输入框里的 `/name args` 路由到对应实现（参考 DeepSeek Harness 的命令语义）。
 *
 * 返回约定（调用方据此决定是否还要把消息发给模型）：
 * - `handled: true`：命令已由服务端处理完毕，**不要再发**给模型（/help /skills /memory /clear /compact）
 * - `handled: false`：按普通消息照原样发送。包含两种情况：
 *   ① 未匹配到任何命令/技能（对齐 DSH：不写日志、当普通散文处理）；
 *   ② 命中**技能或用户自定义命令** —— 前端只保留字面 `/name args`，正文由服务端在发送前
 *      按手势注入（见 skill-injection.ts），确定性因此留在服务端
 */

import {
    CommandRegistryService,
    type ExternalSkill,
} from './command-registry-service.js';
import type {MemoryService} from './memory/memory-service.js';
import type {MemoryNotesStore} from './memory/memory-notes-store.js';

/** 分发上下文：由路由按当前执行拼装 */
export interface CommandDispatchContext {
    /** 当前执行 id（compact 会话重置、日志回显用） */
    executionId?: string;
    /** 当前工作区（记忆归属、项目事实） */
    workspacePath?: string;
    /** 会话正文（compact 的摘要材料） */
    transcript?: string;
    /** 摘要器（compact）：注入后由服务层与 CLI 细节解耦 */
    summarize?: (transcript: string, instruction: string) => Promise<string>;
    /** 追加一行日志（命令结果回显到执行日志流） */
    appendLog?: (text: string) => Promise<void>;
    /** 清空日志（/clear） */
    clearLogs?: () => Promise<void>;
    /** 重置会话上下文（compact：开启新会话） */
    resetSession?: () => Promise<void>;
    /** 追加合成用户消息（compact：摘要注入下一轮） */
    appendUserMessage?: (text: string) => Promise<void>;
    /** 外部技能（仓库内置 / CLI provider 扫描结果） */
    skills?: ExternalSkill[];
}

/** 分发结果 */
export interface CommandDispatchResult {
    /** true = 命令已处理完，不要再发给模型 */
    handled: boolean;
    /** 命令回显文本（通常已写入日志） */
    message?: string;
    /** 替代原始消息发送给模型的内容（技能/自定义命令模板） */
    promptInjection?: string;
    /** 失败原因（未知命令、参数缺失等） */
    error?: string;
}

/** 解析 `/name args` */
export function parseCommandInput(input: string): {name: string; args: string} | null {
    const m = input.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (!m) return null;
    return {name: m[1], args: (m[2] ?? '').trim()};
}

/**
 * 斜杠命令分发服务
 */
export class CommandDispatchService {
    constructor(
        private readonly registry: CommandRegistryService,
        private readonly memory: MemoryService,
        private readonly notes: MemoryNotesStore,
    ) {}

    /**
     * 分发一条输入。非命令输入返回 `{handled: false}`（无注入）。
     */
    async dispatch(input: string, ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        const parsed = parseCommandInput(input.trim());
        if (!parsed) return {handled: false};

        const entry = this.registry.find(parsed.name, ctx.skills ?? []);
        if (!entry) {
            // 未匹配 → 当普通消息放行（对齐 DSH：`execute` 返回 undefined 且不写任何日志）
            return {handled: false};
        }

        if (entry.source === 'builtin') {
            return this.runBuiltin(entry.name, parsed.args, ctx);
        }

        // 技能 / 用户自定义命令：由服务端在发送前按手势注入正文（见 skill-injection.ts），
        // 前端只保留字面 `/name args` 原文，因此这里同样「放行」——
        // 确定性留在服务端，与菜单选中/手打/其它客户端走同一条路。
        return {handled: false};
    }

    /** 内置命令实现 */
    private async runBuiltin(name: string, args: string, ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        switch (name) {
            case 'help':
                return this.help(ctx);
            case 'skills':
                return this.listSkills(ctx);
            case 'memory':
                return this.memoryCommand(args, ctx);
            case 'clear':
                await ctx.clearLogs?.();
                return {handled: true, message: '已清空当前执行的日志显示'};
            case 'compact':
                return this.compact(args, ctx);
            default:
                return {handled: true, error: `内置命令 /${name} 尚未实现`};
        }
    }

    /** /help：命令与技能清单 */
    private async help(ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        const groups = this.registry.list(ctx.skills ?? []);
        const lines: string[] = ['### 可用命令与技能', ''];
        for (const group of groups) {
            lines.push(`**${group.source === 'command' ? '命令' : '技能'}**（${group.items.length}）`, '');
            for (const item of group.items) {
                lines.push(`- \`/${item.name}\`${item.argsHint ? ` ${item.argsHint}` : ''} —— ${item.description || '（无描述）'}`);
            }
            lines.push('');
        }
        const text = lines.join('\n');
        await ctx.appendLog?.(text);
        return {handled: true, message: text};
    }

    /** /skills：仅技能清单 */
    private async listSkills(ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        const skills = this.registry.list(ctx.skills ?? []).find(g => g.source === 'skill')?.items ?? [];
        const text = skills.length === 0
            ? '暂无可用技能。可在 `~/.ai-dev-workbench/skills/<名称>/SKILL.md` 放置技能文件。'
            : ['**可用技能**', '', ...skills.map(s => `- \`/${s.name}\` —— ${s.description || '（无描述）'}`)].join('\n');
        await ctx.appendLog?.(text);
        return {handled: true, message: text};
    }

    /** /memory：记忆查看 / 新增 / 检索 */
    private async memoryCommand(args: string, ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        const [sub, ...rest] = args.split(/\s+/).filter(Boolean);
        const workspacePath = ctx.workspacePath ?? '';

        if (sub === 'add' || sub === 'remember') {
            const content = rest.join(' ').trim();
            if (!content) {
                return this.reply(ctx, '用法：`/memory add <要记住的内容>`');
            }
            const note = this.notes.add(content, workspacePath, 'manual');
            return this.reply(ctx, `✅ 已记住（${note.id.slice(0, 8)}）：${content}`);
        }

        if (sub === 'search') {
            const keyword = rest.join(' ').trim();
            if (!keyword) return this.reply(ctx, '用法：`/memory search <关键词>`');
            const notes = this.notes.search(keyword, workspacePath);
            const text = notes.length === 0
                ? `未找到与「${keyword}」相关的记忆。`
                : [`**与「${keyword}」相关的记忆**（${notes.length}）`, '', ...notes.map(n => `- ${n.content}`)].join('\n');
            return this.reply(ctx, text);
        }

        // list（默认）：用户画像 + 项目事实 + 记忆笔记 + 近期反馈
        const profile = this.memory.getUserProfile();
        const facts = workspacePath ? this.memory.getProjectFacts(workspacePath) : undefined;
        const notes = this.notes.listFor(workspacePath).slice(0, 10);
        const feedback = this.memory.getFeedbackLog(5);

        const lines: string[] = ['### 记忆概览', ''];
        lines.push('**记忆笔记**（`/memory add <内容>` 新增）');
        lines.push(...(notes.length > 0 ? notes.map(n => `- ${n.content}`) : ['- （空）']));
        lines.push('');
        lines.push('**用户画像**');
        lines.push(`- 语言：${profile.language || '未记录'}`);
        lines.push(`- 缩进：${profile.codingStyle.indentStyle ?? '未记录'}${profile.codingStyle.indentSize ? ` ${profile.codingStyle.indentSize}` : ''}`);
        lines.push(`- 常用模式：${profile.preferredPatterns.length > 0 ? profile.preferredPatterns.join('、') : '未记录'}`);
        lines.push('');
        if (facts) {
            lines.push('**项目事实**（自动收集）');
            lines.push(`- 技术栈：${facts.techStack.join('、') || '未知'}`);
            lines.push(`- 测试框架：${facts.testFrameworks.join('、') || '未知'}`);
            lines.push(`- 构建工具：${facts.buildTool || '未知'}`);
            lines.push('');
        }
        if (feedback.length > 0) {
            lines.push('**近期反馈**');
            lines.push(...feedback.map(f => `- [${f.category}] ${f.userCorrection.slice(0, 120)}`));
        }
        return this.reply(ctx, lines.join('\n'));
    }

    /** /compact：摘要会话 → 存入记忆 → 重置会话 → 摘要注入下一轮 */
    private async compact(args: string, ctx: CommandDispatchContext): Promise<CommandDispatchResult> {
        const transcript = (ctx.transcript ?? '').trim();
        if (!transcript) {
            return this.reply(ctx, '⚠️ 没有可压缩的会话内容（当前执行还没有对话历史）。');
        }
        if (!ctx.summarize) {
            return this.reply(ctx, '⚠️ 摘要能力不可用（无法调用模型）。');
        }
        await ctx.appendLog?.('🗜 正在压缩上下文…');
        let summary: string;
        try {
            summary = await ctx.summarize(transcript, args);
        } catch (err) {
            const msg = `⚠️ 压缩失败：${err instanceof Error ? err.message : String(err)}`;
            await ctx.appendLog?.(msg);
            return {handled: true, error: msg};
        }
        if (!summary.trim()) {
            const msg = '⚠️ 摘要为空，未执行压缩。';
            await ctx.appendLog?.(msg);
            return {handled: true, error: msg};
        }

        // 摘要作为合成用户消息落到日志：协调器下一轮会把它带进新会话的起始 prompt
        await ctx.appendUserMessage?.(`[此前对话摘要]\n${summary}`);
        // 同时存入记忆笔记，便于日后检索
        this.notes.add(summary, ctx.workspacePath ?? '', 'compact');
        await ctx.resetSession?.();

        const msg = `🗜 上下文已压缩：摘要 ${summary.length} 字，已开启新会话（摘要将在下一轮作为上下文注入）。`;
        await ctx.appendLog?.(msg);
        return {handled: true, message: msg};
    }

    /** 统一回显 */
    private async reply(ctx: CommandDispatchContext, text: string): Promise<CommandDispatchResult> {
        await ctx.appendLog?.(text);
        return {handled: true, message: text};
    }
}
