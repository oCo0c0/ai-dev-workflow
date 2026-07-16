"use strict";
/**
 * @file Error Recovery
 * @description 错误恢复系统 - 自动处理 Agent 执行过程中的错误
 *
 * 核心功能：
 * 1. 错误分类 - 识别错误类型（临时性、永久性、逻辑错误）
 * 2. 恢复策略 - 为不同错误选择合适的恢复方案
 * 3. 恢复执行 - 自动执行恢复策略
 * 4. 状态回滚 - 恢复失败时回滚到之前状态
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorRecoverySystem = void 0;
exports.createErrorRecoverySystem = createErrorRecoverySystem;
/**
 * 错误类型
 */
var ErrorType;
(function (ErrorType) {
    /** 临时性错误（网络超时、服务暂时不可用） */
    ErrorType["TRANSIENT"] = "transient";
    /** 永久性错误（认证失败、权限不足） */
    ErrorType["PERMANENT"] = "permanent";
    /** 逻辑错误（参数错误、状态不一致） */
    ErrorType["LOGICAL"] = "logical";
    /** 资源错误（内存不足、磁盘空间不足） */
    ErrorType["RESOURCE"] = "resource";
    /** 超时错误 */
    ErrorType["TIMEOUT"] = "timeout";
    /** 未知错误 */
    ErrorType["UNKNOWN"] = "unknown";
})(ErrorType || (ErrorType = {}));
/**
 * 恢复动作类型
 */
var RecoveryAction;
(function (RecoveryAction) {
    /** 重试操作 */
    RecoveryAction["RETRY"] = "retry";
    /** 回滚状态 */
    RecoveryAction["ROLLBACK"] = "rollback";
    /** 使用默认值 */
    RecoveryAction["USE_DEFAULT"] = "use_default";
    /** 跳过步骤 */
    RecoveryAction["SKIP"] = "skip";
    /** 降级执行 */
    RecoveryAction["DEGRADE"] = "degrade";
    /** 终止执行 */
    RecoveryAction["TERMINATE"] = "terminate";
    /** 人工介入 */
    RecoveryAction["MANUAL_INTERVENTION"] = "manual_intervention";
})(RecoveryAction || (RecoveryAction = {}));
/**
 * 错误分类器
 */
class ErrorClassifier {
    /**
     * 分类错误
     */
    classify(error) {
        const message = error.message.toLowerCase();
        const name = error.name.toLowerCase();
        // 网络和超时错误
        if (this.matchesAny(message, name, [
            /timeout/, /timed out/, /etimedout/,
            /connection reset/, /econnreset/,
            /connection refused/, /econnrefused/,
            /service unavailable/, /503/
        ])) {
            return ErrorType.TRANSIENT;
        }
        // 认证和权限错误
        if (this.matchesAny(message, name, [
            /unauthorized/, /401/,
            /forbidden/, /403/,
            /authentication failed/,
            /permission denied/, /access denied/
        ])) {
            return ErrorType.PERMANENT;
        }
        // 资源错误
        if (this.matchesAny(message, name, [
            /out of memory/, /oom/,
            /disk full/, /no space/,
            /resource exhausted/
        ])) {
            return ErrorType.RESOURCE;
        }
        // 参数和逻辑错误
        if (this.matchesAny(message, name, [
            /invalid parameter/, /invalid argument/,
            /validation error/,
            /state inconsistency/,
            /assertion failed/
        ])) {
            return ErrorType.LOGICAL;
        }
        // 默认为未知错误
        return ErrorType.UNKNOWN;
    }
    /**
     * 检查是否匹配任一模式
     */
    matchesAny(message, name, patterns) {
        return patterns.some(pattern => pattern.test(message) || pattern.test(name));
    }
}
/**
 * 恢复策略选择器
 */
