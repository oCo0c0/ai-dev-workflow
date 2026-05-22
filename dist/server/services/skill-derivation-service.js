"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillDerivationService = void 0;
/**
 * @module skill-derivation-service
 * @description 技能自动沉淀服务（Review Agent）
 *
 * 订阅 analytics:pattern 事件，从执行经验中自动提炼可复用技能。
 * 生成的技能保存为 ~/.claude/commands/auto-derived-*.md 文件。
 * 提供 Curator 功能：定期清理冗余、过期、低效的自动生成技能。
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const event_bus_js_1 = require("../event-bus.js");
const error_utils_js_1 = require("../utils/error-utils.js");
/** 自动生成技能的文件名前缀 */
const AUTO_PREFIX = 'auto-derived-';
/** Claude 命令目录 */
const COMMANDS_DIR = path_1.default.join(os_1.default.homedir(), '.claude', 'commands');
/**
 * 技能自动沉淀服务
 */
class SkillDerivationService {
    analyticsService;
    skillsService;
    analyticsStore;
    constructor(analyticsService, skillsService, analyticsStore) {
        this.analyticsService = analyticsService;
        this.skillsService = skillsService;
        this.analyticsStore = analyticsStore;
        this.registerListeners();
    }
    registerListeners() {
        event_bus_js_1.eventBus.onEvent('analytics:pattern', (data) => this.handlePattern(data));
    }
    /**
     * 处理模式事件
     */
    handlePattern(data) {
        try {
            const pattern = data;
            if (!pattern?.pattern)
                return;
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
        }
        catch (err) {
            console.error(`[skill-derivation] handlePattern error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
    }
    /**
     * 从恢复模式中提炼技能
     *
     * 当检测到"失败后成功恢复"的模式时，生成一个技能文件，
     * 描述如何避免之前的失败以及恢复策略。
     */
    deriveRecoverySkill(pattern) {
        const { analyticsIds, workspacePath, description } = pattern;
        if (analyticsIds.length < 2)
            return;
        // 生成唯一 hash 作为文件名
        const hash = crypto_1.default.createHash('md5')
            .update(analyticsIds.join('-'))
            .digest('hex').substring(0, 8);
        const skillName = `${AUTO_PREFIX}${hash}`;
        const filePath = path_1.default.join(COMMANDS_DIR, `${skillName}.md`);
        // 避免重复生成
        if (fs_1.default.existsSync(filePath))
            return;
        // 生成技能内容
        const content = this.generateRecoveryContent(description ?? 'Recovery pattern', workspacePath);
        // 确保 commands 目录存在
        if (!fs_1.default.existsSync(COMMANDS_DIR)) {
            fs_1.default.mkdirSync(COMMANDS_DIR, { recursive: true });
        }
        fs_1.default.writeFileSync(filePath, content, 'utf-8');
        console.log(`[skill-derivation] created skill: ${skillName}`);
    }
    /**
     * 生成恢复技能的 Markdown 内容
     */
    generateRecoveryContent(description, workspacePath) {
        const workspaceName = path_1.default.basename(workspacePath);
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
    curatorReview() {
        const result = { deleted: 0, deactivated: 0, details: [] };
        try {
            if (!fs_1.default.existsSync(COMMANDS_DIR))
                return result;
            const files = fs_1.default.readdirSync(COMMANDS_DIR)
                .filter(f => f.startsWith(AUTO_PREFIX) && f.endsWith('.md'));
            const now = Date.now();
            const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000; // 60 天
            for (const file of files) {
                const filePath = path_1.default.join(COMMANDS_DIR, file);
                const stat = fs_1.default.statSync(filePath);
                // 规则 2: 超过 60 天
                if (now - stat.mtimeMs > MAX_AGE_MS) {
                    fs_1.default.unlinkSync(filePath);
                    result.deleted++;
                    result.details.push(`Deleted old skill: ${file}`);
                    continue;
                }
                // 规则 1: confidence < 0.3
                try {
                    const content = fs_1.default.readFileSync(filePath, 'utf-8');
                    const confidenceMatch = content.match(/confidence:\s*([\d.]+)/);
                    if (confidenceMatch) {
                        const confidence = parseFloat(confidenceMatch[1]);
                        if (confidence < 0.3) {
                            fs_1.default.unlinkSync(filePath);
                            result.deleted++;
                            result.details.push(`Deleted low-confidence skill: ${file}`);
                        }
                    }
                }
                catch {
                    // 文件读取失败，跳过
                }
            }
            if (result.deleted > 0 || result.deactivated > 0) {
                console.log(`[skill-derivation] curator: deleted=${result.deleted}, deactivated=${result.deactivated}`);
            }
        }
        catch (err) {
            console.error(`[skill-derivation] curatorReview error: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
        return result;
    }
    /**
     * 列出所有自动生成的技能
     */
    listAutoDerived() {
        if (!fs_1.default.existsSync(COMMANDS_DIR))
            return [];
        return fs_1.default.readdirSync(COMMANDS_DIR)
            .filter(f => f.startsWith(AUTO_PREFIX) && f.endsWith('.md'))
            .map(f => f.replace('.md', ''));
    }
}
exports.SkillDerivationService = SkillDerivationService;
//# sourceMappingURL=skill-derivation-service.js.map