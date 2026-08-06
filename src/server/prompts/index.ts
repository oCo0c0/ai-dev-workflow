/**
 * @module prompts
 * @description Prompt 模板集中管理目录入口。
 *
 * 所有 LLM prompt 模板集中于此，统一命名、统一渲染（renderPrompt）：
 * - plan / execution / test / agent / derivation 各域一个文件
 * - 渲染：`enrichPrompt(renderPrompt(PROMPTS.xxx, {...}), memoryService, workspacePath)`
 */
export * from './plan.js';
export * from './execution.js';
export * from './test.js';
export * from './agent.js';
export * from './derivation.js';

import {PLAN_PROMPT, PLAN_RESUME_PROMPT, TASK_BREAKDOWN_PROMPT} from './plan.js';
import {EXECUTION_RETRY_PROMPT, EXECUTION_SKIP_PROMPT} from './execution.js';
import {
    TEST_ANALYZE_PROMPT,
    TEST_ANALYZE_AUTO_PROMPT,
    TEST_WRITE_ONLY_PROMPT,
    TEST_FIX_PROMPT,
    TEST_E2E_PROMPT,
    TEST_WRITE_ONLY_AUTO_PROMPT,
    TEST_E2E_AUTO_PROMPT,
} from './test.js';
import {AGENT_START_PROMPT, AGENT_REPLY_PROMPT, AGENT_DECOMPOSE_PROMPT, AGENT_SUBTASK_PROMPT} from './agent.js';
import {DERIVE_SKILL_PROMPT} from './derivation.js';

/** 聚合导出：key 与 PROMPT_NAMES 对齐，便于 `renderPrompt(PROMPTS.plan, {...})` */
export const PROMPTS = {
    plan: PLAN_PROMPT,
    planResume: PLAN_RESUME_PROMPT,
    taskBreakdown: TASK_BREAKDOWN_PROMPT,
    executionRetry: EXECUTION_RETRY_PROMPT,
    executionSkip: EXECUTION_SKIP_PROMPT,
    testAnalyze: TEST_ANALYZE_PROMPT,
    testAnalyzeAuto: TEST_ANALYZE_AUTO_PROMPT,
    testWriteOnly: TEST_WRITE_ONLY_PROMPT,
    testWriteOnlyAuto: TEST_WRITE_ONLY_AUTO_PROMPT,
    testFix: TEST_FIX_PROMPT,
    testE2e: TEST_E2E_PROMPT,
    testE2eAuto: TEST_E2E_AUTO_PROMPT,
    agentStart: AGENT_START_PROMPT,
    agentReply: AGENT_REPLY_PROMPT,
    agentDecompose: AGENT_DECOMPOSE_PROMPT,
    agentSubTask: AGENT_SUBTASK_PROMPT,
    deriveSkill: DERIVE_SKILL_PROMPT,
} as const;
