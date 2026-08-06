/**
 * @module prompts/plan
 * @description 计划生成相关 prompt 模板。
 * 占位符：{{title}} / {{description}} / {{skillName}} / {{reqId}} / {{planContent}}，由 renderPrompt 渲染。
 */

/** 计划生成系统提示（多用途：生成 / 重新生成 / 继续技能） */
export const PLAN_PROMPT = `Analyze the following requirement and generate a structured development plan.

## Requirement
{{title}}

{{description}}

## Instructions
Generate a development plan. Respond in the same language as the requirement.`;

/** 暂停后恢复生成的续接提示 */
export const PLAN_RESUME_PROMPT = `Continue generating the development plan from where you left off.`;

/** 任务拆分 + 工时评估技能调用提示（喂给 task-breakdown-estimator 技能） */
export const TASK_BREAKDOWN_PROMPT = `使用 {{skillName}} 技能完成需求任务拆分 + 工时评估，按技能 SKILL.md 要求输出完整 17 列 markdown 表格 + 工时汇总 + 风险说明。

【重要】所有输入已提供，禁止追问用户。未知字段填 "—"（除必填：标题、描述、状态="未开始"、工作项类型="任务"、预估工时、任务拆解类型、任务复杂度填"简单/中等/复杂"）。

输入参数：
- 需求号ID：{{reqId}}
- 需求标题：{{title}}
- 负责人：—
- 所属项目：根据需求内容从技能 SKILL.md「所属项目 Enum」中自动匹配最接近的值
- 所属产品：根据需求内容从技能 SKILL.md「所属产品 Enum」中自动匹配最接近的值
- 开发主程：—
- 测试主程：—
- 计划周期：— ~ —

需求描述：
{{description}}

开发计划（change points 分析）：
{{planContent}}

立即输出完整表格，不要追问。

在输出 markdown 表格后，再以 \`\`\`json 围栏代码块输出同一份任务列表（仅任务行对象数组，字段用英文 key）。`;
