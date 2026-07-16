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
import { LoopConfig, LoopResult, QualityAssessment, Improvement } from './types.js';
/**
 * 质量优化循环系统
 */
export declare class QualityLoop {
    private evaluator;
    constructor();
    /**
     * 执行质量优化循环
     */
    execute(config: LoopConfig, executor: (improvements: Improvement[]) => Promise<any>): Promise<LoopResult>;
    /**
     * 获取质量报告
     */
    getQualityReport(assessment: QualityAssessment): string;
    /**
     * 比较两次评估
     */
    compareAssessments(before: QualityAssessment, after: QualityAssessment): {
        qualityGain: number;
        issuesResolved: number;
        newIssues: number;
    };
}
/**
 * 创建质量优化循环实例
 */
export declare function createQualityLoop(): QualityLoop;
//# sourceMappingURL=quality-loop.d.ts.map