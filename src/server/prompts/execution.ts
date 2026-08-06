/**
 * @module prompts/execution
 * @description 代码执行阶段 prompt 模板。
 */

/** 步骤失败后重试：沿用 sessionId 续接当前步骤 */
export const EXECUTION_RETRY_PROMPT = `The previous execution step failed. Please retry the current step. Continue from where you left off.`;

/** 跳过当前步骤后继续后续步骤 */
export const EXECUTION_SKIP_PROMPT = `The previous step was skipped. Please continue with the next step.`;
