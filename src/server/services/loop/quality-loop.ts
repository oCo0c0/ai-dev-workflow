/**
 * @file Quality Loop
 * @description 质量优化循环系统 - 持续改进直到达到目标质量
 *
 * 核心功能：
 * 1. 质量评估 - 多维度评估结果质量
 * 2. 问题识别 - 自动发现质量问题
 * 3. 改进生成 - 生成针对性改进建议
 * 4. 迭代优化 - 持续改进直到达标
 */

import {
    LoopConfig,
    LoopResult,
    QualityAssessment,
    QualityIssue,
    Improvement
} from './types.js';

/**
 * 质量评估器
 */
class QualityEvaluator {
    /**
     * 评估质量
     */
    async assess(result: any, evaluator?: (result: any) => Promise<number>): Promise<QualityAssessment> {
        const score = evaluator ? await evaluator(result) : this.defaultEvaluate(result);

        const issues = this.identifyIssues(result, score);
        const improvements = this.generateImprovements(issues, score);

        return {
            score,
            issues,
            improvements
        };
    }

    /**
     * 默认评估函数
     */
    private defaultEvaluate(result: any): number {
        if (!result) return 0;

        let score = 0.5; // 基础分

        // 完整性检查
        if (result && typeof result === 'object') {
            const keys = Object.keys(result);
            if (keys.length > 0) score += 0.2;
            if (result.data || result.content || result.output) score += 0.1;
        } else if (typeof result === 'string') {
            if (result.length > 0) score += 0.2;
            if (result.length > 50) score += 0.1;
            if (result.length > 100) score += 0.1;
        }

        // 质量检查
        if (result && !result.error) score += 0.1;
        if (result && result.success !== false) score += 0.1;

        return Math.min(score, 1.0);
    }

    /**
     * 识别问题
     */
    private identifyIssues(result: any, score: number): QualityIssue[] {
        const issues: QualityIssue[] = [];

        // 质量分数低
        if (score < 0.5) {
            issues.push({
                type: 'low_quality',
                severity: 'high',
                description: 'Overall quality is below acceptable threshold',
                location: 'overall'
            });
        }

        // 缺少关键字段
        if (result && typeof result === 'object') {
            const expectedFields = ['data', 'content', 'output'];
            const hasExpected = expectedFields.some(field => field in result);
            if (!hasExpected) {
                issues.push({
                    type: 'missing_fields',
                    severity: 'medium',
                    description: 'Result is missing expected output fields',
                    location: 'result'
                });
            }
        }

        // 包含错误
        if (result && result.error) {
            issues.push({
                type: 'error_present',
                severity: 'critical',
                description: `Result contains error: ${result.error}`,
                location: 'error'
            });
        }

        // 内容过短
        if (result && typeof result === 'string' && result.length < 20) {
            issues.push({
                type: 'insufficient_content',
                severity: 'medium',
                description: 'Content is too short',
                location: 'content'
            });
        }

        return issues;
    }

    /**
     * 生成改进建议
     */
    private generateImprovements(issues: QualityIssue[], score: number): Improvement[] {
        const improvements: Improvement[] = [];

        for (const issue of issues) {
            switch (issue.type) {
                case 'low_quality':
                    improvements.push({
                        type: 'enhance_quality',
                        priority: 'high',
                        description: 'Improve overall quality through refinement',
                        expectedImprovement: 0.3,
                        implementationCost: 3000
                    });
                    break;

                case 'missing_fields':
                    improvements.push({
                        type: 'add_fields',
                        priority: 'medium',
                        description: 'Add missing expected output fields',
                        expectedImprovement: 0.2,
                        implementationCost: 1000
                    });
                    break;

                case 'error_present':
                    improvements.push({
                        type: 'fix_error',
                        priority: 'high',
                        description: 'Resolve errors in the result',
                        expectedImprovement: 0.4,
                        implementationCost: 2000
                    });
                    break;

                case 'insufficient_content':
                    improvements.push({
                        type: 'expand_content',
                        priority: 'medium',
                        description: 'Expand content with more detail',
                        expectedImprovement: 0.15,
                        implementationCost: 1500
                    });
                    break;
            }
        }

        // 如果质量接近目标，添加精细化建议
        if (score >= 0.7 && score < 0.9) {
            improvements.push({
                type: 'fine_polish',
                priority: 'low',
                description: 'Apply final polishing for higher quality',
                expectedImprovement: 0.1,
                implementationCost: 2000
            });
        }

        return improvements;
    }
}

/**
 * 质量优化循环系统
 */
export class QualityLoop {
    private evaluator: QualityEvaluator;

    constructor() {
        this.evaluator = new QualityEvaluator();
    }

