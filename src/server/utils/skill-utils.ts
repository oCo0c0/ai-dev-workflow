/**
 * @module skill-utils
 * @description 技能（Skill）配置解析工具模块
 *
 * 提供 SkillSetConfig 配置对象的解析和转换功能，用于将面向用户的技能配置
 * 转换为 Claude Bridge 所需的参数格式。
 *
 * 主要功能：
 * - 将 SkillSetConfig 解析为具体的技能名称数组或 'all' 标识
 * - 支持按流水线阶段（plan / execution / test）获取技能配置
 * - 向后兼容旧的 skillSet 配置字段
 *
 * @example
 * ```typescript
 * // 解析单一技能配置
 * const skills = resolveSkills({ mode: 'all' }); // => 'all'
 *
 * // 按阶段获取技能
 * const planSkills = getPhaseSkills(steps, 'plan'); // => string[] | 'all' | undefined
 * ```
 */

import type {SkillSetConfig, PhaseToolsConfig, MCPToolSetConfig} from '../services/pipeline-service.js';
import type {MCPServerConfig} from '../services/mcp-config-service.js';
import type {McpStdioMap} from '../services/cli-providers/types.js';
import {readdirSync} from 'fs';
import {join} from 'path';

/**
 * 将 SkillSetConfig 配置对象解析为 Claude Bridge 可直接使用的技能参数。
 *
 * 解析规则：
 * 1. 若 config 为 undefined/null，返回 undefined（未配置技能）
 * 2. 若 mode 为 'all'，返回字符串 'all'（表示启用全部技能）
 * 3. 若 selectedSkills 数组为空，返回 undefined（虽然配置了但未选择任何技能）
 * 4. 否则返回 selectedSkills 数组（具体选中的技能名称列表）
 *
 * @param {SkillSetConfig | undefined} skillConfig - 技能配置对象，可能为 undefined
 * @returns {string[] | 'all' | undefined} 解析后的技能参数：
 *   - string[]: 选中的技能名称数组
 *   - 'all': 启用所有技能
 *   - undefined: 未配置或无有效选择
 */
export function resolveSkills(
    skillConfig: SkillSetConfig | undefined
): string[] | 'all' | undefined {
    if (!skillConfig) return undefined;
    if (skillConfig.mode === 'all') return 'all';
    if (skillConfig.selectedSkills.length === 0) return undefined;
    return skillConfig.selectedSkills;
}

/**
 * 获取指定流水线阶段的有效技能配置。
 *
 * 支持新旧两种配置方式兼容（新模型优先）：
 * - 新方式：按阶段独立的 PhaseToolsConfig（plan/execution/test），skills 为数组，空数组 = 不启用
 * - 旧方式：阶段专属 SkillSetConfig（planSkills 等）→ 通用 skillSet，按 mode 解析
 * - Agent模式：agentMode='agent'时返回Agent配置对象
 *
 * 优先级：新阶段配置（steps[phase]）> 旧阶段 SkillSetConfig > 通用 skillSet
 *
 * @param steps - 包含各阶段配置的对象
 * @param phase - 流水线阶段名称
 * @returns 该阶段的有效技能参数：
 *   - string[]: 技能名称数组
 *   - 'all': 启用所有技能
 *   - {mode: 'agent'}: Agent模式配置（不需要agentId）
 *   - undefined: 不启用
 */
export function getPhaseSkills(
    steps: {
        plan?: PhaseToolsConfig;
        execution?: PhaseToolsConfig;
        test?: PhaseToolsConfig;
        planSkills?: SkillSetConfig;
        executionSkills?: SkillSetConfig;
        testSkills?: SkillSetConfig;
        skillSet?: SkillSetConfig;
    },
    phase: 'plan' | 'execution' | 'test'
): string[] | 'all' | undefined | { mode: 'agent' } {
    // 新模型优先：该阶段存在 PhaseToolsConfig 时，直接用其 skills（空数组 → undefined 不启用）
    const phaseCfg = steps[phase];
    if (phaseCfg !== undefined) {
        // Agent模式：返回标识符，让协调Agent自主决策
        if (phaseCfg.agentMode === 'agent') {
            return {mode: 'agent'};
        }
        return phaseCfg.skills.length > 0 ? phaseCfg.skills : undefined;
    }

    // 旧模型回退：阶段专属 SkillSetConfig → 通用 skillSet，按 mode 解析
    const legacyField = phase === 'plan' ? steps.planSkills
        : phase === 'execution' ? steps.executionSkills
            : steps.testSkills;
    return resolveSkills(legacyField ?? steps.skillSet);
}

