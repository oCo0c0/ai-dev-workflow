/**
 * @file Agent 系统类型定义
 * @description 定义 Agent、工具、任务、结果等核心类型
 */
/**
 * Agent 配置接口
 */
export interface AgentConfig {
    /** Agent 唯一标识符 */
    id: string;
    /** Agent 名称 */
    name: string;
    /** Agent 描述 */
    description?: string;
    /** Agent 可用的工具列表 */
    tools: ToolConfig[];
    /** 最大执行时间（毫秒） */
    maxExecutionTime?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 记忆存储配置 */
    memory?: MemoryConfig;
    /** Agent 元数据 */
    metadata?: Record<string, unknown>;
}
/**
 * 工具配置接口
 */
export interface ToolConfig {
    /** 工具名称 */
    name: string;
    /** 工具描述 */
    description: string;
    /** 工具参数 Schema（JSON Schema） */
    parameters?: Record<string, unknown>;
    /** 是否需要重试 */
    retryable?: boolean;
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 降级策略 */
    fallback?: FallbackStrategy;
}
/**
 * 降级策略接口
 */
export interface FallbackStrategy {
    /** 降级处理函数 */
    handler: (error: Error, context: {
        tool: ToolConfig;
        parameters: Record<string, unknown>;
    }) => Promise<unknown>;
    /** 降级超时时间（毫秒） */
    timeout?: number;
}
/**
 * 记忆配置接口
 */
export interface MemoryConfig {
    /** 记忆类型：short-term（短期）、long-term（长期）、episodic（情景） */
    type: 'short-term' | 'long-term' | 'episodic';
    /** 最大记忆条目数 */
    maxEntries?: number;
    /** 记忆保留时间（毫秒） */
    retentionTime?: number;
}
/**
 * 任务接口
 */
export interface Task {
    /** 任务 ID */
    id: string;
    /** 任务类型 */
    type: string;
    /** 任务输入数据 */
    input: Record<string, unknown>;
    /** 目标质量阈值（0-1） */
    targetQuality?: number;
    /** Token 预算限制 */
    tokenBudget?: number;
    /** 任务优先级 */
    priority?: 'low' | 'medium' | 'high' | 'critical';
    /** 任务元数据 */
    metadata?: Record<string, unknown>;
    /** 是否完成 */
    done?: boolean;
}
/**
 * 任务状态接口
 */
export interface TaskState {
    /** 当前任务 */
    task: Task;
    /** 执行历史 */
    history: ExecutionHistory[];
    /** 当前迭代次数 */
    iteration: number;
    /** 当前质量评估 */
    quality: number;
    /** 已消耗的 token 数量 */
    tokensUsed: number;
    /** 当前阶段 */
    phase: string;
    /** 错误计数 */
    errorCount: number;
    /** 最后更新时间 */
    lastUpdate: string;
}
/**
 * 执行历史接口
 */
export interface ExecutionHistory {
    /** 执行步骤 ID */
    id: string;
    /** 执行时间 */
    timestamp: string;
    /** 执行的操作 */
    action: Action;
    /** 执行结果 */
    result: Result;
    /** 质量评估 */
    quality?: number;
    /** Token 消耗 */
    tokensUsed?: number;
}
/**
 * Action 接口
 */
export interface Action {
    /** Action 类型 */
    type: string;
    /** Action 参数 */
    parameters: Record<string, unknown>;
    /** 目标工具 */
    tool?: string;
    /** Action 元数据 */
    metadata?: Record<string, unknown>;
}
/**
 * Result 接口
 */
export interface Result {
    /** 是否成功 */
    success: boolean;
    /** 结果数据 */
    data?: unknown;
    /** 错误信息 */
    error?: ErrorInfo;
    /** Token 消耗 */
    tokensUsed?: number;
    /** 质量评分 */
    quality?: number;
    /** 结果元数据 */
    metadata?: Record<string, unknown>;
}
/**
 * 错误信息接口
 */
export interface ErrorInfo {
    /** 错误代码 */
    code: string;
    /** 错误消息 */
    message: string;
    /** 是否可重试 */
    retryable: boolean;
    /** 错误详情 */
    details?: Record<string, unknown>;
}
/**
 * Agent 执行结果接口
 */
export interface AgentResult {
    /** 是否成功 */
    success: boolean;
    /** 最终结果数据 */
    data?: unknown;
    /** 质量评估 */
    quality: number;
    /** 执行迭代次数 */
    iterations: number;
    /** 总 Token 消耗 */
    tokensUsed: number;
    /** 执行时长（毫秒） */
    duration: number;
    /** 执行轨迹 */
    trace: ExecutionTrace;
    /** 错误信息（如果有） */
    error?: ErrorInfo;
}
/**
 * 执行轨迹接口
 */
export interface ExecutionTrace {
    /** 轨迹 ID */
    id: string;
    /** Agent ID */
    agentId: string;
    /** 任务 ID */
    taskId: string;
    /** 开始时间 */
    startTime: string;
    /** 结束时间 */
    endTime?: string;
    /** 执行步骤列表 */
    steps: TraceStep[];
    /** 错误列表 */
    errors: TraceError[];
}
/**
 * 轨迹步骤接口
 */