class RecoveryStrategySelector {
    /**
     * 选择恢复策略
     */
    select(errorType, context) {
        switch (errorType) {
            case ErrorType.TRANSIENT:
                // 临时性错误：重试
                return {
                    action: RecoveryAction.RETRY,
                    parameters: {
                        maxAttempts: 3,
                        backoff: 'exponential',
                        initialDelay: 1000
                    },
                    automatic: true
                };
            case ErrorType.LOGICAL:
                // 逻辑错误：回滚并提示
                return {
                    action: RecoveryAction.ROLLBACK,
                    parameters: {
                        steps: 1,
                        reason: 'Logical error detected, rolling back one step'
                    },
                    automatic: true
                };
            case ErrorType.RESOURCE:
                // 资源错误：降级执行
                return {
                    action: RecoveryAction.DEGRADE,
                    parameters: {
                        mode: 'reduced_resource_usage',
                        reason: 'Resource constraints, using degraded mode'
                    },
                    automatic: true
                };
            case ErrorType.TIMEOUT:
                // 超时错误：跳过或使用默认值
                if (context.task.priority === 'low') {
                    return {
                        action: RecoveryAction.SKIP,
                        parameters: {
                            reason: 'Timeout on low priority task, skipping'
                        },
                        automatic: true
                    };
                }
                else {
                    return {
                        action: RecoveryAction.USE_DEFAULT,
                        parameters: {
                            defaultValue: this.getDefaultValue(context),
                            reason: 'Timeout, using default value'
                        },
                        automatic: true
                    };
                }
                ;
            case ErrorType.PERMANENT:
                // 永久性错误：需要人工介入
                return {
                    action: RecoveryAction.MANUAL_INTERVENTION,
                    parameters: {
                        reason: 'Permanent error requires manual intervention',
                        suggestions: this.getSuggestions(context)
                    },
                    automatic: false
                };
            case ErrorType.UNKNOWN:
            default:
                // 未知错误：尝试重试，失败则终止
                return {
                    action: RecoveryAction.RETRY,
                    parameters: {
                        maxAttempts: 1,
                        reason: 'Unknown error, attempting one retry'
                    },
                    automatic: true
                };
        }
    }
    /**
     * 获取默认值
     */
    getDefaultValue(context) {
        // 根据任务类型返回合适的默认值
        switch (context.task.type) {
            case 'code_generation':
                return '// Code generation failed, please implement manually';
            case 'test_generation':
                return '// Test generation failed, please write tests manually';
            case 'analysis':
                return { error: 'Analysis failed, manual review required' };
            default:
                return null;
        }
    }
    /**
     * 获取建议
     */
    getSuggestions(context) {
        const suggestions = [];
        if (context.task.type === 'code_generation') {
            suggestions.push('Check API credentials and permissions');
            suggestions.push('Verify the target repository is accessible');
            suggestions.push('Ensure the task has necessary scope');
        }
        if (context.task.type === 'test_generation') {
            suggestions.push('Verify test framework is properly configured');
            suggestions.push('Check if source files are accessible');
        }
        return suggestions;
    }
}
/**
 * 错误恢复系统实现
 */