    /**
     * 执行质量优化循环
     */
    async execute(
        config: LoopConfig,
        executor: (improvements: Improvement[]) => Promise<any>
    ): Promise<LoopResult> {
        const startTime = Date.now();
        let currentResult: any = null;
        let currentAssessment: QualityAssessment | null = null;
        const iterations: number[] = [];
        let totalTokensUsed = 0;
        let done = false;
        let doneReason = '';

        // 初始评估
        currentResult = await executor([]);
        currentAssessment = await this.evaluator.assess(currentResult, config.qualityEvaluator);

        iterations.push(1);
        totalTokensUsed += 1000; // 估算初始成本

        // 优化循环
        while (!done && iterations.length < (config.maxIterations || 10)) {
            // 检查是否达到目标质量
            if (currentAssessment!.score >= (config.targetQuality || 0.8)) {
                done = true;
                doneReason = `Target quality reached: ${currentAssessment!.score.toFixed(2)}`;
                break;
            }

            // 检查预算
            if (config.tokenBudget && totalTokensUsed >= config.tokenBudget) {
                done = true;
                doneReason = `Token budget exhausted: ${totalTokensUsed}/${config.tokenBudget}`;
                break;
            }

            // 检查是否还有改进空间
            if (currentAssessment!.improvements.length === 0) {
                done = true;
                doneReason = 'No more improvements identified';
                break;
            }

            // 选择高优先级改进
            const priorityImprovements = currentAssessment!.improvements
                .filter(imp => imp.priority === 'high' || imp.priority === 'medium')
                .slice(0, 3); // 最多同时处理 3 个改进

            // 执行改进
            const improvedResult = await executor(priorityImprovements);
            const improvedAssessment = await this.evaluator.assess(improvedResult, config.qualityEvaluator);

            // 检查是否有改进
            if (improvedAssessment.score > currentAssessment!.score) {
                currentResult = improvedResult;
                currentAssessment = improvedAssessment;
                iterations.push(iterations.length + 1);
                totalTokensUsed += priorityImprovements.reduce((sum, imp) => sum + imp.implementationCost, 0);
            } else {
                // 没有改进，尝试其他策略
                console.warn('[QualityLoop] No improvement detected, trying alternative approach');
                totalTokensUsed += 500;

                // 如果连续 3 次无改进，终止
                const recentScores = iterations.slice(-3).map(() => currentAssessment!.score);
                if (recentScores.length >= 3 && recentScores.every(s => s === currentAssessment!.score)) {
                    done = true;
                    doneReason = 'No improvement after multiple attempts';
                    break;
                }
            }
        }

        return {
            result: currentResult,
            quality: currentAssessment!.score,
            iterations: iterations.length,
            tokensUsed: totalTokensUsed,
            duration: Date.now() - startTime,
            strategies: ['quality-optimization'],
            success: currentAssessment!.score >= (config.targetQuality || 0.8),
            state: {
                iteration: iterations.length,
                quality: currentAssessment!.score,
                tokensUsed: totalTokensUsed,
                timeElapsed: Date.now() - startTime,
                strategy: 'quality-optimization',
                history: [],
                done,
                doneReason
            }
        };
    }

    /**
     * 获取质量报告
     */
    getQualityReport(assessment: QualityAssessment): string {
        const lines = [
            `Quality Score: ${(assessment.score * 100).toFixed(1)}%`,
            '',
            `Issues Found: ${assessment.issues.length}`,
            ...assessment.issues.map(issue =>
                `  - [${issue.severity.toUpperCase()}] ${issue.description}`
            ),
            '',
            `Improvements Suggested: ${assessment.improvements.length}`,
            ...assessment.improvements.map(imp =>
                `  - [${imp.priority.toUpperCase()}] ${imp.description} ` +
                `(+${(imp.expectedImprovement * 100).toFixed(1)}%, ${imp.implementationCost} tokens)`
            )
        ];

        return lines.join('\n');
    }

    /**
     * 比较两次评估
     */
    compareAssessments(before: QualityAssessment, after: QualityAssessment): {
        qualityGain: number;
        issuesResolved: number;
        newIssues: number;
    } {
        const qualityGain = after.score - before.score;
        const beforeIssueTypes = new Set(before.issues.map(i => i.type));
        const afterIssueTypes = new Set(after.issues.map(i => i.type));

        const issuesResolved = Array.from(beforeIssueTypes).filter(type => !afterIssueTypes.has(type)).length;
        const newIssues = Array.from(afterIssueTypes).filter(type => !beforeIssueTypes.has(type)).length;

        return {
            qualityGain,
            issuesResolved,
            newIssues
        };
    }
}

/**
 * 创建质量优化循环实例
 */
export function createQualityLoop(): QualityLoop {
    return new QualityLoop();
}
