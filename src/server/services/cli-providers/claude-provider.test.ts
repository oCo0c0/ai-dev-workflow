/**
 * @file claude-provider 模型档位合并逻辑单元测试
 * @description 回归：models.json 的 claude 记录中的模型必须合并进 loadModelOptions 下拉，
 *              否则「模型供应商」页添加的模型永远无法选择。
 */

import {describe, it, expect} from 'vitest';
import {mergeOwnModelsIntoTiers} from './claude-provider.js';

/** 构造 settings.json 档位形态的 tiers */
function makeTiers(): Array<{value: string; label: string; model: string}> {
    return [
        {value: 'haiku', label: 'Haiku', model: 'glm-5.1'},
        {value: 'sonnet', label: 'Sonnet', model: 'glm-5.3[1M]'},
    ];
}

describe('mergeOwnModelsIntoTiers', () => {
    it('returns tiers unchanged when record is missing', () => {
        const tiers = makeTiers();
        expect(mergeOwnModelsIntoTiers(tiers, undefined)).toEqual(tiers);
        expect(mergeOwnModelsIntoTiers(tiers, null)).toEqual(tiers);
    });

    it('appends record models with value=label=model', () => {
        const result = mergeOwnModelsIntoTiers(makeTiers(), {
            models: ['glm-5.3-flash', 'glm-5.3-flashx'],
        });
        expect(result).toHaveLength(4);
        expect(result.slice(2)).toEqual([
            {value: 'glm-5.3-flash', label: 'glm-5.3-flash', model: 'glm-5.3-flash'},
            {value: 'glm-5.3-flashx', label: 'glm-5.3-flashx', model: 'glm-5.3-flashx'},
        ]);
    });

    it('moves defaultModel to top and dedupes it from models', () => {
        const result = mergeOwnModelsIntoTiers(makeTiers(), {
            models: ['glm-5.3-flashx', 'glm-5.3-flash'],
            defaultModel: 'glm-5.3-flash',
        });
        expect(result[2]).toEqual({value: 'glm-5.3-flash', label: 'glm-5.3-flash', model: 'glm-5.3-flash'});
        expect(result[3]).toEqual({value: 'glm-5.3-flashx', label: 'glm-5.3-flashx', model: 'glm-5.3-flashx'});
    });

    it('adds defaultModel even when absent from models list', () => {
        const result = mergeOwnModelsIntoTiers(makeTiers(), {
            models: ['glm-5.3'],
            defaultModel: 'glm-5.3-flash',
        });
        expect(result.map((t) => t.value)).toEqual(['haiku', 'sonnet', 'glm-5.3-flash', 'glm-5.3']);
    });

    it('skips models duplicating a tier model or value or list entry', () => {
        const result = mergeOwnModelsIntoTiers(makeTiers(), {
            models: ['glm-5.1', 'haiku', 'glm-5.3', 'glm-5.3'],
        });
        expect(result.map((t) => t.value)).toEqual(['haiku', 'sonnet', 'glm-5.3']);
    });

    it('does not mutate the input tiers array', () => {
        const tiers = makeTiers();
        const snapshot = tiers.map((t) => ({...t}));
        mergeOwnModelsIntoTiers(tiers, {models: ['glm-5.3-flash']});
        expect(tiers).toEqual(snapshot);
    });
});
