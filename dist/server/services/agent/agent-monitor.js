"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentMonitorImpl = void 0;
exports.createAgentMonitor = createAgentMonitor;
const uuid_1 = require("uuid");
/**
 * 监控系统实现
 */
class AgentMonitorImpl {
    traces = new Map();
    eventLog = [];
    maxEventLogSize = 10000;
    /**
     * 开始监控
     */
    start(agentId, task) {
        const traceId = (0, uuid_1.v4)();
        const trace = {
            id: traceId,
            agentId,
            taskId: task.id,
            startTime: new Date().toISOString(),
            steps: [],
            errors: []
        };
        this.traces.set(traceId, trace);
        // 记录开始事件
        this.recordEvent({
            type: 'start',
            timestamp: trace.startTime,
            agentId,
            taskId: task.id,
            data: {
                traceId,
                taskType: task.type,
                targetQuality: task.targetQuality,
                tokenBudget: task.tokenBudget,
                priority: task.priority
            }
        });
        console.log(`[AgentMonitor] Started trace ${traceId} for agent ${agentId}, task ${task.id}`);
        return trace;
    }
    /**
     * 记录事件
     */
    record(trace, event) {
        // 添加到执行轨迹
        const step = {
            id: (0, uuid_1.v4)(),
            type: event.type,
            timestamp: event.timestamp,
            content: event.data
        };
        trace.steps.push(step);
        // 记录到事件日志
        this.recordEvent(event);
        // 记录 Token 消耗
        if (event.data.tokensUsed) {
            this.updateTokenUsage(trace, event.data.tokensUsed);
        }
    }
    /**
     * 完成监控
     */
    complete(trace, result) {
        trace.endTime = new Date().toISOString();
        // 记录完成事件
        this.recordEvent({
            type: 'complete',
            timestamp: trace.endTime,
            agentId: trace.agentId,
            taskId: trace.taskId,
            data: {
                success: result.success,
                quality: result.quality,
                iterations: result.iterations,
                tokensUsed: result.tokensUsed,
                duration: result.duration,
                error: result.error
            }
        });
        console.log(`[AgentMonitor] Completed trace ${trace.id}: ` +
            `success=${result.success}, quality=${result.quality}, ` +
            `iterations=${result.iterations}, tokens=${result.tokensUsed}, ` +
            `duration=${result.duration}ms`);
    }
    /**
     * 记录错误
     */
    error(trace, error) {
        const traceError = {
            id: (0, uuid_1.v4)(),
            timestamp: new Date().toISOString(),
            error: this.normalizeError(error),
            recovered: false
        };
        trace.errors.push(traceError);
        // 记录错误事件
        this.recordEvent({
            type: 'error',
            timestamp: traceError.timestamp,
            agentId: trace.agentId,
            taskId: trace.taskId,
            data: {
                error: traceError.error,
                stack: error.stack
            }
        });
        console.error(`[AgentMonitor] Error in trace ${trace.id}: ${error.message}`);
    }
    /**
     * 获取执行轨迹
     */
    getTrace(traceId) {
        return this.traces.get(traceId);
    }
    /**
     * 获取所有轨迹
     */
    getAllTraces() {
        return Array.from(this.traces.values());
    }
    /**
     * 获取事件日志
     */
    getEvents(agentId, taskId) {
        let events = this.eventLog;
        if (agentId) {
            events = events.filter(e => e.agentId === agentId);
        }
        if (taskId) {
            events = events.filter(e => e.taskId === taskId);
        }
        return events;
    }
    /**
     * 清理旧轨迹
     */
    cleanup(maxAge = 3600000) {
        const now = Date.now();
        const toDelete = [];
        for (const [id, trace] of this.traces) {
            const traceTime = new Date(trace.startTime).getTime();
            if (now - traceTime > maxAge) {
                toDelete.push(id);
            }
        }
        for (const id of toDelete) {
            this.traces.delete(id);
        }
        console.log(`[AgentMonitor] Cleaned up ${toDelete.length} old traces`);
    }
    /**
     * 获取统计信息
     */
    getStats(agentId) {
        const traces = agentId
            ? this.getAllTraces().filter(t => t.agentId === agentId)
            : this.getAllTraces();
        const completedTraces = traces.filter(t => t.endTime !== undefined);
        const failedTraces = completedTraces.filter(t => {
            const lastStep = t.steps[t.steps.length - 1];
            return lastStep?.content.success === false;
        });
        const totalTokensUsed = completedTraces.reduce((sum, trace) => {
            // 从最后一步的tokensUsed获取
            const lastStep = trace.steps[trace.steps.length - 1];
            return sum + (lastStep?.tokensUsed || 0);
        }, 0);
        const qualitySum = completedTraces.reduce((sum, trace) => {
            // 从最后一步的content.quality获取
            const lastStep = trace.steps[trace.steps.length - 1];
            const quality = lastStep?.content?.quality;
            return sum + (quality || 0);
        }, 0);
        const durationSum = completedTraces.reduce((sum, trace) => {
            const startTime = new Date(trace.startTime).getTime();
            const endTime = trace.endTime ? new Date(trace.endTime).getTime() : startTime;
            return sum + (endTime - startTime);
        }, 0);
        return {
            totalTraces: traces.length,
            completedTraces: completedTraces.length,
            failedTraces: failedTraces.length,
            totalTokensUsed,
            averageQuality: completedTraces.length > 0 ? qualitySum / completedTraces.length : 0,
            averageDuration: completedTraces.length > 0 ? durationSum / completedTraces.length : 0
        };
    }
    /**
     * 记录事件到日志
     */
    recordEvent(event) {
        this.eventLog.push(event);
        // 限制日志大小
        if (this.eventLog.length > this.maxEventLogSize) {
            this.eventLog = this.eventLog.slice(-this.maxEventLogSize / 2);
        }
    }
    /**
     * 更新 Token 使用情况
     */
    updateTokenUsage(trace, tokens) {
        // 在最后一步更新 Token 使用情况
        if (trace.steps.length > 0) {
            const lastStep = trace.steps[trace.steps.length - 1];
            lastStep.tokensUsed = (lastStep.tokensUsed || 0) + tokens;
        }
    }
    /**
     * 标准化错误对象
     */
    normalizeError(error) {
        return {
            code: error.name || 'UNKNOWN_ERROR',
            message: error.message,
            retryable: this.isRetryableError(error),
            details: {
                stack: error.stack
            }
        };
    }
    /**
     * 判断错误是否可重试
     */
    isRetryableError(error) {
        const retryablePatterns = [
            /timeout/i,
            /ETIMEDOUT/i,
            /ECONNRESET/i,
            /ECONNREFUSED/i,
            /EAI_AGAIN/i,
            /5\d\d/, // 5xx HTTP errors
            /TEMPORARY_FAILURE/i
        ];
        return retryablePatterns.some(pattern => pattern.test(error.message) || pattern.test(error.name));
    }
}
exports.AgentMonitorImpl = AgentMonitorImpl;
/**
 * 创建 Agent 监控实例
 */
function createAgentMonitor() {
    return new AgentMonitorImpl();
}
//# sourceMappingURL=agent-monitor.js.map