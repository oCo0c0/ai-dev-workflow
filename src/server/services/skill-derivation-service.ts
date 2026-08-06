/**
 * @module skill-derivation-service
 * @description 技能自动沉淀服务（LLM 驱动）
 *
 * 订阅 analytics:pattern 事件，从真实执行证据（execution / agent-execution 日志）中
 * 调用 LLM 提炼可复用技能，保存为 ~/.claude/commands/auto-derived-*.md。
 * 提供 Curator 功能：清理冗余、过期、低效的自动生成技能。
 * 自动触发与手动 API（POST /api/skills/derive）共用 deriveFromAnalytics 入口。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {eventBus} from '../event-bus.js';
import type {AnalyticsService, PatternEventData} from './analytics-service.js';
import type {AnalyticsStoreService} from './analytics-store-service.js';
import type {SkillsService} from './skills-service.js';
import type {ExecutionStoreService} from './execution-store-service.js';
import type {AgentExecutionStore} from './agent-execution-store.js';
import type {AgentExecution} from '../../types/agent-execution.js';
import type {CLIRunnerService} from './cli-runner-service.js';
import type {MemoryService} from './memory/memory-service.js';
import {getErrorMessage} from '../utils/error-utils.js';
import {renderPrompt} from '../utils/prompt-renderer.js';
import {enrichPrompt} from '../utils/prompt-enrichment.js';
import {runBridgeJson} from '../utils/bridge-json-runner.js';
import {validateShape, type FieldSpec} from '../utils/json-validator.js';
import {parseFrontMatter} from '../utils/structured-json.js';
import {DERIVE_SKILL_PROMPT} from '../prompts/derivation.js';

/** 自动生成技能的文件名前缀 */
const AUTO_PREFIX = 'auto-derived-';
/** Claude 命令目录 */
const COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');
/** 同一组 analyticsIds 的去重窗口（毫秒），防止事件风暴 */
const DEDUP_WINDOW_MS = 60 * 1000;
/** 证据文本总上限（字符），超出从中间截断 */
const EVIDENCE_CAP = 8000;

/** 技能提炼结果 schema */
const DERIVATION_FIELD_SPEC: Record<string, FieldSpec> = {
    skillName: {type: 'string', required: true, minLength: 3},
    trigger: {type: 'string', required: true, minLength: 5},
    summary: {type: 'string', required: true},
    steps: {type: 'array', required: true, minItems: 1, item: {type: 'string'}},
    checklist: {type: 'array', required: false, item: {type: 'string'}},
    confidence: {type: 'number', required: true, min: 0, max: 1},
    rationale: {type: 'string', required: false},
};

/** LLM 提炼出的技能结构 */
interface DerivedSkill {
    skillName: string;
    trigger: string;
    summary: string;
    steps: string[];
    checklist?: string[];
    confidence: number;
    rationale?: string;
}

/** 手动触发 / 自动触发的统一返回结构 */
export interface DeriveResult {
    ok: boolean;
    skillName?: string;
    error?: string;
}

/**
 * 技能自动沉淀服务
 */
export class SkillDerivationService {
    private analyticsService: AnalyticsService;
    private skillsService: SkillsService;
    private analyticsStore: AnalyticsStoreService;
    private cliRunner: CLIRunnerService;
    private executionStore: ExecutionStoreService;
    private agentExecutionStore: AgentExecutionStore;
    private memoryService: MemoryService | undefined;
    /** 进程内去重：analyticsIds 组合 → 上次提炼时间戳 */
    private lastDerivedAt = new Map<string, number>();

    constructor(
        analyticsService: AnalyticsService,
        skillsService: SkillsService,
        analyticsStore: AnalyticsStoreService,
        cliRunner: CLIRunnerService,
        executionStore: ExecutionStoreService,
        agentExecutionStore: AgentExecutionStore,
        memoryService?: MemoryService,
    ) {
        this.analyticsService = analyticsService;
        this.skillsService = skillsService;
        this.analyticsStore = analyticsStore;
        this.cliRunner = cliRunner;
        this.executionStore = executionStore;
        this.agentExecutionStore = agentExecutionStore;
        this.memoryService = memoryService;
        this.registerListeners();
    }

    private registerListeners(): void {
        eventBus.onEvent('analytics:pattern', (data: unknown) => this.handlePattern(data));
    }

    /**
     * 处理模式事件
     */
    private handlePattern(data: unknown): void {
        try {
            const pattern = data as PatternEventData;
            if (!pattern?.pattern) return;

            switch (pattern.pattern) {
                case 'recovery-insight':
                    void this.deriveFromAnalytics(pattern.analyticsIds, pattern.workspacePath, pattern.pattern);
                    break;
                case 'repeated-failure':
                    // 不自动生成技能，仅记录。可未来扩展为通知用户
                    console.log(`[skill-derivation] repeated-failure detected in ${pattern.workspacePath}: ${pattern.description}`);
                    break;
                case 'skill-ineffective':
                    // 不自动生成技能，记录后由 Curator 处理
                    break;
            }
        } catch (err) {
            console.error(`[skill-derivation] handlePattern error: ${getErrorMessage(err)}`);
        }
    }

