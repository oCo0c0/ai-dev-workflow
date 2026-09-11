/**
 * overlayColorsFor 单元测试
 *
 * 窗口控制按钮覆盖层配色需与前端主题顶栏一致：
 * 深色主题用主背景 #142d3c，浅色主题用浅色顶栏底色。
 */

import {describe, it, expect} from 'vitest';
import {overlayColorsFor} from './titlebar-theme.js';

describe('overlayColorsFor', () => {
    it('深色主题返回主题主背景配色', () => {
        expect(overlayColorsFor('dark')).toEqual({color: '#142d3c', symbolColor: '#e2e8f0'});
    });

    it('浅色主题返回浅色顶栏配色（符号为深色）', () => {
        const light = overlayColorsFor('light');
        expect(light.color).toBe('#f4f4f5');
        expect(light.symbolColor).toBe('#3f3f46');
    });

    it('两个主题的符号色与底色有足够对比度', () => {
        for (const theme of ['dark', 'light'] as const) {
            const {color, symbolColor} = overlayColorsFor(theme);
            expect(color).not.toBe(symbolColor);
        }
    });
});
