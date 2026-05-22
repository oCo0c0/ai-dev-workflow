/**
 * @file workspace-service.test.ts
 * @description WorkspaceService（工作空间服务）的单元测试文件
 *
 * 本测试文件覆盖了 WorkspaceService 的核心功能，包括：
 * - 目录浏览：列出指定路径下的文件和子目录条目
 * - 路径验证：检查路径是否存在、是否为目录
 * - 工作空间历史记录管理：添加、去重、排序和数量限制
 *
 * 测试策略：使用临时目录模拟文件系统环境，每个测试用例前后自动创建/清理临时目录，
 * 确保测试之间完全隔离且不污染真实文件系统。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {WorkspaceService} from './workspace-service.js';

describe('WorkspaceService', () => {
    let tempDir: string;
    let configDir: string;
    let service: WorkspaceService;

    // 每个测试用例执行前：创建临时工作空间目录和配置目录，并初始化服务实例
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-config-'));
        // 使用独立的配置目录，避免历史记录测试受外部影响
        service = new WorkspaceService(configDir);
    });

    // 每个测试用例执行后：递归删除所有临时目录，释放系统资源
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
        fs.rmSync(configDir, {recursive: true, force: true});
    });

    describe('browse', () => {
        /**
         * 验证目录浏览功能：
         * - 应返回目录下的所有条目（文件和子目录）
         * - 文件条目的 isDirectory 应为 false，size 应反映文件大小
         * - 目录条目的 isDirectory 应为 true
         */
        it('returns directory entries', () => {
            // 创建一个文件和一个子目录
            fs.writeFileSync(path.join(tempDir, 'file.txt'), 'hello');
            fs.mkdirSync(path.join(tempDir, 'subdir'));

            const entries = service.browse(tempDir);
            expect(entries.length).toBe(2);

            // 验证文件条目的属性
            const file = entries.find(e => e.name === 'file.txt');
            expect(file).toBeDefined();
            expect(file!.isDirectory).toBe(false);
            expect(file!.size).toBe(5); // "hello" 的字节长度

            // 验证目录条目的属性
            const dir = entries.find(e => e.name === 'subdir');
            expect(dir).toBeDefined();
            expect(dir!.isDirectory).toBe(true);
        });

        /** 当浏览的路径不存在时，应抛出 "does not exist" 异常 */
        it('throws for non-existent path', () => {
            expect(() => service.browse('/nonexistent/path/xyz')).toThrow('does not exist');
        });

        /**
         * 当传入的路径是文件而非目录时，应抛出 "not a directory" 异常
         * 浏览操作仅支持目录路径
         */
        it('throws for file path (not directory)', () => {
            const filePath = path.join(tempDir, 'file.txt');
            fs.writeFileSync(filePath, 'content');
            expect(() => service.browse(filePath)).toThrow('not a directory');
        });
    });

    describe('validate', () => {
        /**
         * 验证正常目录路径的校验结果：
         * 可访问的目录应返回 valid: true，error 为 undefined
         */
        it('returns valid for accessible directory', () => {
            const result = service.validate(tempDir);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
        });

        /** 当路径不存在时，校验应返回 valid: false，错误信息包含 "does not exist" */
        it('returns invalid for non-existent path', () => {
            const result = service.validate('/nonexistent/path/xyz');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('does not exist');
        });

        /**
         * 当路径指向文件而非目录时，校验应返回 valid: false，
         * 错误信息包含 "not a directory"
         */
        it('returns invalid for file path', () => {
            const filePath = path.join(tempDir, 'file.txt');
            fs.writeFileSync(filePath, 'content');
            const result = service.validate(filePath);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('not a directory');
        });
    });

    describe('workspace history', () => {
        /** 当没有历史记录时，getHistory 应返回空数组 */
        it('returns empty array when no history exists', () => {
            expect(service.getHistory()).toEqual([]);
        });

        /**
         * 验证添加工作空间到历史记录：
         * 添加后应能在历史记录中找到对应的绝对路径
         */
        it('adds workspace to history', () => {
            service.addToHistory(tempDir);
            const history = service.getHistory();
            expect(history).toContain(path.resolve(tempDir));
        });

        /**
         * 验证历史记录去重逻辑：
         * 重复添加已存在的工作空间时，应将其移动到列表最前面，
         * 而非创建重复条目。最终列表长度应为 2。
         */
        it('deduplicates entries (moves to front)', () => {
            const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws1-'));
            const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-'));

            service.addToHistory(dir1);
            service.addToHistory(dir2);
            service.addToHistory(dir1); // 重复添加 dir1，应被移到最前面

            const history = service.getHistory();
            // dir1 应被提升到首位
            expect(history[0]).toBe(path.resolve(dir1));
            expect(history[1]).toBe(path.resolve(dir2));
            // 不应有重复条目
            expect(history.length).toBe(2);

            // 清理测试创建的临时目录
            fs.rmSync(dir1, {recursive: true, force: true});
            fs.rmSync(dir2, {recursive: true, force: true});
        });

        /**
         * 验证历史记录数量上限：
         * 最多保留 10 条记录，超出部分应自动淘汰最早的记录。
         * 创建 15 个目录后，列表长度应为 10，且最新的记录排在最前面。
         */
        it('limits history to 10 entries', () => {
            const dirs: string[] = [];
            for (let i = 0; i < 15; i++) {
                const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ws${i}-`));
                dirs.push(dir);
                service.addToHistory(dir);
            }

            const history = service.getHistory();
            expect(history.length).toBe(10);
            // 最新添加的目录（第15个）应排在第一位
            expect(history[0]).toBe(path.resolve(dirs[14]));

            // 清理所有测试创建的临时目录
            for (const dir of dirs) {
                fs.rmSync(dir, {recursive: true, force: true});
            }
        });

        /**
         * 验证历史记录排序规则：
         * 最近添加的工作空间应排在列表最前面（后进先出顺序）
         */
        it('most recent entry is first', () => {
            const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws1-'));
            const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-'));

            service.addToHistory(dir1);
            service.addToHistory(dir2);

            const history = service.getHistory();
            // 后添加的 dir2 应排在最前面
            expect(history[0]).toBe(path.resolve(dir2));

            // 清理测试创建的临时目录
            fs.rmSync(dir1, {recursive: true, force: true});
            fs.rmSync(dir2, {recursive: true, force: true});
        });
    });

});
