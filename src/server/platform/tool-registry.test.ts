/**
 * @module platform/tool-registry.test
 * @description 平台工具注册表单元测试
 */

import {describe, it, expect} from 'vitest';
import {PlatformToolRegistry, toPiCustomTool} from './tool-registry.js';
import type {PlatformToolDefinition} from './types.js';

/** 构造测试用平台工具 */
function makeTool(overrides?: Partial<PlatformToolDefinition>): PlatformToolDefinition {
    return {
        name: 'demo_tool',
        label: 'Demo Tool',
        description: 'A demo platform tool',
        category: 'mcp',
        inputSchema: {type: 'object', properties: {q: {type: 'string'}}, required: ['q']},
        execute: async (args) => ({text: `result:${String(args.q ?? '')}`}),
        ...overrides,
    };
}

describe('PlatformToolRegistry', () => {
    it('注册并列表', () => {
        const registry = new PlatformToolRegistry();
        registry.register(makeTool());
        expect(registry.list()).toHaveLength(1);
        expect(registry.get('demo_tool')?.label).toBe('Demo Tool');
    });

    it('同名覆盖（热更新语义）', () => {
        const registry = new PlatformToolRegistry();
        registry.register(makeTool());
        registry.register(makeTool({label: 'Updated'}));
        expect(registry.list()).toHaveLength(1);
        expect(registry.get('demo_tool')?.label).toBe('Updated');
    });

    it('非法工具名（空/含空格）抛出', () => {
        const registry = new PlatformToolRegistry();
        expect(() => registry.register(makeTool({name: ''}))).toThrow();
        expect(() => registry.register(makeTool({name: 'bad name'}))).toThrow();
    });

    it('注销工具', () => {
        const registry = new PlatformToolRegistry();
        registry.register(makeTool());
        registry.unregister('demo_tool');
        expect(registry.list()).toHaveLength(0);
    });
});

describe('toPiCustomTool', () => {
    it('投影保留名称/描述/schema，execute 归一化结果', async () => {
        const tool = makeTool();
        const projected = toPiCustomTool(tool, 'pi') as {
            name: string;
            label: string;
            parameters: unknown;
            execute: (id: string, args: Record<string, unknown>) => Promise<{content: Array<{type: string; text: string}>}>;
        };

        expect(projected.name).toBe('demo_tool');
        expect(projected.label).toBe('Demo Tool');
        expect(projected.parameters).toBe(tool.inputSchema);

        const result = await projected.execute('call-1', {q: 'hello'});
        expect(result.content).toEqual([{type: 'text', text: 'result:hello'}]);
    });

    it('execute 抛出时错误向上传播（由引擎兜底转错误结果）', async () => {
        const tool = makeTool({
            execute: async () => {
                throw new Error('boom');
            },
        });
        const projected = toPiCustomTool(tool, 'pi') as {execute: (id: string, args: Record<string, unknown>) => Promise<unknown>};
        await expect(projected.execute('call-1', {})).rejects.toThrow('boom');
    });
});
