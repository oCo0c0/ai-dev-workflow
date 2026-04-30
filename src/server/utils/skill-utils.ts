import type { SkillSetConfig } from '../services/pipeline-service.js';

/**
 * Convert a SkillSetConfig to the skills parameter for Claude bridge.
 * Returns 'all' if mode is 'all', or the selected skill names array.
 * Returns undefined if no skills configured.
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
 * Get the effective skill config for a phase, falling back to legacy skillSet.
 */
export function getPhaseSkills(
  steps: {
    planSkills?: SkillSetConfig;
    executionSkills?: SkillSetConfig;
    testSkills?: SkillSetConfig;
    skillSet?: SkillSetConfig;
  },
  phase: 'plan' | 'execution' | 'test'
): string[] | 'all' | undefined {
  let config: SkillSetConfig | undefined;

  switch (phase) {
    case 'plan':
      config = steps.planSkills ?? steps.skillSet;
      break;
    case 'execution':
      config = steps.executionSkills ?? steps.skillSet;
      break;
    case 'test':
      config = steps.testSkills ?? steps.skillSet;
      break;
  }

  return resolveSkills(config);
}
