/**
 * @module platform/tool-catalog
 * @description 工具名 → 平台分类的归一化目录
 *
 * 平台化改造的核心：编排层不再硬编码某个引擎的工具名集合
 * （原 agent-coordinator 的 STEP_TOOLS 只认识 Claude 工具名），
 * 而是通过本目录把任意引擎的工具名归一化为 ToolCategory。
 *
 * 新增引擎时只需在 KNOWN_TOOL_CATEGORIES 补充该引擎的工具名映射，
 * 编排层零改动。
 */

import type {ToolCategory} from './types.js';

/**
 * 已知工具名 → 分类映射表
 * @description 覆盖三个内置引擎的原生工具名 + 通用 MCP 命名规则
 */
const KNOWN_TOOL_CATEGORIES: ReadonlyMap<string, ToolCategory> = new Map([
    // Claude Code 内置工具
    ['Write', 'write'],
    ['Edit', 'write'],
    ['NotebookEdit', 'write'],
    ['MultiEdit', 'write'],
    ['Bash', 'shell'],
    ['Read', 'read'],
    ['Grep', 'read'],
    ['Glob', 'read'],
    ['LS', 'read'],
    ['WebFetch', 'read'],
    ['WebSearch', 'read'],
    ['TodoWrite', 'task'],
    ['TaskCreate', 'task'],
    ['TaskUpdate', 'task'],
    ['Task', 'task'],
    ['Workflow', 'task'],
    ['Skill', 'task'],
    ['AskUserQuestion', 'task'],
    ['ExitPlanMode', 'task'],
    ['CronCreate', 'schedule'],
    ['CronDelete', 'schedule'],
    ['CronUpdate', 'schedule'],

    // pi 内置工具（小写命名）
    ['write', 'write'],
    ['edit', 'write'],
    ['bash', 'shell'],
    ['powershell', 'shell'],
    ['read', 'read'],
    ['grep', 'read'],
    ['find', 'read'],
    ['ls', 'read'],

    // OpenAI Codex 内置工具
    ['shell', 'shell'],
    ['apply_patch', 'write'],
    ['update_plan', 'task'],
    ['view_image', 'read'],
]);

/** MCP 工具的引擎侧命名前缀（Claude: mcp__server__tool） */
const MCP_TOOL_PREFIX = 'mcp__';

/**
 * 将任意引擎的工具名归一化为平台分类
 * @param toolName - 引擎上报的工具名（大小写敏感，按各引擎原生命名匹配）
 * @returns 平台分类；未知工具名归为 'mcp'（外部扩展工具，按需观察）
 */
export function classifyToolName(toolName: string): ToolCategory {
    const direct = KNOWN_TOOL_CATEGORIES.get(toolName);
    if (direct) return direct;

    // MCP 工具（mcp__server__tool）与平台注册的自定义工具一律归 'mcp'
    if (toolName.startsWith(MCP_TOOL_PREFIX)) return 'mcp';

    return 'mcp';
}

/**
 * 判断工具是否值得在步骤面板创建独立步骤
 * @description 写类/Shell/任务/定时类工具产生可观察的工作成果；
 * 只读工具（Read/Grep 等）是过程噪声，只记日志不建步骤。
 */
export function isStepWorthyTool(toolName: string): boolean {
    const category = classifyToolName(toolName);
    return category === 'write' || category === 'shell' || category === 'task' || category === 'schedule';
}