export interface TraceStep {
    /** 步骤 ID */
    id: string;
    /** 步骤类型 */
    type: 'think' | 'action' | 'observe' | 'reflect';
    /** 时间戳 */
    timestamp: string;
    /** 步骤内容 */
    content: Record<string, unknown>;
    /** Token 消耗 */
    tokensUsed?: number;
}
/**
 * 轨迹错误接口
 */
export interface TraceError {
    /** 错误 ID */
    id: string;
    /** 时间戳 */
    timestamp: string;
    /** 错误信息 */
    error: ErrorInfo;
    /** 恢复策略 */
    recovery?: string;
    /** 是否已恢复 */
    recovered: boolean;
}
/**
 * 执行上下文接口
 */
export interface ExecutionContext {
    /** Agent 配置 */
    agent: AgentConfig;
    /** 当前任务 */
    task: Task;
    /** 任务状态 */
    state: TaskState;
    /** 执行轨迹 */
    trace: ExecutionTrace;
    /** 工具执行器 */
    tools: ToolExecutor;
}
/**
 * 反思接口
 */
export interface Reflection {
    /** 反思 ID */
    id: string;
    /** 时间戳 */
    timestamp: string;
    /** 反思内容 */
    content: string;
    /** 改进建议 */
    improvements: Improvement[];
    /** 质量评估 */
    quality: number;
}
/**
 * 改进建议接口
 */
export interface Improvement {
    /** 改进类型 */
    type: string;
    /** 优先级 */
    priority: 'low' | 'medium' | 'high';
    /** 改进描述 */
    description: string;
    /** 改进行动 */
    action: Action;
}
/**
 * 工具执行器接口
 */
export interface ToolExecutor {
    /** 执行工具 */
    execute(toolName: string, parameters: Record<string, unknown>): Promise<unknown>;
    /** 检查工具是否存在 */
    has(toolName: string): boolean;
    /** 获取所有工具列表 */
    list(): string[];
}
/**
 * 错误恢复策略接口
 */
export interface RecoveryStrategy {
    /** 判断是否可恢复 */
    canRecover(error: Error): boolean;
    /** 执行恢复 */
    recover(error: Error, context: ExecutionContext): Promise<boolean>;
}
/**
 * 监控事件接口
 */
export interface MonitorEvent {
    /** 事件类型 */
    type: 'start' | 'think' | 'action' | 'observe' | 'reflect' | 'error' | 'complete';
    /** 时间戳 */
    timestamp: string;
    /** Agent ID */
    agentId: string;
    /** 任务 ID */
    taskId: string;
    /** 事件数据 */
    data: Record<string, unknown>;
}
/**
 * Agent 监控接口
 */
export interface AgentMonitor {
    /** 开始监控 */
    start(agentId: string, task: Task): ExecutionTrace;
    /** 记录事件 */
    record(trace: ExecutionTrace, event: MonitorEvent): void;
    /** 完成监控 */
    complete(trace: ExecutionTrace, result: AgentResult): void;
    /** 记录错误 */
    error(trace: ExecutionTrace, error: Error): void;
}
/**
 * 重试配置接口
 */
export interface RetryConfig {
    /** 最大重试次数 */
    maxAttempts: number;
    /** 重试延迟策略 */
    backoff: 'fixed' | 'linear' | 'exponential';
    /** 初始延迟（毫秒） */
    initialDelay: number;
    /** 最大延迟（毫秒） */
    maxDelay?: number;
    /** 判断是否重试的条件 */
    retryIf?: (error: Error) => boolean;
}
/**
 * 思考接口
 */
export interface Thought {
    /** 思考内容 */
    content: string;
    /** 下一步行动 */
    nextAction: Action;
    /** 置信度（0-1） */
    confidence?: number;
    /** 思考元数据 */
    metadata?: Record<string, unknown>;
}
/**
 * 观察接口
 */
export interface Observation {
    /** 执行结果 */
    result: Result;
    /** 质量评估（0-1） */
    quality: number;
    /** 是否需要改进 */
    needsImprovement: boolean;
    /** 观察元数据 */
    metadata?: Record<string, unknown>;
}
/**
 * 质量评估接口
 */
export interface QualityAssessment {
    /** 整体质量分数（0-1） */
    score: number;
    /** 正确性评分 */
    correctness: number;
    /** 完整性评分 */
    completeness: number;
    /** 一致性评分 */
    consistency: number;
    /** 性能评分 */
    performance: number;
    /** 安全性评分 */
    security: number;
    /** 评估详情 */
    details?: Record<string, unknown>;
}
/**
 * Agent 实现接口
 */
export interface AgentImplementation {
    /** Agent 配置 */
    config: AgentConfig;
    /** 思考方法 */
    think(context: ExecutionContext): Promise<Thought>;
    /** 行动方法 */
    act(context: ExecutionContext, action: Action): Promise<unknown>;
    /** 观察方法 */
    observe(context: ExecutionContext, result: Result): Promise<Observation>;
    /** 反思方法 */
    reflect(context: ExecutionContext, observation: Observation): Promise<Reflection>;
    /** 决策方法 */
    decide(context: ExecutionContext): Promise<Action>;
}
//# sourceMappingURL=types.d.ts.map