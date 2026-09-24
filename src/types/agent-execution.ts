/**
 * @file 前后端共享的 Agent Execution 类型定义
 * @description 供 src/server/services/agent-execution-store.ts 与前端共同使用，
 *              避免两端类型重复定义导致的不一致。
 */

/**
 * 执行步骤
 */
export interface ExecutionStep {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    logs: string[];
}

/**
 * 子任务状态
 */
export interface SubTask {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    agent?: string;
    startedAt?: string;
    completedAt?: string;
    output?: string;
    error?: string;
    order: number;
}

/**
 * Agent思考过程
 */
export interface AgentThought {
    type: 'analysis' | 'planning' | 'decision' | 'tool_selection' | 'error';
    content: string;
    timestamp: string;
    confidence?: number;
}

/**
 * Agent执行摘要
 */
export interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementNumber?: string;
    requirementTitle?: string;
    workspacePath: string;
    status: 'analyzing' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    createdAt: string;
    updatedAt: string;
    subTasksCount?: number;
    completedSubTasks?: number;
    currentStep?: number;
    totalSteps?: number;
}

/**
 * 完整的Agent执行信息
 */
export interface AgentExecution extends AgentExecutionSummary {
    requirementText?: string;
    thoughts: AgentThought[];
    subTasks: SubTask[];
    steps: ExecutionStep[];
    logs: string[];
    error?: string;
    /** 会话 id（**只在产生它的引擎内有效**，见 sessionEngine） */
    sessionId?: string;
    /**
     * 产生 sessionId 的引擎 id（claude / codex / pi）。
     * 会话实体由各引擎自己托管（claude 的项目目录、pi 的会话文件、codex 的 thread），
     * 换引擎后旧 id 在新引擎里必然不存在 —— 记录引擎方可准确判断「能否续接」，
     * 而不是把别的引擎的 id 误传给当前引擎后静默开新会话。
     */
    sessionEngine?: string;
    /**
     * 运行中排队的用户回复（尚未消费）。
     * 排队期间不写入 logs——消费时（自动续跑/立即处理/手动 start）
     * 由 coordinator 统一落日志，保证消息上屏时机=实际执行时机。
     */
    pendingReplies?: string[];
}