    /**
     * 从 analytics 记录提炼技能（自动触发与手动 API 共用入口）。
     *
     * @param analyticsIds - 相关分析记录 ID 列表（最多取前 3 条）
     * @param workspacePath - 工作区路径；缺省取第一条 analytics 记录的 workspacePath
     * @param pattern - 模式类型，默认 recovery-insight
     */
    async deriveFromAnalytics(
        analyticsIds: string[],
        workspacePath?: string,
        pattern: PatternEventData['pattern'] = 'recovery-insight',
    ): Promise<DeriveResult> {
        if (!Array.isArray(analyticsIds) || analyticsIds.length === 0) {
            return {ok: false, error: 'analyticsIds 不能为空'};
        }

        // 去重：同一组 analyticsIds 在窗口内只提炼一次
        const dedupKey = analyticsIds.join('-');
        const lastAt = this.lastDerivedAt.get(dedupKey) ?? 0;
        if (Date.now() - lastAt < DEDUP_WINDOW_MS) {
            return {ok: false, error: '该组 analyticsIds 在去重窗口内，已跳过'};
        }
        this.lastDerivedAt.set(dedupKey, Date.now());

        // 解析 workspacePath：缺省取第一条记录
        const first = this.analyticsStore.get(analyticsIds[0]);
        const ws = workspacePath || first?.workspacePath || '';
        if (!ws) {
            return {ok: false, error: '无法确定 workspacePath，请显式传入或先产生 analytics 记录'};
        }

        try {
            const evidence = await this.buildDerivationContext(analyticsIds);
            if (!evidence) {
                return {ok: false, error: '未找到可用的执行证据（analytics 记录不存在）'};
            }

            const promptText = enrichPrompt(
                renderPrompt(DERIVE_SKILL_PROMPT, {pattern, workspacePath: ws, evidence}),
                this.memoryService,
                ws,
            );

            const result = await runBridgeJson<DerivedSkill>({
                cliRunner: this.cliRunner,
                prompt: promptText,
                cwd: ws,
                maxTurns: 20,
                maxRetries: 2,
                validator: (value) => validateShape(value, DERIVATION_FIELD_SPEC),
            });

            if (!result.ok || !result.data) {
                console.warn(`[skill-derivation] derive failed: ${result.validationErrors?.join('; ') || result.error}`);
                return {ok: false, error: result.validationErrors?.join('; ') || result.error || 'LLM 提炼失败'};
            }

            const skillName = this.saveDerivedSkill(result.data, analyticsIds, pattern, ws);
            return {ok: true, skillName};
        } catch (err) {
            const msg = getErrorMessage(err);
            console.warn(`[skill-derivation] derive error: ${msg}`);
            return {ok: false, error: msg};
        }
    }

    /**
     * 组装执行证据文本：从 analyticsIds 反查 analytics → execution → agent-execution。
     * 无日志时退化为仅 analytics 摘要（confidence 交 LLM 自行判断）。
     */
    private async buildDerivationContext(analyticsIds: string[]): Promise<string> {
        const chunks: string[] = [];

        for (const id of analyticsIds.slice(0, 3)) {
            const analytics = this.analyticsStore.get(id);
            if (!analytics) continue;

            const header = `[phase=${analytics.phase} outcome=${analytics.outcome} ${analytics.timestamp}] ${analytics.failureReason ?? ''}`.trim();
            chunks.push(`### 分析记录 ${id}\n${header}`);

            // execution 路径日志（多任务路径 executionId=task.id，store 查不到则跳过）
            const exec = this.executionStore.get(analytics.executionId);
            if (exec && Array.isArray(exec.logs) && exec.logs.length > 0) {
                const logs = exec.logs.slice(-20).map(l => l.slice(0, 300)).join('\n');
                chunks.push(`执行日志（最后 20 条）:\n${logs}`);
            }

            // agent 路径（素材最丰富）
            const agent = await this.agentExecutionStore.get(analytics.executionId);
            if (agent) {
                chunks.push(this.formatAgentEvidence(agent));
            }
        }

        const joined = chunks.join('\n\n---\n\n');
        if (joined.length <= EVIDENCE_CAP) return joined;
        // 超出上限：从中间截断，保留头尾
        return joined.slice(0, EVIDENCE_CAP / 2) + '\n...[证据过长已截断]...\n' + joined.slice(-EVIDENCE_CAP / 2);
    }

