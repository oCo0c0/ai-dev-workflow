/**
 * @module prompt-renderer
 * @description Prompt 模板渲染器（纯函数，无副作用）。
 *
 * 模板占位符统一用 `{{var}}`：
 * - 避免 String.replace('{x}') 只替换首次出现的 bug；
 * - 与模板内字面量 `${}`（如 shell 片段）互不冲突，renderer 只匹配 `{{...}}`。
 *
 * 与 prompt-enrichment 的 `enrichPrompt` 正交：
 * - `renderPrompt`：模板占位符渲染（数据 → 文本）
 * - `enrichPrompt`：注入记忆上下文（记忆 → 文本）
 * 调用顺序：`enrichPrompt(renderPrompt(...), memoryService, workspacePath)`。
 */

/** 模板变量集合（undefined 视作未提供，strict 模式下抛错） */
export type PromptVars = Record<string, string | number | boolean | undefined>;

/**
 * 渲染 prompt 模板，替换所有 `{{var}}` 占位符。
 *
 * @param template - 模板文本，占位符形如 `{{title}}`
 * @param vars - 变量集合；缺失时默认保留原占位符（strict 则抛错）
 * @param opts - 选项
 * @returns 渲染后的文本
 */
export function renderPrompt(
    template: string,
    vars: PromptVars,
    opts?: {strict?: boolean},
): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
        const value = vars[key];
        if (value == null) {
            if (opts?.strict) throw new Error(`Missing prompt var: ${key}`);
            return match;
        }
        return String(value);
    });
}

/** 模板命名常量（避免魔法字符串），按域分组 */
export const PROMPT_NAMES = {
    plan: 'plan',
    planResume: 'plan-resume',
    taskBreakdown: 'task-breakdown',
    executionRetry: 'execution-retry',
    executionSkip: 'execution-skip',
    testAnalyze: 'test-analyze',
    testWriteOnly: 'test-write-only',
    testFix: 'test-fix',
    testE2e: 'test-e2e',
    agentStart: 'agent-start',
    agentReply: 'agent-reply',
    agentSubTask: 'agent-subtask',
    agentDecompose: 'agent-decompose',
    deriveSkill: 'derive-skill',
} as const;

export type PromptName = (typeof PROMPT_NAMES)[keyof typeof PROMPT_NAMES];
