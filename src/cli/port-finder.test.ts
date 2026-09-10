/**
 * resolvePreferredPort 单元测试
 *
 * 覆盖 ADW_PORT 环境变量与配置文件端口的优先级与容错规则。
 */

import {describe, it, expect} from 'vitest';
import {resolvePreferredPort} from './port-finder.js';

describe('resolvePreferredPort', () => {
    it('合法环境变量端口优先于配置文件', () => {
        expect(resolvePreferredPort('4321', 3000)).toBe(4321);
    });

    it('非法环境变量（非数字）回退配置文件', () => {
        expect(resolvePreferredPort('abc', 3000)).toBe(3000);
    });

    it('越界环境变量（<1024 / >65535）回退配置文件', () => {
        expect(resolvePreferredPort('80', 3000)).toBe(3000);
        expect(resolvePreferredPort('70000', 3000)).toBe(3000);
    });

    it('零与空字符串回退配置文件', () => {
        expect(resolvePreferredPort('0', 3000)).toBe(3000);
        expect(resolvePreferredPort('', 3000)).toBe(3000);
    });

    it('环境变量缺省时使用配置值', () => {
        expect(resolvePreferredPort(undefined, 3000)).toBe(3000);
    });

    it('两者皆缺省返回 undefined', () => {
        expect(resolvePreferredPort(undefined, undefined)).toBeUndefined();
    });
});
