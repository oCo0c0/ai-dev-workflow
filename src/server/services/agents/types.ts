/**
 * @file Professional Agent Types
 * @description 专业 Agent 系统的类型定义
 */


/**
 * 专业 Agent 类型
 */
export type ProfessionalAgentType =
    | 'requirement-analysis'
    | 'code-generation'
    | 'test'
    | 'code-review'
    | 'documentation'
    | 'refactoring';

/**
 * 需求分析结果
 */
export interface RequirementAnalysisResult {
    /** 需求 ID */
    requirementId: string;
    /** 需求标题 */
    title: string;
    /** 需求描述 */
    description: string;
    /** 分析结果 */
    analysis: {
        /** 需求类型 */
        type: 'feature' | 'bugfix' | 'enhancement' | 'refactoring';
        /** 复杂度评估 */
        complexity: 'low' | 'medium' | 'high';
        /** 优先级建议 */
        recommendedPriority: 'low' | 'medium' | 'high';
        /** 估时（小时） */
        estimatedHours: number;
        /** 相关技术 */
        technologies: string[];
        /** 风险因素 */
        risks: string[];
    };
    /** 歧义识别 */
    ambiguities: Array<{
        /** 歧义内容 */
        content: string;
        /** 歧义类型 */
        type: 'unclear' | 'missing' | 'contradictory' | 'incomplete';
        /** 澄清问题 */
        questions: string[];
    }>;
    /** 验收标准 */
    acceptanceCriteria: string[];
    /** 技术建议 */
    technicalSuggestions: string[];
    /** 依赖项 */
    dependencies: string[];
}

/**
 * 代码生成结果
 */
export interface CodeGenerationResult {
    /** 生成的代码 */
    code: string;
    /** 文件路径 */
    filePath: string;
    /** 语言 */
    language: string;
    /** 代码质量 */
    quality: {
        /** 功能完整性 */
        completeness: number;
        /** 代码规范遵循度 */
        conventionAdherence: number;
        /** 可维护性 */
        maintainability: number;
        /** 性能优化 */
        performance: number;
    };
    /** 生成的测试 */
    tests?: Array<{
        /** 测试代码 */
        code: string;
        /** 测试文件路径 */
        filePath: string;
    }>;
    /** 文档 */
    documentation?: string;
    /** 依赖项 */
    dependencies: string[];
    /** TODO 标记 */
    todos: string[];
}

/**
 * 测试结果
 */
export interface TestResult {
    /** 测试套件名称 */
    suiteName: string;
    /** 测试用例 */
    testCases: Array<{
        /** 测试名称 */
        name: string;
        /** 是否通过 */
        passed: boolean;
        /** 执行时间（毫秒） */
        duration: number;
        /** 错误信息 */
        error?: string;
    }>;
    /** 覆盖率 */
    coverage: {
        /** 语句覆盖率 */
        statements: number;
        /** 分支覆盖率 */
        branches: number;
        /** 函数覆盖率 */
        functions: number;
        /** 行覆盖率 */
        lines: number;
    };
    /** 统计 */
    stats: {
        /** 总数 */
        total: number;
        /** 通过数 */
        passed: number;
        /** 失败数 */
        failed: number;
        /** 跳过数 */
        skipped: number;
    };
    /** 失败详情 */
    failures: Array<{
        /** 测试名称 */
        test: string;
        /** 错误信息 */
        error: string;
        /** 堆栈跟踪 */
        stack?: string;
    }>;
}

/**
 * 代码审查结果
 */
export interface CodeReviewResult {
    /** 审查分数（0-100） */
    score: number;
    /** 审查状态 */
    status: 'approved' | 'needs-changes' | 'rejected';
    /** 发现的问题 */
    findings: Array<{
        /** 问题类型 */
        type: 'bug' | 'security' | 'performance' | 'style' | 'documentation' | 'best-practice';
        /** 严重程度 */
        severity: 'critical' | 'high' | 'medium' | 'low';
        /** 问题描述 */
        description: string;
        /** 位置 */
        location: {
            /** 文件路径 */
            file: string;
            /** 行号 */
            line?: number;
            /** 列号 */
            column?: number;
        };
        /** 建议修复 */
        suggestion?: string;
    }>;
    /** 统计 */
    stats: {
        /** 总问题数 */
        total: number;
        /** 按严重程度统计 */
        bySeverity: Record<string, number>;
        /** 按类型统计 */
        byType: Record<string, number>;
    };
    /** 改进建议 */
    recommendations: string[];
    /** 正面反馈 */
    positives: string[];
}

/**
 * Agent 输入参数
 */
export interface AgentInput {
    /** Agent 类型 */
    agentType: ProfessionalAgentType;
    /** 任务 ID */
    taskId: string;
    /** 输入数据 */
    inputData: Record<string, unknown>;
    /** 配置选项 */
    options?: Record<string, unknown>;
}

/**
 * Agent 输出结果
 */
export interface AgentOutput {
    /** Agent 类型 */
    agentType: ProfessionalAgentType;
    /** 任务 ID */
    taskId: string;
    /** 是否成功 */
    success: boolean;
    /** 结果数据 */
    result?: RequirementAnalysisResult | CodeGenerationResult | TestResult | CodeReviewResult;
    /** 质量评估 */
    quality?: number;
    /** 执行时间（毫秒） */
    duration: number;
    /** Token 消耗 */
    tokensUsed: number;
    /** 错误信息 */
    error?: string;
}

/**
 * Agent 工作流配置
 */
export interface AgentWorkflowConfig {
    /** 工作流 ID */
    workflowId: string;
    /** 工作流名称 */
    name: string;
    /** Agent 序列 */
    agents: Array<{
        /** Agent 类型 */
        type: ProfessionalAgentType;
        /** 执行顺序 */
        order: number;
        /** 是否必须 */
        required: boolean;
        /** 输入映射 */
        inputMapping?: Record<string, string>;
        /** 输出映射 */
        outputMapping?: Record<string, string>;
    }>;
    /** 全局配置 */
    globalConfig?: Record<string, unknown>;
}

/**
 * Agent 工作流结果
 */
export interface AgentWorkflowResult {
    /** 工作流 ID */
    workflowId: string;
    /** 是否成功 */
    success: boolean;
    /** 各 Agent 结果 */
    agentResults: AgentOutput[];
    /** 总执行时间（毫秒） */
    totalDuration: number;
    /** 总 Token 消耗 */
    totalTokensUsed: number;
    /** 错误信息 */
    errors: string[];
}

// 重新导出 agent/types.js 中的类型
export type {Improvement} from '../agent/types.js';
