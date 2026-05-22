/**
 * @file pipeline-service.test.ts
 * @description PipelineService（流水线服务）的单元测试文件
 *
 * 本测试文件覆盖了 PipelineService 的核心功能，包括：
 * - 流水线的增删改查（CRUD）操作
 * - 默认流水线的设置与互斥逻辑
 * - 流水线配置验证（包括 MCP 服务器引用校验）
 * - 异常边界条件处理（无效 JSON、缺失管道等）
 *
 * 测试策略：使用临时目录模拟磁盘存储，每个测试用例前后自动创建/清理临时环境，
 * 确保测试之间相互独立、可重复运行。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {PipelineService, WorkflowPipeline, PipelineStepConfig} from './pipeline-service.js';

/**
 * 辅助函数：创建一个完整的流水线步骤配置对象
 * 用于在多个测试用例中复用默认的步骤配置，避免重复代码
 * @param overrides - 可选的部分配置覆盖，用于定制特定步骤的字段
 * @returns 完整的 PipelineStepConfig 对象
 */
function createSteps(overrides?: Partial<PipelineStepConfig>): PipelineStepConfig {
    return {
        requirementSource: {type: 'manual'},
        workspace: {},
        skillSet: {mode: 'all', selectedSkills: []},
        mcpToolSet: {mode: 'all', selectedServers: []},
        testStrategy: {mode: 'run_existing', framework: 'vitest', command: 'npm test', autoRunAfterExecution: true},
        ...overrides,
    };
}