class ErrorRecoverySystem {
    classifier;
    selector;
    constructor() {
        this.classifier = new ErrorClassifier();
        this.selector = new RecoveryStrategySelector();
    }
    /**
     * 恢复错误
     */
    async recover(error, context) {
        // 分类错误
        const errorType = this.classifier.classify(error);
        console.log(`[ErrorRecovery] Error classified as: ${errorType}`);
        // 选择恢复策略
        const plan = this.selector.select(errorType, context);
        console.log(`[ErrorRecovery] Selected recovery action: ${plan.action}`);
        // 执行恢复
        return await this.executePlan(plan, error, context);
    }
    /**
     * 执行恢复计划
     */
    async executePlan(plan, error, context) {
        switch (plan.action) {
            case RecoveryAction.RETRY:
                return await this.executeRetry(plan, error, context);
            case RecoveryAction.ROLLBACK:
                return await this.executeRollback(plan, context);
            case RecoveryAction.USE_DEFAULT:
                return await this.executeUseDefault(plan, context);
            case RecoveryAction.SKIP:
                return await this.executeSkip(plan, context);
            case RecoveryAction.DEGRADE:
                return await this.executeDegrade(plan, context);
            case RecoveryAction.MANUAL_INTERVENTION:
                return await this.executeManualIntervention(plan, error, context);
            case RecoveryAction.TERMINATE:
                return await this.executeTerminate(plan, error, context);
            default:
                console.error(`[ErrorRecovery] Unknown recovery action: ${plan.action}`);
                return false;
        }
    }
    /**
     * 执行重试
     * @param error 错误对象（未来可用于错误日志和重试策略决策）
     */
    async executeRetry(plan, _error, context) {
        const maxAttempts = plan.parameters?.maxAttempts || 1;
        const currentAttempt = context.state.errorCount;
        if (currentAttempt >= maxAttempts) {
            console.log(`[ErrorRecovery] Max retry attempts (${maxAttempts}) reached`);
            return false;
        }
        // 增加错误计数
        context.state.errorCount++;
        // 等待后重试
        const delay = this.calculateRetryDelay(currentAttempt, plan.parameters);
        console.log(`[ErrorRecovery] Waiting ${delay}ms before retry...`);
        await this.sleep(delay);
        console.log(`[ErrorRecovery] Retrying... (attempt ${currentAttempt + 1}/${maxAttempts})`);
        return true; // 返回 true 表示继续执行
    }
    /**
     * 执行回滚
     */
    async executeRollback(plan, context) {
        const steps = plan.parameters?.steps || 1;
        if (context.state.history.length <= steps) {
            console.log(`[ErrorRecovery] Cannot rollback: not enough history`);
            return false;
        }
        // 回滚指定步数
        for (let i = 0; i < steps; i++) {
            context.state.history.pop();
        }
        // 更新状态
        const lastState = context.state.history[context.state.history.length - 1];
        if (lastState) {
            context.state.phase = lastState.action.type;
            context.state.quality = lastState.quality || 0;
        }
        console.log(`[ErrorRecovery] Rolled back ${steps} steps`);
        return true;
    }
    /**
     * 使用默认值
     */
    async executeUseDefault(plan, context) {
        const defaultValue = plan.parameters?.defaultValue;
        console.log(`[ErrorRecovery] Using default value: ${defaultValue}`);
        // 添加到历史
        context.state.history.push({
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            action: {
                type: 'use_default',
                parameters: { defaultValue }
            },
            result: {
                success: true,
                data: defaultValue
            }
        });
        return true;
    }
    /**
     * 跳过步骤
     */
    async executeSkip(plan, context) {
        console.log(`[ErrorRecovery] Skipping step due to: ${plan.parameters?.reason}`);
        // 标记任务为完成
        context.task.done = true;
        return true;
    }
    /**
     * 降级执行
     */
    async executeDegrade(plan, context) {
        const mode = plan.parameters?.mode;
        console.log(`[ErrorRecovery] Degrading to mode: ${mode}`);
        // 修改任务配置以减少资源使用
        context.task.metadata = context.task.metadata || {};
        context.task.metadata.degradedMode = mode;
        context.task.metadata.degradedReason = plan.parameters?.reason;
        return true;
    }
    /**
     * 人工介入
     */
    async executeManualIntervention(plan, error, context) {
        console.error(`[ErrorRecovery] Manual intervention required:`);
        console.error(`  Reason: ${plan.parameters?.reason}`);
        console.error(`  Suggestions: ${plan.parameters?.suggestions}`);
        console.error(`  Error: ${error.message}`);
        // 标记任务需要人工介入
        context.task.metadata = context.task.metadata || {};
        context.task.metadata.manualIntervention = true;
        context.task.metadata.errorDetails = {
            message: error.message,
            suggestions: plan.parameters?.suggestions
        };
        return false; // 无法自动恢复
    }
    /**
     * 终止执行
     */
    async executeTerminate(plan, error, context) {
        console.error(`[ErrorRecovery] Terminating execution: ${plan.parameters?.reason}`);
        console.error(`  Error: ${error.message}`);
        // 标记任务为终止
        context.task.done = true;
        context.task.metadata = context.task.metadata || {};
        context.task.metadata.terminated = true;
        context.task.metadata.terminationReason = plan.parameters?.reason;
        return false;
    }
    /**
     * 计算重试延迟
     */
    calculateRetryDelay(attempt, parameters) {
        const backoff = parameters?.backoff || 'linear';
        const initialDelay = parameters?.initialDelay || 1000;
        switch (backoff) {
            case 'exponential':
                return initialDelay * Math.pow(2, attempt);
            case 'linear':
                return initialDelay * (attempt + 1);
            case 'fixed':
            default:
                return initialDelay;
        }
    }
    /**
     * 睡眠函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * 判断错误是否可恢复
     */
    canRecover(error) {
        const errorType = this.classifier.classify(error);
        return errorType !== ErrorType.PERMANENT;
    }
    /**
     * 获取错误信息
     */
    getErrorInfo(error) {
        const errorType = this.classifier.classify(error);
        return {
            code: error.name || 'UNKNOWN_ERROR',
            message: error.message,
            retryable: errorType === ErrorType.TRANSIENT || errorType === ErrorType.TIMEOUT,
            details: {
                type: errorType,
                stack: error.stack
            }
        };
    }
}
exports.ErrorRecoverySystem = ErrorRecoverySystem;
/**
 * 创建错误恢复系统实例
 */
function createErrorRecoverySystem() {
    return new ErrorRecoverySystem();
}
//# sourceMappingURL=error-recovery.js.map