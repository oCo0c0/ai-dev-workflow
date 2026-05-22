/**
 * @file skills-service.test.ts
 * @description SkillsService（技能服务）的单元测试文件
 *
 * 本测试文件覆盖了 SkillsService 的全部 CRUD 功能，包括：
 * - 技能列表的读取与过滤（仅识别 .md 文件）
 * - 技能描述的智能提取（从首行文本或 Markdown 标题中提取）
 * - 技能文件的创建（含名称清洗、目录自动创建）
 * - 技能内容的更新与校验
 * - 技能文件的删除
 *
 * 测试策略：使用临时目录模拟技能文件存储，每个测试用例前后自动创建/清理临时环境，
 * 确保测试之间完全隔离。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {SkillsService} from './skills-service.js';

describe('SkillsService', () => {
    let tempDir: string;
    let service: SkillsService;

    // 每个测试用例执行前：创建临时目录并初始化技能服务实例
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
        service = new SkillsService(tempDir);
    });

    // 每个测试用例执行后：递归删除临时目录，确保不影响后续测试
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('list', () => {
        /** 当技能目录不存在时，应返回空数组而非抛出异常 */
        it('returns empty array when directory does not exist', () => {
            const nonExistentService = new SkillsService(path.join(tempDir, 'nonexistent'));
            expect(nonExistentService.list()).toEqual([]);
        });

        /** 当技能目录存在但为空时，应返回空数组 */
        it('returns empty array when directory is empty', () => {
            expect(service.list()).toEqual([]);
        });

        /**
         * 验证 list 方法仅识别 .md 文件作为技能文件：
         * - 创建两个 .md 文件和一个 .txt 文件
         * - 应只返回 2 个技能（.txt 文件被忽略）
         * - 返回的技能名称应为去除扩展名后的文件名，并按字母排序
         */
        it('lists .md files as skills', () => {
            fs.writeFileSync(path.join(tempDir, 'code-review.md'), '# Code Review\nReview code for quality', 'utf-8');
            fs.writeFileSync(path.join(tempDir, 'testing.md'), 'Write comprehensive tests', 'utf-8');
            // 非 .md 文件应被忽略
            fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'not a skill', 'utf-8');

            const skills = service.list();
            expect(skills).toHaveLength(2);
            expect(skills.map(s => s.name).sort()).toEqual(['code-review', 'testing']);
        });

        /**
         * 验证技能描述提取逻辑：
         * 当 Markdown 文件首行不是标题（#）时，直接使用首行文本作为描述
         */
        it('extracts description from first content line', () => {
            fs.writeFileSync(path.join(tempDir, 'my-skill.md'), 'This is the description\nMore content here', 'utf-8');

            const skills = service.list();
            expect(skills[0].description).toBe('This is the description');
        });

        /**
         * 验证技能描述提取逻辑：
         * 当 Markdown 文件首行是标题（# xxx）时，提取标题文本作为描述
         */
        it('extracts description from header', () => {
            fs.writeFileSync(path.join(tempDir, 'my-skill.md'), '# My Skill Title\nContent here', 'utf-8');

            const skills = service.list();
            expect(skills[0].description).toBe('My Skill Title');
        });
    });

    describe('get', () => {
        /** 当查询不存在的技能名称时，应返回 undefined */
        it('returns undefined for non-existent skill', () => {
            expect(service.get('nonexistent')).toBeUndefined();
        });

        /**
         * 验证 get 方法返回的技能详情包含完整的文件信息：
         * - 名称（去除 .md 扩展名）
         * - 完整文件内容
         * - 文件绝对路径
         */
        it('returns skill detail with content', () => {
            const content = '# Test Skill\nDo testing things\n\nMore details here.';
            fs.writeFileSync(path.join(tempDir, 'test-skill.md'), content, 'utf-8');

            const detail = service.get('test-skill');
            expect(detail).toBeDefined();
            expect(detail!.name).toBe('test-skill');
            expect(detail!.content).toBe(content);
            expect(detail!.filePath).toBe(path.join(tempDir, 'test-skill.md'));
        });
    });

    describe('create', () => {
        /** 验证创建新技能文件后，磁盘上应生成对应的 .md 文件，且返回正确信息 */
        it('creates a new skill file', () => {
            const result = service.create('new-skill', '# New Skill\nDo new things');

            expect(result.name).toBe('new-skill');
            expect(result.content).toBe('# New Skill\nDo new things');
            // 验证文件已持久化到磁盘
            expect(fs.existsSync(path.join(tempDir, 'new-skill.md'))).toBe(true);
        });

        /** 验证技能名称为空时，应抛出校验异常 */
        it('throws when name is empty', () => {
            expect(() => service.create('', 'content')).toThrow('Skill name is required');
        });

        /** 验证技能内容为空字符串时，应抛出校验异常 */
        it('throws when content is empty', () => {
            expect(() => service.create('test', '')).toThrow('Skill content cannot be empty');
        });

        /** 验证技能内容仅包含空白字符时，应被视为空内容并抛出异常 */
        it('throws when content is whitespace only', () => {
            expect(() => service.create('test', '   ')).toThrow('Skill content cannot be empty');
        });

        /** 验证当同名技能文件已存在时，应抛出 "already exists" 异常 */
        it('throws when skill already exists', () => {
            fs.writeFileSync(path.join(tempDir, 'existing.md'), 'content', 'utf-8');
            expect(() => service.create('existing', 'new content')).toThrow('already exists');
        });

        /**
         * 验证技能名称清洗逻辑：
         * 名称中的特殊字符（如空格、斜杠）应被替换为连字符（-），
         * 确保生成的文件名安全且符合命名规范
         */
        it('sanitizes name to remove special characters', () => {
            const result = service.create('my skill/name', 'content here');
            expect(result.name).toBe('my-skill-name');
        });

        /**
         * 验证当技能目录的父目录不存在时，
         * create 方法应自动递归创建所需的目录结构
         */
        it('creates commands directory if it does not exist', () => {
            const nestedDir = path.join(tempDir, 'nested', 'commands');
            const nestedService = new SkillsService(nestedDir);
            nestedService.create('test', 'content');
            // 验证嵌套目录下的文件已成功创建
            expect(fs.existsSync(path.join(nestedDir, 'test.md'))).toBe(true);
        });
    });

    describe('update', () => {
        /**
         * 验证更新操作：
         * - 返回的技能对象内容应更新为新内容
         * - 磁盘上的文件内容也应同步更新
         */
        it('updates existing skill content', () => {
            fs.writeFileSync(path.join(tempDir, 'update-me.md'), 'old content', 'utf-8');

            const result = service.update('update-me', 'new content');
            expect(result.content).toBe('new content');

            // 直接读取磁盘文件验证内容已更新
            const onDisk = fs.readFileSync(path.join(tempDir, 'update-me.md'), 'utf-8');
            expect(onDisk).toBe('new content');
        });

        /** 验证更新时若内容为空，应抛出校验异常 */
        it('throws when content is empty', () => {
            fs.writeFileSync(path.join(tempDir, 'test.md'), 'content', 'utf-8');
            expect(() => service.update('test', '')).toThrow('Skill content cannot be empty');
        });

        /** 验证更新不存在的技能时，应抛出 "not found" 异常 */
        it('throws when skill does not exist', () => {
            expect(() => service.update('nonexistent', 'content')).toThrow('not found');
        });
    });

    describe('delete', () => {
        /** 删除不存在的技能时，应返回 false 而非抛出异常 */
        it('returns false for non-existent skill', () => {
            expect(service.delete('nonexistent')).toBe(false);
        });

        /**
         * 验证删除操作：
         * - 应返回 true 表示成功
         * - 磁盘上对应的 .md 文件应被移除
         */
        it('deletes the skill file', () => {
            fs.writeFileSync(path.join(tempDir, 'delete-me.md'), 'content', 'utf-8');

            const result = service.delete('delete-me');
            expect(result).toBe(true);
            // 验证文件已从磁盘删除
            expect(fs.existsSync(path.join(tempDir, 'delete-me.md'))).toBe(false);
        });
    });
});
