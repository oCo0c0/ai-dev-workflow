/**
 * @file ConfigService 单元测试
 * @description 测试应用配置服务的完整功能，包括：
 *              1. 配置文件的加载（load） - 支持默认配置创建、有效配置读取、错误处理
 *              2. 配置文件的保存（save） - 支持验证、原子性写入、目录自动创建
 *              3. 配置验证（validateConfig） - 独立验证函数，测试各种边界条件
 *              该服务管理应用的持久化配置，包括服务器设置、UI 偏好、CLI 路径等。
 *              测试通过临时目录隔离文件系统操作，确保测试之间的独立性。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {ConfigService, validateConfig, AppConfig} from './config-service.js';

describe('ConfigService', () => {
    /** @description 测试用临时目录路径，用于模拟配置文件存储位置 */
    let tempDir: string;
    /** @description 被测试的配置服务实例 */
    let service: ConfigService;

    /**
     * 测试前置钩子：在每个测试用例执行前
     * - 创建唯一的临时目录，模拟应用的配置目录
     * - 实例化 ConfigService，将配置目录指向临时目录
     */
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
        service = new ConfigService(tempDir);
    });

    /**
     * 测试后置钩子：在每个测试用例执行后
     * - 递归删除临时目录，清理测试产生的所有文件
     */
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('load', () => {
        /**
         * 测试：配置文件不存在时应创建默认配置
         * @description 当配置文件尚未存在时，load 方法应返回默认配置，
         *              并在磁盘上创建对应的配置文件。
         */
        it('creates default config when file does not exist', () => {
            const config = service.load();
            // 验证返回的配置与默认配置一致
            expect(config).toEqual(service.getDefaultConfig());
            // 验证配置文件已成功创建到磁盘
            expect(fs.existsSync(service.getConfigFile())).toBe(true);
        });

        /**
         * 测试：v1 的 cliProvider.claude/codex/pi 分字段配置应迁移为 v2 的 models map
         * @description 旧格式加载后：旧字段并入 models 并被删除，pi 的 provider
         *              重命名为 modelProvider，迁移结果写回磁盘，二次 load 幂等。
         */
        it('migrates v1 cliProvider fields into v2 models map and persists', () => {
            fs.writeFileSync(service.getConfigFile(), JSON.stringify({
                cliProvider: {
                    active: 'pi',
                    setupCompleted: true,
                    claude: {model: 'opus', extendedThinking: false, reasoningEffort: 'medium', streaming: false},
                    codex: {model: 'gpt-5-codex', streaming: true},
                    pi: {provider: 'deepseek', model: 'deepseek-chat', streaming: true, reasoningEffort: 'low'},
                },
            }), 'utf-8');

            const config = service.load();

            // 旧字段从内存中消失
            expect(config.cliProvider?.claude).toBeUndefined();
            expect(config.cliProvider?.codex).toBeUndefined();
            expect(config.cliProvider?.pi).toBeUndefined();
            // 内容并入 models，pi 的 provider → modelProvider
            expect(config.cliProvider?.models).toEqual({
                claude: {model: 'opus', extendedThinking: false, reasoningEffort: 'medium', streaming: false},
                codex: {model: 'gpt-5-codex', streaming: true},
                pi: {model: 'deepseek-chat', streaming: true, reasoningEffort: 'low', modelProvider: 'deepseek'},
            });
            // 迁移结果写回磁盘
            const onDisk = JSON.parse(fs.readFileSync(service.getConfigFile(), 'utf-8'));
            expect(onDisk.cliProvider.models).toEqual(config.cliProvider?.models);
            expect(onDisk.cliProvider.claude).toBeUndefined();
            // 二次 load 幂等（不再变化）
            expect(service.load().cliProvider).toEqual(config.cliProvider);
        });

        /**
         * 测试：models 中已有的 key 优先于旧字段（用户已在新格式下修改过）
         */
        it('prefers v2 models entries over legacy fields during migration', () => {
            fs.writeFileSync(service.getConfigFile(), JSON.stringify({
                cliProvider: {
                    active: 'claude',
                    models: {claude: {model: 'sonnet-v2-from-models'}},
                    claude: {model: 'opus-from-legacy'},
                },
            }), 'utf-8');

            const config = service.load();

            expect(config.cliProvider?.models?.claude).toEqual({model: 'sonnet-v2-from-models'});
            expect(config.cliProvider?.claude).toBeUndefined();
        });

        /**
         * 测试：非法的 models 条目应被验证器拒绝
         */
        it('rejects invalid models entries via validation', () => {
            const errors = validateConfig({
                cliProvider: {models: {claude: {model: 123, streaming: 'yes'}}},
            });
            expect(errors.some(e => e.field === 'cliProvider.models.claude.model')).toBe(true);
            expect(errors.some(e => e.field === 'cliProvider.models.claude.streaming')).toBe(true);
        });

        /**
         * 测试：应正确读取已存在的有效配置
         * @description 验证 load 方法能够正确解析和返回预先写入的配置文件内容。
         */
        it('reads existing valid config', () => {
            // 准备一个自定义配置对象，包含完整的服务器和 UI 设置
            const customConfig: AppConfig = {
                server: {port: 4000, host: '0.0.0.0'},
                ui: {theme: 'light', sidebarCollapsed: true},
            };
            // 将自定义配置写入配置文件
            fs.writeFileSync(
                path.join(tempDir, 'config.json'),
                JSON.stringify(customConfig),
                'utf-8'
            );

            // 加载并验证配置内容与写入的一致
            const loaded = service.load();
            expect(loaded).toEqual(customConfig);
        });

        /**
         * 测试：配置文件包含无效 JSON 时应抛出错误
         * @description 验证 load 方法在遇到格式错误的 JSON 文件时能够正确抛出异常，
         *              防止因配置文件损坏导致应用崩溃。
         */
        it('throws on invalid JSON', () => {
            // 写入无效的 JSON 格式内容
            fs.writeFileSync(path.join(tempDir, 'config.json'), 'not json{{{', 'utf-8');
            // 验证抛出包含 "invalid JSON" 的错误信息
            expect(() => service.load()).toThrow('invalid JSON');
        });

        /**
         * 测试：配置结构不符合 schema 时应抛出验证错误
         * @description 验证 load 方法在配置 JSON 有效但结构不符合预期时抛出异常。
         *              例如：port 字段应为数字而非字符串。
         */
        it('throws on invalid config structure', () => {
            // 写入 JSON 格式有效但数据类型错误的配置（port 应为 number 而非 string）
            fs.writeFileSync(
                path.join(tempDir, 'config.json'),
                JSON.stringify({server: {port: 'not-a-number'}}),
                'utf-8'
            );
            expect(() => service.load()).toThrow('Config validation failed');
        });
    });

    describe('save', () => {
        /**
         * 测试：应将有效配置保存到磁盘
         * @description 验证 save 方法能够正确将配置对象序列化为 JSON 并写入磁盘文件。
         */
        it('saves valid config to disk', () => {
            // 准备一个部分字段的自定义配置
            const config: AppConfig = {
                server: {port: 8080},
                ui: {theme: 'dark'},
            };
            service.save(config);

            // 读取磁盘文件并验证内容与保存的配置一致
            const raw = fs.readFileSync(service.getConfigFile(), 'utf-8');
            expect(JSON.parse(raw)).toEqual(config);
        });

        /**
         * 测试：保存无效配置时应拒绝写入且不修改原文件
         * @description 验证 save 方法的原子性保护机制。
         *              当尝试保存无效配置时，不应修改磁盘上已有的有效配置文件。
         *              这是一个重要的安全特性，防止因验证失败导致配置丢失。
         */
        it('rejects invalid config without writing', () => {
            // 先保存一个有效的配置作为基准
            const validConfig: AppConfig = {server: {port: 3000}};
            service.save(validConfig);

            // 尝试保存无效配置（port 不能为负数）
            const invalidConfig = {server: {port: -1}} as unknown as AppConfig;
            expect(() => service.save(invalidConfig)).toThrow('Config validation failed');

            // 验证原始有效配置文件未被修改
            const raw = fs.readFileSync(service.getConfigFile(), 'utf-8');
            expect(JSON.parse(raw)).toEqual(validConfig);
        });

        /**
         * 测试：配置目录不存在时应自动创建
         * @description 验证 save 方法在目标目录不存在时能够递归创建目录结构。
         *              这对于首次运行或用户手动删除配置目录的场景非常重要。
         */
        it('creates config directory if it does not exist', () => {
            // 构造一个多层嵌套的不存在的目录路径
            const nestedDir = path.join(tempDir, 'nested', 'dir');
            const nestedService = new ConfigService(nestedDir);
            nestedService.save({server: {port: 5000}});
            // 验证嵌套目录和配置文件均已成功创建
            expect(fs.existsSync(path.join(nestedDir, 'config.json'))).toBe(true);
        });
    });

    describe('validateConfig', () => {
        /**
         * 测试：空对象应通过验证
         * @description 验证空配置对象是合法的，因为所有配置字段都有默认值。
         */
        it('accepts empty object', () => {
            expect(validateConfig({})).toEqual([]);
        });

        /**
         * 测试：完整的有效配置应通过验证
         * @description 验证包含所有可选字段的完整配置对象能够通过验证，
         *              确保验证规则不会误判合法配置。
         */
        it('accepts valid full config', () => {
            const config: AppConfig = {
                server: {port: 3000, host: 'localhost'},
                claudeCodeCli: {path: '/usr/bin/claude'},
                ui: {theme: 'dark', sidebarCollapsed: false},
                defaultPipelineId: 'pipeline-1',
            };
            expect(validateConfig(config)).toEqual([]);
        });

        /**
         * 测试：null 值应被拒绝
         * @description 验证 null 输入不是有效的配置对象。
         */
        it('rejects null', () => {
            const errors = validateConfig(null);
            expect(errors.length).toBeGreaterThan(0);
        });

        /**
         * 测试：非对象类型应被拒绝
         * @description 验证字符串等原始类型不是有效的配置对象。
         */
        it('rejects non-object', () => {
            const errors = validateConfig('string');
            expect(errors.length).toBeGreaterThan(0);
        });

        /**
         * 测试：超出范围的端口号应被拒绝
         * @description 验证端口号必须在有效范围内（通常为 0-65535）。
         */
        it('rejects invalid port (out of range)', () => {
            const errors = validateConfig({server: {port: 99999}});
            expect(errors.some(e => e.field === 'server.port')).toBe(true);
        });

        /**
         * 测试：非整数的端口号应被拒绝
         * @description 验证端口号必须是整数，浮点数不被接受。
         */
        it('rejects invalid port (not integer)', () => {
            const errors = validateConfig({server: {port: 3.14}});
            expect(errors.some(e => e.field === 'server.port')).toBe(true);
        });

        /**
         * 测试：无效的主题值应被拒绝
         * @description 验证 theme 字段只能是预定义的值（如 'dark'、'light' 等）。
         */
        it('rejects invalid theme value', () => {
            const errors = validateConfig({ui: {theme: 'blue'}});
            expect(errors.some(e => e.field === 'ui.theme')).toBe(true);
        });

        /**
         * 测试：sidebarCollapsed 必须是布尔值
         * @description 验证侧边栏折叠状态只能是 true 或 false。
         */
        it('rejects non-boolean sidebarCollapsed', () => {
            const errors = validateConfig({ui: {sidebarCollapsed: 'yes'}});
            expect(errors.some(e => e.field === 'ui.sidebarCollapsed')).toBe(true);
        });

        /**
         * 测试：defaultPipelineId 必须是字符串类型
         * @description 验证默认管道 ID 必须是字符串，数字类型不被接受。
         */
        it('rejects non-string defaultPipelineId', () => {
            const errors = validateConfig({defaultPipelineId: 123});
            expect(errors.some(e => e.field === 'defaultPipelineId')).toBe(true);
        });
    });
});
