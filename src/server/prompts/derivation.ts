/**
 * @module prompts/derivation
 * @description 技能提炼 prompt 模板（LLM 从执行证据中提炼可复用技能）。
 * 占位符：{{pattern}} / {{workspacePath}} / {{evidence}}，由 renderPrompt 渲染。
 */

export const DERIVE_SKILL_PROMPT = `你是技能提炼专家。基于以下执行证据，提炼一条可复用的 Claude Code 技能。

模式类型：{{pattern}}
工作区：{{workspacePath}}

执行证据：
{{evidence}}

## 输出要求
输出一个 JSON 对象（不要输出 markdown 代码块外的任何解释）：
{
  "skillName": "小写连字符命名，3-50 字符",
  "trigger": "何时触发，一句话",
  "summary": "学到什么，1-2 句话",
  "steps": ["可执行步骤，3-8 条"],
  "checklist": ["执行前检查项，0-5 条"],
  "confidence": 0.0~1.0 的数字,
  "rationale": "为什么提炼此技能（引用证据中的失败/恢复）"
}`;
