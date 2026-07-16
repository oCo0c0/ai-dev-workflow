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
import { ExecutionContext, ErrorInfo } from './types.js';
/**
 * 错误恢复系统实现
 */
export declare class ErrorRecoverySystem {
    private classifier;
    private selector;
    constructor();
    /**
     * 恢复错误
     */
    recover(error: Error, context: ExecutionContext): Promise<boolean>;
    /**
     * 执行恢复计划
     */
    private executePlan;
    /**
     * 执行重试
     * @param error 错误对象（未来可用于错误日志和重试策略决策）
     */
    private executeRetry;
    /**
     * 执行回滚
     */
    private executeRollback;
    /**
     * 使用默认值
     */
    private executeUseDefault;
    /**
     * 跳过步骤
     */
    private executeSkip;
    /**
     * 降级执行
     */
    private executeDegrade;
    /**
     * 人工介入
     */
    private executeManualIntervention;
    /**
     * 终止执行
     */
    private executeTerminate;
    /**
     * 计算重试延迟
     */
    private calculateRetryDelay;
    /**
     * 睡眠函数
     */
    private sleep;
    /**
     * 判断错误是否可恢复
     */
    canRecover(error: Error): boolean;
    /**
     * 获取错误信息
     */
    getErrorInfo(error: Error): ErrorInfo;
}
/**
 * 创建错误恢复系统实例
 */
export declare function createErrorRecoverySystem(): ErrorRecoverySystem;
//# sourceMappingURL=error-recovery.d.ts.map