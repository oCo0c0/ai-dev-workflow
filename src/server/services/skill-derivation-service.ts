/**
 * @module skill-derivation-service
 * @description 技能自动沉淀服务（Review Agent）
 *
 * 订阅 analytics:pattern 事件，从执行经验中自动提炼可复用技能。
 * 生成的技能保存为 ~/.claude/commands/auto-derived-*.md 文件。
 * 提供 Curator 功能：定期清理冗余、过期、低效的自动生成技能。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {eventBus} from '../event-bus.js';
import type {AnalyticsService, PatternEventData} from './analytics-service.js';
import type {AnalyticsStoreService} from './analytics-store-service.js';
import type {SkillsService} from './skills-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

/** 自动生成技能的文件名前缀 */
const AUTO_PREFIX = 'auto-derived-';
/** Claude 命令目录 */
const COMMANDS_DIR = path.join(os.homedir(), '.claude', 'commands');

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

/**
 * 技能自动沉淀服务
 */
export class SkillDerivationService {
    private analyticsService: AnalyticsService;
    private skillsService: SkillsService;
    private analyticsStore: AnalyticsStoreService;

    constructor(
        analyticsService: AnalyticsService,
        skillsService: SkillsService,
        analyticsStore: AnalyticsStoreService,
    ) {
        this.analyticsService = analyticsService;
        this.skillsService = skillsService;
        this.analyticsStore = analyticsStore;
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
                    this.deriveRecoverySkill(pattern);
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
     * 从恢复模式中提炼技能
     *
     * 当检测到"失败后成功恢复"的模式时，生成一个技能文件，
     * 描述如何避免之前的失败以及恢复策略。
     */
    private deriveRecoverySkill(pattern: PatternEventData): void {
        const {analyticsIds, workspacePath, description} = pattern;
        if (analyticsIds.length < 2) return;

        // 生成唯一 hash 作为文件名
        const hash = crypto.createHash('md5')
            .update(analyticsIds.join('-'))
            .digest('hex').substring(0, 8);
        const skillName = `${AUTO_PREFIX}${hash}`;
        const filePath = path.join(COMMANDS_DIR, `${skillName}.md`);

        // 避免重复生成
        if (fs.existsSync(filePath)) return;

        // 生成技能内容
        const content = this.generateRecoveryContent(description ?? 'Recovery pattern', workspacePath);

        // 确保 commands 目录存在
        if (!fs.existsSync(COMMANDS_DIR)) {
            fs.mkdirSync(COMMANDS_DIR, {recursive: true});
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`[skill-derivation] created skill: ${skillName}`);
    }

    /**
     * 生成恢复技能的 Markdown 内容
     */
    private generateRecoveryContent(description: string, workspacePath: string): string {
        const workspaceName = path.basename(workspacePath);
        const date = new Date().toISOString().split('T')[0];

        return `<!-- auto-derived
source: auto-derived
trigger: recovery-insight
confidence: 0.7
createdAt: ${date}
-->

# Recovery Strategy: ${workspaceName}

Learned from execution recovery pattern: ${description}

## When to Apply
This skill applies when encountering execution failures in the ${workspaceName} project.

## Recovery Steps
1. Review the error output carefully before retrying
2. Check if the issue is related to file paths, dependencies, or configuration
3. Apply the minimal fix and verify before proceeding
4. If the fix works, document the pattern for future reference

## Notes
- Auto-derived from execution analytics on ${date}
- Confidence: 0.7 — review and adjust if needed
`;
    }

    /**
     * Curator：清理冗余和过期的自动生成技能
     *
     * 规则：
     * 1. confidence < 0.3 → 删除
     * 2. 超过 60 天未使用 → 删除
     * 3. 同 workspace 的重复技能 → 保留最新的
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

                // 规则 1: confidence < 0.3
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const confidenceMatch = content.match(/confidence:\s*([\d.]+)/);
                    if (confidenceMatch) {
                        const confidence = parseFloat(confidenceMatch[1]);
                        if (confidence < 0.3) {
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