/**
 * 获取指定流水线阶段的有效 MCP 服务器名列表。
 *
 * 新旧兼容（新模型优先）：
 * - 新方式：steps[phase].mcpServers，空数组 = 不启用（undefined）
 * - 旧方式：全局 mcpToolSet，'selected' → selectedServers，'all' → undefined（新模型无"全部"概念）
 *
 * @param steps - 包含各阶段配置的对象
 * @param phase - 流水线阶段名称
 * @returns 该阶段启用的 MCP 服务器名数组，undefined = 不约束（claude 走全局默认）
 */
export function getPhaseMcpServers(
    steps: {
        plan?: PhaseToolsConfig;
        execution?: PhaseToolsConfig;
        test?: PhaseToolsConfig;
        mcpToolSet?: MCPToolSetConfig;
    },
    phase: 'plan' | 'execution' | 'test'
): string[] | undefined {
    // 新模型优先
    const phaseCfg = steps[phase];
    if (phaseCfg !== undefined) {
        return phaseCfg.mcpServers.length > 0 ? phaseCfg.mcpServers : undefined;
    }

    // 旧全局 mcpToolSet 回退：仅 'selected' 有具体名单，'all' 无对应（新模型逐个列名）
    if (steps.mcpToolSet && steps.mcpToolSet.mode === 'selected') {
        return steps.mcpToolSet.selectedServers.length > 0
            ? steps.mcpToolSet.selectedServers
            : undefined;
    }
    return undefined;
}

/**
 * 将 MCP 服务器名数组解析为 SDK 可用的 stdio 配置 map（McpStdioMap 类型见 cli-providers/types）。
 *
 * 主进程用 MCPConfigService.get 权威解析（合并 ~/.claude.json + settings.json），
 * 不让 bridge 子进程重读文件——避免重写解析逻辑引入二次 bug。
 * 找不到的服务器名收集到 missing，由调用方记 warning 跳过。
 *
 * @param names - MCP 服务器名数组（undefined/空 → 不约束，返回 undefined）
 * @param mcpService - MCP 配置源（MCPRegistryService / MCPConfigService，均实现 get(name)）
 * @returns { map, missing }：map 为 SDK 注入用配置，undefined 表示不注入；missing 为未找到的服务器名
 */
export function resolveMcpServerMap(
    names: string[] | undefined,
    mcpService: {get(name: string): MCPServerConfig | undefined}
): { map: McpStdioMap | undefined; missing: string[] } {
    if (!names || names.length === 0) return {map: undefined, missing: []};
    const map: McpStdioMap = {};
    const missing: string[] = [];
    for (const name of names) {
        const cfg = mcpService.get(name);
        if (cfg) {
            // 固定 'stdio' 传输协议；绝不透传 MCPServerConfig.type（运行时推断）
            map[name] = {type: 'stdio', command: cfg.command, args: cfg.args, env: cfg.env};
        } else {
            missing.push(name);
        }
    }
    return {map: Object.keys(map).length > 0 ? map : undefined, missing};
}

/**
 * 在技能子目录中查找主 .md 文件。
 * 优先 SKILL.md > index.md > 第一个 .md 文件。
 */
export function findSkillMdFile(dirPath: string): string | null {
    try {
        const files = readdirSync(dirPath);
        const skillMd = files.find(f => f === 'SKILL.md');
        if (skillMd) return join(dirPath, skillMd);
        const indexMd = files.find(f => f === 'index.md');
        if (indexMd) return join(dirPath, indexMd);
        const firstMd = files.find(f => f.endsWith('.md'));
        if (firstMd) return join(dirPath, firstMd);
        return null;
    } catch {
        return null;
    }
}
