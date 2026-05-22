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
import type { SkillSetConfig } from '../services/pipeline-service.js';
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
export declare function resolveSkills(skillConfig: SkillSetConfig | undefined): string[] | 'all' | undefined;
/**
 * 获取指定流水线阶段的有效技能配置。
 *
 * 支持新旧两种配置方式的兼容：
 * - 新方式：按阶段独立配置（planSkills / executionSkills / testSkills）
 * - 旧方式：统一的 skillSet 字段作为所有阶段的回退默认值
 *
 * 优先级：阶段专属配置 > 通用 skillSet 配置
 *
 * @param {Object} steps - 包含各阶段技能配置的对象
 * @param {SkillSetConfig} [steps.planSkills] - 规划阶段（plan）的技能配置
 * @param {SkillSetConfig} [steps.executionSkills] - 执行阶段（execution）的技能配置
 * @param {SkillSetConfig} [steps.testSkills] - 测试阶段（test）的技能配置
 * @param {SkillSetConfig} [steps.skillSet] - 旧版通用技能配置（向后兼容回退）
 * @param {'plan'|'execution'|'test'} phase - 流水线阶段名称
 * @returns {string[] | 'all' | undefined} 该阶段的有效技能参数
 *
 * @example
 * ```typescript
 * const steps = {
 *   planSkills: { mode: 'selected', selectedSkills: ['research', 'analyze'] },
 *   executionSkills: { mode: 'all' },
 *   skillSet: { mode: 'selected', selectedSkills: ['default'] },  // 旧版回退配置
 * };
 *
 * getPhaseSkills(steps, 'plan');       // => ['research', 'analyze']
 * getPhaseSkills(steps, 'execution');  // => 'all'
 * getPhaseSkills(steps, 'test');       // => ['default']（回退到 skillSet）
 * ```
 */
export declare function getPhaseSkills(steps: {
    planSkills?: SkillSetConfig;
    executionSkills?: SkillSetConfig;
    testSkills?: SkillSetConfig;
    skillSet?: SkillSetConfig;
}, phase: 'plan' | 'execution' | 'test'): string[] | 'all' | undefined;
//# sourceMappingURL=skill-utils.d.ts.map