    /** 格式化 Agent 执行证据 */
    private formatAgentEvidence(agent: AgentExecution): string {
        const lines: string[] = [];
        if (agent.requirementText) lines.push(`需求：${agent.requirementText.slice(0, 1500)}`);
        if (Array.isArray(agent.thoughts) && agent.thoughts.length > 0) {
            lines.push(`思考（最后 5 条）：\n${agent.thoughts.slice(-5).map(t => `- ${t.content.slice(0, 200)}`).join('\n')}`);
        }
        if (Array.isArray(agent.logs) && agent.logs.length > 0) {
            lines.push(`日志（最后 10 条）：\n${agent.logs.slice(-10).map(l => `- ${l.slice(0, 200)}`).join('\n')}`);
        }
        if (agent.error) lines.push(`错误：${agent.error.slice(0, 500)}`);
        return lines.join('\n');
    }

    /**
     * 保存提炼结果：确定性 hash 命名 + SkillsService 幂等覆盖。
     * @returns 技能名
     */
    private saveDerivedSkill(
        derived: DerivedSkill,
        analyticsIds: string[],
        pattern: string,
        workspacePath: string,
    ): string {
        const slug = derived.skillName.trim().replace(/[^a-zA-Z0-9_-]/g, '-');
        const hash = crypto.createHash('md5').update(analyticsIds.join('-')).digest('hex').substring(0, 8);
        const name = `${AUTO_PREFIX}${slug}-${hash}`;
        const content = this.buildSkillMarkdown(derived, pattern, workspacePath);

        try {
            this.skillsService.create(name, content);
            console.log(`[skill-derivation] created skill: ${name}`);
        } catch {
            // 同名已存在 → 用新证据覆盖（幂等更新）
            try {
                this.skillsService.update(name, content);
                console.log(`[skill-derivation] updated skill: ${name}`);
            } catch (updateErr) {
                console.warn(`[skill-derivation] save skill failed: ${getErrorMessage(updateErr)}`);
            }
        }
        return name;
    }

    /** 生成技能的 Markdown 内容（front-matter 保留 confidence: 供 Curator 解析） */
    private buildSkillMarkdown(derived: DerivedSkill, pattern: string, workspacePath: string): string {
        const date = new Date().toISOString().split('T')[0];
        const steps = derived.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
        const checklist = (derived.checklist ?? []).map(s => `- [ ] ${s}`).join('\n');

        return `---
name: ${derived.skillName}
description: ${derived.summary}
source: auto-derived
trigger: ${pattern}
confidence: ${derived.confidence}
createdAt: ${date}
workspace: ${workspacePath}
---

# ${derived.skillName}

${derived.summary}

## When to Apply
${derived.trigger}

## Steps
${steps}

${checklist ? `## Checklist\n${checklist}\n` : ''}## Rationale
${derived.rationale ?? 'Auto-derived from execution analytics.'}

## Notes
- Auto-derived via LLM from execution evidence on ${date}
- Confidence: ${derived.confidence} — review and adjust if needed
`;
    }

    /**
     * Curator：清理冗余和过期的自动生成技能
     *
     * 规则：
     * 1. confidence < 0.3 → 删除
     * 2. 超过 60 天未使用 → 删除
     *
     * @returns 清理结果
     */
    curatorReview(): CuratorResult {
        const result: CuratorResult = {deleted: 0, deactivated: 0, details: []};

        try {
            if (!fs.existsSync(COMMANDS_DIR)) return result;

            const files = fs.readdirSync(COMMANDS_DIR)
                .filter(f => f.startsWith(AUTO_PREFIX) && f.endsWith('.md'));

            const now = Date.now();
            const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 天

            for (const file of files) {
                const filePath = path.join(COMMANDS_DIR, file);
                const stat = fs.statSync(filePath);

                // 规则 2: 超过 60 天
                if (now - stat.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(filePath);
                    result.deleted++;
                    result.details.push(`Deleted old skill: ${file}`);
                    continue;
                }

                // 规则 1: confidence < 0.3（用 parseFrontMatter 解析 front-matter）
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const fm = parseFrontMatter(content);
                    if (fm.confidence) {
                        const confidence = parseFloat(fm.confidence);
                        if (!Number.isNaN(confidence) && confidence < 0.3) {
                            fs.unlinkSync(filePath);
                            result.deleted++;
                            result.details.push(`Deleted low-confidence skill: ${file}`);
                        }
                    }
                } catch {
                    // 文件读取失败，跳过
                }
            }

            if (result.deleted > 0 || result.deactivated > 0) {
                console.log(`[skill-derivation] curator: deleted=${result.deleted}, deactivated=${result.deactivated}`);
            }
        } catch (err) {
            console.error(`[skill-derivation] curatorReview error: ${getErrorMessage(err)}`);
        }

        return result;
    }

    /**
     * 列出所有自动生成的技能
     */
    listAutoDerived(): string[] {
        if (!fs.existsSync(COMMANDS_DIR)) return [];
        return fs.readdirSync(COMMANDS_DIR)
            .filter(f => f.startsWith(AUTO_PREFIX) && f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
    }
}

/**
 * Curator 清理结果
 */
export interface CuratorResult {
    /** 删除的技能数量 */
    deleted: number;
    /** 停用的技能数量 */
    deactivated: number;
    /** 操作详情 */
    details: string[];
}
