/**
 * @module platform/tool-catalog.test
 * @description 工具名 → 平台分类目录的单元测试
 */

import {describe, it, expect} from 'vitest';
import {classifyToolName, isStepWorthyTool} from './tool-catalog.js';

describe('tool-catalog', () => {
    describe('classifyToolName', () => {
        it('Claude 内置工具正确分类', () => {
            expect(classifyToolName('Write')).toBe('write');
            expect(classifyToolName('Edit')).toBe('write');
            expect(classifyToolName('Bash')).toBe('shell');
            expect(classifyToolName('Read')).toBe('read');
            expect(classifyToolName('Grep')).toBe('read');
            expect(classifyToolName('TaskCreate')).toBe('task');
            expect(classifyToolName('CronDelete')).toBe('schedule');
        });

        it('pi 内置工具（小写命名）正确分类', () => {
            expect(classifyToolName('write')).toBe('write');
            expect(classifyToolName('bash')).toBe('shell');
            expect(classifyToolName('powershell')).toBe('shell');
            expect(classifyToolName('read')).toBe('read');
        });

        it('MCP 前缀工具归类为 mcp', () => {
            expect(classifyToolName('mcp__ones__get_requirement')).toBe('mcp');
        });

        it('未知工具名归类为 mcp（外部扩展）', () => {
            expect(classifyToolName('SomeUnknownTool')).toBe('mcp');
        });
    });

    describe('isStepWorthyTool', () => {
        it('写类/Shell/任务/定时工具创建步骤', () => {
            expect(isStepWorthyTool('Write')).toBe(true);
            expect(isStepWorthyTool('Edit')).toBe(true);
            expect(isStepWorthyTool('Bash')).toBe(true);
            expect(isStepWorthyTool('bash')).toBe(true);
            expect(isStepWorthyTool('TaskCreate')).toBe(true);
            expect(isStepWorthyTool('CronCreate')).toBe(true);
        });

        it('只读工具不创建步骤（过程噪声）', () => {
            expect(isStepWorthyTool('Read')).toBe(false);
            expect(isStepWorthyTool('read')).toBe(false);
            expect(isStepWorthyTool('Grep')).toBe(false);
            expect(isStepWorthyTool('Glob')).toBe(false);
        });

        it('MCP/未知工具不创建步骤', () => {
            expect(isStepWorthyTool('mcp__ones__query')).toBe(false);
            expect(isStepWorthyTool('Whatever')).toBe(false);
        });
    });
});
