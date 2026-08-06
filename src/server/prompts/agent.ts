/**
 * @module prompts/agent
 * @description Agent 自主执行 prompt 模板。
 */

/** 首次执行：请 Agent 完成需求 */
export const AGENT_START_PROMPT = `请完成以下需求：

{{requirementText}}

工作区：{{cwd}}

请开始工作。`;

/** 续接会话：带上用户补充信息 */
export const AGENT_REPLY_PROMPT = `用户补充了以下信息：

{{repliesText}}

请根据以上补充继续工作。`;

/** Agent 任务分解 prompt：拆成 2-8 个串行子任务，只输出 JSON */
export const AGENT_DECOMPOSE_PROMPT = `你是软件开发任务分解专家。请将以下需求拆解为 2-8 个可串行执行的子任务。

需求：
{{requirementText}}

工作区：{{cwd}}

## 拆解要求
1. 子任务相互独立、按依赖顺序串行执行
2. 每个子任务在单个会话内可完成
3. 第一个子任务先理解需求与环境，最后一个子任务验证整体结果
4. 不要拆解为过细的琐碎步骤

## 输出要求
只输出一个 JSON 对象（不要输出 markdown 代码块外的任何解释）：
{
  "subTasks": [
    {"id": "sub-1", "title": "简短标题", "description": "任务描述"}
  ]
}`;

/** 单个子任务的执行 prompt（串行循环中逐个子任务调用） */
export const AGENT_SUBTASK_PROMPT = `请完成以下子任务。
子任务：{{subTaskTitle}}
详情：{{subTaskDescription}}

已完成的前序子任务：
{{completedTitles}}

请独立完成本子任务并验证结果。`;
