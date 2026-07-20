"use strict";
/**
 * @file 共享Agent类型定义
 * @description 服务端和客户端共享的Agent系统类型定义
 *          作为单一真实来源,消除重复定义
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExecutionRunning = isExecutionRunning;
exports.isExecutionCompleted = isExecutionCompleted;
exports.isExecutionFailed = isExecutionFailed;
exports.isExecutionAborted = isExecutionAborted;
exports.isExecutionPaused = isExecutionPaused;
// === 类型守卫函数 ===
/**
 * 检查执行是否正在运行
 */
function isExecutionRunning(execution) {
    return execution.status === 'running';
}
/**
 * 检查执行是否成功完成
 */
function isExecutionCompleted(execution) {
    return execution.status === 'completed';
}
/**
 * 检查执行是否失败
 */
function isExecutionFailed(execution) {
    return execution.status === 'failed';
}
/**
 * 检查执行是否已中止
 */
function isExecutionAborted(execution) {
    return execution.status === 'aborted';
}
/**
 * 检查执行是否已暂停
 */
function isExecutionPaused(execution) {
    return execution.status === 'paused';
}
//# sourceMappingURL=agent-types.js.map