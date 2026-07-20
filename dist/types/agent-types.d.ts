/**
 * @file 共享Agent类型定义
 * @description 服务端和客户端共享的Agent系统类型定义
 *          作为单一真实来源,消除重复定义
 */
/**
 * Agent执行记录(权威定义)
 */
export interface AgentExecution {
    /** 执行唯一标识符 */
    id: string;
    /** Agent ID */
    agentId: string;
    /** 任务 ID */
    taskId: string;
    /** 执行状态 */
    status: 'running' | 'completed' | 'failed' | 'aborted' | 'paused';
    /** 输入数据 */
    inputData: Record<string, unknown>;
    /** 执行选项 */
    options?: {
        targetQuality?: number;
        tokenBudget?: number;
        maxIterations?: number;
    };
    /** 执行结果(各Agent返回的具体结果) */
    result?: any;
    /** 质量评估 (0-1) */
    quality?: number;
    /** 执行时长(毫秒) */
    duration?: number;
    /** Token消耗 */
    tokensUsed?: number;
    /** 错误信息 */
    error?: string;
    /** 创建时间 */
    createdAt: string;
    /** 最后更新时间 */
    updatedAt: string;
}
/**
 * Agent执行摘要(用于列表视图)
 */
export interface AgentExecutionSummary {
    id: string;
    /** 关联的需求ID */
    requirementId: string;
    /** 需求标题 */
    requirementTitle?: string;
    /** 需求编号 */
    requirementNumber?: string;
    /** 工作区路径 */
    workspacePath: string;
    agentId: string;
    status: AgentExecution['status'];
    /** 执行摘要 */
    summary?: string;
    createdAt: string;
    updatedAt: string;
    /** 步骤数量 */
    stepsCount?: number;
    /** Token消耗 */
    tokensUsed?: number;
    /** 执行时长 */
    duration?: number;
}
/**
 * 执行步骤
 */
export interface ExecutionStep {
    /** 步骤序号 */
    order: number;
    /** Agent ID */
    agentId: string;
    /** Agent名称 */
    agentName: string;
    /** 为什么需要这个Agent */
    reasoning: string;
    /** 置信度 */
    confidence: number;
    /** 依赖的前置步骤序号 */
    dependencies: number[];
    /** 状态 */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    /** 执行结果 */
    result?: any;
    /** 错误信息 */
    error?: string;
}
/**
 * 执行计划
 */
export interface ExecutionPlan {
    /** 计划ID */
    planId: string;
    /** 需求描述 */
    requirement: string;
    /** 工作区路径 */
    workspace: string;
    /** 执行步骤 */
    steps: ExecutionStep[];
    /** 总体策略说明 */
    strategy: string;
    /** 预估token消耗 */
    estimatedTokens: number;
    /** 暂停请求标志 */
    pauseRequested?: boolean;
    /** 用户问题队列 */
    userQuestions?: Array<{
        question: string;
        answer?: string;
    }>;
}
/**
 * 协调Agent执行结果(简化版,用于存储)
 */
export interface StoredCoordinatorResult {
    plan: ExecutionPlan;
    finalResult?: any;
}
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
        /** 估时(小时) */
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
    /** 测试用例数量 */
    totalTests: number;
    /** 通过数量 */
    passed: number;
    /** 失败数量 */
    failed: number;
    /** 跳过数量 */
    skipped?: number;
    /** 测试覆盖率 */
    coverage?: number;
    /** 失败详情 */
    failures?: Array<{
        testName: string;
        error: string;
    }>;
}
/**
 * 代码审查结果
 */
export interface CodeReviewResult {
    /** 审查文件列表 */
    files: Array<{
        /** 文件路径 */
        path: string;
        /** 审查问题数量 */
        issues: number;
        /** 严重问题 */
        criticalIssues: number;
    }>;
    /** 总问题数量 */
    totalIssues: number;
    /** 严重问题数量 */
    criticalIssues: number;
    /** 建议改进 */
    suggestions: string[];
}
/**
 * 文档生成结果
 */
export interface DocumentationResult {
    /** 生成的文档 */
    documentation: string;
    /** 文档类型 */
    type: 'readme' | 'api' | 'user-guide' | 'technical';
    /** 文件路径 */
    filePath?: string;
    /** 相关文件 */
    relatedFiles?: string[];
}
/**
 * 检查执行是否正在运行
 */
export declare function isExecutionRunning(execution: AgentExecution | AgentExecutionSummary): boolean;
/**
 * 检查执行是否成功完成
 */
export declare function isExecutionCompleted(execution: AgentExecution | AgentExecutionSummary): boolean;
/**
 * 检查执行是否失败
 */
export declare function isExecutionFailed(execution: AgentExecution | AgentExecutionSummary): boolean;
/**
 * 检查执行是否已中止
 */
export declare function isExecutionAborted(execution: AgentExecution | AgentExecutionSummary): boolean;
/**
 * 检查执行是否已暂停
 */
export declare function isExecutionPaused(execution: AgentExecution | AgentExecutionSummary): boolean;
//# sourceMappingURL=agent-types.d.ts.map