describe('PipelineService', () => {
    let tempDir: string;
    let service: PipelineService;

    // 每个测试用例执行前：创建临时目录并初始化服务实例
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
        service = new PipelineService(tempDir);
    });

    // 每个测试用例执行后：递归删除临时目录，释放系统资源
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('list', () => {
        /** 当 pipelines.json 文件不存在时，应返回空数组 */
        it('returns empty array when no pipelines file exists', () => {
            expect(service.list()).toEqual([]);
        });

        /** 当文件内容为无效 JSON 时，应优雅降级并返回空数组，而非抛出异常 */
        it('returns empty array when file contains invalid JSON', () => {
            fs.writeFileSync(path.join(tempDir, 'pipelines.json'), 'not json', 'utf-8');
            expect(service.list()).toEqual([]);
        });

        /** 当文件内容为合法 JSON 但非数组类型（如对象）时，应返回空数组 */
        it('returns empty array when file contains non-array JSON', () => {
            fs.writeFileSync(path.join(tempDir, 'pipelines.json'), '{}', 'utf-8');
            expect(service.list()).toEqual([]);
        });

        /** 验证 list 方法能正确读取并返回已持久化的流水线数据 */
        it('returns pipelines from file', () => {
            // 先创建一条流水线，再通过 list 方法查询验证
            const pipeline = service.create({
                name: 'Test',
                description: 'desc',
                isDefault: false,
                steps: createSteps()
            });
            const list = service.list();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe(pipeline.id);
        });
    });

    describe('create', () => {
        /** 验证创建流水线时自动生成 id、创建时间和更新时间 */
        it('creates a pipeline with generated id and timestamps', () => {
            const pipeline = service.create({
                name: 'My Pipeline',
                description: 'A test pipeline',
                isDefault: false,
                steps: createSteps(),
            });

            // 断言自动生成的字段存在且传入字段正确
            expect(pipeline.id).toBeDefined();
            expect(pipeline.name).toBe('My Pipeline');
            expect(pipeline.description).toBe('A test pipeline');
            expect(pipeline.isDefault).toBe(false);
            expect(pipeline.createdAt).toBeDefined();
            expect(pipeline.updatedAt).toBeDefined();
        });

        /** 验证创建的流水线数据会正确持久化到磁盘上的 pipelines.json 文件 */
        it('persists pipeline to disk', () => {
            service.create({name: 'Persisted', description: '', isDefault: false, steps: createSteps()});
            // 直接读取磁盘文件，验证 JSON 结构和内容正确性
            const raw = fs.readFileSync(path.join(tempDir, 'pipelines.json'), 'utf-8');
            const parsed = JSON.parse(raw);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].name).toBe('Persisted');
        });

        /**
         * 验证默认流水线的互斥逻辑：
         * 当创建一个新流水线并标记为默认时，之前已存在的默认流水线应自动取消默认标记
         */
        it('unsets other defaults when creating a default pipeline', () => {
            const first = service.create({name: 'First', description: '', isDefault: true, steps: createSteps()});
            const second = service.create({name: 'Second', description: '', isDefault: true, steps: createSteps()});

            const list = service.list();
            const firstUpdated = list.find(p => p.id === first.id)!;
            const secondUpdated = list.find(p => p.id === second.id)!;

            // 第一个流水线的默认标记应被自动取消
            expect(firstUpdated.isDefault).toBe(false);
            // 第二个流水线应成为新的默认流水线
            expect(secondUpdated.isDefault).toBe(true);
        });
    });

    describe('get', () => {
        /** 当查询不存在的 ID 时，应返回 undefined 而非抛出异常 */
        it('returns undefined for non-existent id', () => {
            expect(service.get('non-existent')).toBeUndefined();
        });

        /** 验证通过 ID 能正确获取已创建的流水线对象 */
        it('returns the pipeline by id', () => {
            const created = service.create({name: 'Find Me', description: '', isDefault: false, steps: createSteps()});
            const found = service.get(created.id);
            expect(found).toBeDefined();
            expect(found!.name).toBe('Find Me');
        });
    });

    describe('update', () => {
        /** 当更新不存在的流水线时，应抛出 "Pipeline not found" 异常 */
        it('throws when pipeline not found', () => {
            expect(() => service.update('non-existent', {name: 'New'})).toThrow('Pipeline not found');
        });

        /**
         * 验证更新操作：
         * - 可以修改名称和描述等字段
         * - ID 和创建时间保持不变（不可变字段）
         * - 更新时间应自动刷新
         */
        it('updates pipeline fields', () => {
            const created = service.create({
                name: 'Original',
                description: 'old',
                isDefault: false,
                steps: createSteps()
            });
            const updated = service.update(created.id, {name: 'Updated', description: 'new'});

            expect(updated.name).toBe('Updated');
            expect(updated.description).toBe('new');
            // ID 和创建时间不应被修改
            expect(updated.id).toBe(created.id);
            expect(updated.createdAt).toBe(created.createdAt);
            // 更新时间应发生变化
            expect(updated.updatedAt).not.toBe(created.updatedAt);
        });

        /**
         * 验证通过 update 设置默认流水线时的互斥逻辑：
         * 将第二个流水线设为默认后，第一个流水线的默认标记应被自动取消
         */
        it('unsets other defaults when setting as default', () => {
            const first = service.create({name: 'First', description: '', isDefault: true, steps: createSteps()});
            const second = service.create({name: 'Second', description: '', isDefault: false, steps: createSteps()});

            // 将第二个流水线更新为默认
            service.update(second.id, {isDefault: true});

            const list = service.list();
            // 第一个流水线不再为默认
            expect(list.find(p => p.id === first.id)!.isDefault).toBe(false);
            // 第二个流水线成为新的默认
            expect(list.find(p => p.id === second.id)!.isDefault).toBe(true);
        });
    });

    describe('delete', () => {
        /** 删除不存在的流水线时，应返回 false 而非抛出异常 */
        it('returns false for non-existent pipeline', () => {
            expect(service.delete('non-existent')).toBe(false);
        });

        /** 验证删除操作能正确从存储中移除流水线 */
        it('removes pipeline from storage', () => {
            const created = service.create({
                name: 'Delete Me',
                description: '',
                isDefault: false,
                steps: createSteps()
            });
            const result = service.delete(created.id);

            expect(result).toBe(true);
            // 删除后列表应为空
            expect(service.list()).toHaveLength(0);
        });
    });

    describe('setDefault', () => {
        /** 对不存在的流水线调用 setDefault 时，应抛出 "Pipeline not found" 异常 */
        it('throws when pipeline not found', () => {
            expect(() => service.setDefault('non-existent')).toThrow('Pipeline not found');
        });

        /**
         * 验证 setDefault 的互斥逻辑：
         * 设置指定流水线为默认后，其他所有流水线的默认标记应被自动取消
         */
        it('sets the specified pipeline as default and unsets others', () => {
            const first = service.create({name: 'First', description: '', isDefault: true, steps: createSteps()});
            const second = service.create({name: 'Second', description: '', isDefault: false, steps: createSteps()});

            // 将第二个流水线设为默认
            service.setDefault(second.id);

            const list = service.list();
            expect(list.find(p => p.id === first.id)!.isDefault).toBe(false);
            expect(list.find(p => p.id === second.id)!.isDefault).toBe(true);
        });
    });

    describe('validate', () => {
        /**
         * 验证不引用任何 MCP 服务器的流水线配置是合法的
         * 这是正常使用场景的基本验证
         */
        it('returns valid for a pipeline with no MCP references', () => {
            const pipeline: WorkflowPipeline = {
                id: 'test-id',
                name: 'Valid Pipeline',
                description: '',
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                steps: createSteps(),
            };

            const result = service.validate(pipeline, ['server-a', 'server-b']);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        /** 验证流水线名称为空时，校验应返回无效结果 */
        it('returns error when name is empty', () => {
            const pipeline: WorkflowPipeline = {
                id: 'test-id',
                name: '',
                description: '',
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                steps: createSteps(),
            };

            const result = service.validate(pipeline, []);
            expect(result.valid).toBe(false);
            // 错误信息中应包含 name 字段的校验错误
            expect(result.errors.some(e => e.field === 'name')).toBe(true);
        });

        /**
         * 验证当需求来源（requirementSource）引用了不存在的 MCP 服务器时，
         * 校验应返回无效结果，错误信息中应包含缺失的服务器名称
         */
        it('returns error when requirement source references non-existent MCP server', () => {
            const pipeline: WorkflowPipeline = {
                id: 'test-id',
                name: 'Test',
                description: '',
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                // 引用一个不存在的 MCP 服务器 "missing-server"
                steps: createSteps({
                    requirementSource: {type: 'ones', mcpServerName: 'missing-server'},
                }),
            };

            // 可用服务器列表中只有 "server-a"，不包含 "missing-server"
            const result = service.validate(pipeline, ['server-a']);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.message.includes('missing-server'))).toBe(true);
        });

        /**
         * 验证当 MCP 工具集中引用了不存在的服务器时，
         * 校验应返回无效结果
         */
        it('returns error when MCP tool set references non-existent servers', () => {
            const pipeline: WorkflowPipeline = {
                id: 'test-id',
                name: 'Test',
                description: '',
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                // selectedServers 中 "missing" 不在可用列表中
                steps: createSteps({
                    mcpToolSet: {mode: 'selected', selectedServers: ['exists', 'missing']},
                }),
            };

            // 可用服务器列表中只有 "exists"
            const result = service.validate(pipeline, ['exists']);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.message.includes('missing'))).toBe(true);
        });

        /**
         * 验证当所有引用的 MCP 服务器都存在于可用列表中时，
         * 校验应返回有效结果（正向测试）
         */
        it('passes when all referenced MCP servers exist', () => {
            const pipeline: WorkflowPipeline = {
                id: 'test-id',
                name: 'Test',
                description: '',
                isDefault: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                // 需求来源和工具集都引用了服务器，但都在可用列表中
                steps: createSteps({
                    requirementSource: {type: 'ones', mcpServerName: 'ones-server'},
                    mcpToolSet: {mode: 'selected', selectedServers: ['ones-server', 'other-server']},
                }),
            };

            // 可用服务器列表包含所有被引用的服务器
            const result = service.validate(pipeline, ['ones-server', 'other-server']);
            expect(result.valid).toBe(true);
        });
    });
});
