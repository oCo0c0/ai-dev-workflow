/**
 * @file Agent Monitor
 * @description Agent 监控系统 - 提供完整的可观测性和调试能力
 *
 * 核心功能：
 * 1. 执行轨迹记录 - 记录 Agent 执行的完整过程
 * 2. 事件日志 - 记录所有关键事件（think、action、error）
 * 3. Token 跟踪 - 跟踪 Token 消耗情况
 * 4. 性能监控 - 记录执行时间和资源使用
 */
import { Task, AgentResult, ExecutionTrace, MonitorEvent, AgentMonitor } from './types.js';
/**
 * 监控系统实现
 */
export declare class AgentMonitorImpl implements AgentMonitor {
    private traces;
    private eventLog;
    private maxEventLogSize;
    /**
     * 开始监控
     */
    start(agentId: string, task: Task): ExecutionTrace;
    /**
     * 记录事件
     */
    record(trace: ExecutionTrace, event: MonitorEvent): void;
    /**
     * 完成监控
     */
    complete(trace: ExecutionTrace, result: AgentResult): void;
    /**
     * 记录错误
     */
    error(trace: ExecutionTrace, error: Error): void;
    /**
     * 获取执行轨迹
     */
    getTrace(traceId: string): ExecutionTrace | undefined;
    /**
     * 获取所有轨迹
     */
    getAllTraces(): ExecutionTrace[];
    /**
     * 获取事件日志
     */
    getEvents(agentId?: string, taskId?: string): MonitorEvent[];
    /**
     * 清理旧轨迹
     */
    cleanup(maxAge?: number): void;
    /**
     * 获取统计信息
     */
    getStats(agentId?: string): {
        totalTraces: number;
        completedTraces: number;
        failedTraces: number;
        totalTokensUsed: number;
        averageQuality: number;
        averageDuration: number;
    };
    /**
     * 记录事件到日志
     */
    private recordEvent;
    /**
     * 更新 Token 使用情况
     */
    private updateTokenUsage;
    /**
     * 标准化错误对象
     */
    private normalizeError;
    /**
     * 判断错误是否可重试
     */
    private isRetryableError;
}
/**
 * 创建 Agent 监控实例
 */
export declare function createAgentMonitor(): AgentMonitorImpl;
//# sourceMappingURL=agent-monitor.d.ts.map