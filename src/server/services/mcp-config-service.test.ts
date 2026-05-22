/**
 * @file MCPConfigService 单元测试
 * @description 测试 MCP（Model Context Protocol）配置服务的完整 CRUD 功能和辅助功能，包括：
 *              1. 服务器列表查询（list） - 获取所有已配置的 MCP 服务器，含容错处理
 *              2. 单个服务器查询（get） - 按名称获取特定服务器的配置
 *              3. 服务器添加（add） - 新增 MCP 服务器配置，含参数验证和持久化
 *              4. 服务器更新（update） - 修改现有服务器配置，支持部分更新
 *              5. 服务器删除（delete） - 移除指定服务器配置
 *              6. 连接测试（testConnection） - 验证 MCP 服务器是否可正常启动
 *              7. 类型推断（type inference） - 根据命令自动推断服务器类型（node/python/docker/custom）
 *              该服务管理 settings.json 文件中的 mcpServers 配置节，
 *              负责配置的读写、验证和类型推断。测试通过临时配置文件确保隔离性。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {MCPConfigService} from './mcp-config-service.js';

describe('MCPConfigService', () => {
    /** @description 测试用临时目录路径 */
    let tempDir: string;
    /** @description 临时 MCP 配置文件路径（settings.json） */
    let settingsFile: string;
    /** @description 被测试的 MCP 配置服务实例 */
    let service: MCPConfigService;

    /**
     * 测试前置钩子：在每个测试用例执行前
     * - 创建唯一的临时目录
     * - 构造临时 settings.json 文件路径
     * - 实例化 MCPConfigService
     */
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
        settingsFile = path.join(tempDir, 'settings.json');
        service = new MCPConfigService(settingsFile);
    });

    /**
     * 测试后置钩子：在每个测试用例执行后
     * - 递归删除临时目录，确保测试环境干净
     */
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('list', () => {
        /**
         * 测试：配置文件不存在时应返回空数组
         * @description 首次使用时 settings.json 可能尚未创建，
         *              list 方法应优雅地返回空数组而非抛出异常。
         */
        it('returns empty array when settings file does not exist', () => {
            expect(service.list()).toEqual([]);
        });

        /**
         * 测试：配置文件存在但无 mcpServers 字段时应返回空数组
         * @description settings.json 中可能只包含其他配置项而没有 mcpServers，
         *              此时应返回空数组。
         */
        it('returns empty array when settings has no mcpServers', () => {
            // 写入一个不包含 mcpServers 字段的配置文件
            fs.writeFileSync(settingsFile, JSON.stringify({otherField: true}), 'utf-8');
            expect(service.list()).toEqual([]);
        });

        /**
         * 测试：配置文件包含无效 JSON 时应返回空数组
         * @description 当 settings.json 被意外损坏（如手动编辑错误）时，
         *              list 方法应返回空数组而非抛出异常，确保应用健壮性。
         */
        it('returns empty array when file contains invalid JSON', () => {
            // 写入格式错误的 JSON
            fs.writeFileSync(settingsFile, 'not json{', 'utf-8');
            expect(service.list()).toEqual([]);
        });

        /**
         * 测试：应正确列出所有已配置的 MCP 服务器
         * @description 验证 list 方法能够正确解析配置文件，返回完整的服务器列表，
         *              包括命令、参数、环境变量和自动推断的服务器类型。
         *              测试包含两个不同类型的服务器：Node.js（npx）和 Python。
         */
        it('lists configured MCP servers', () => {
            // 配置两个不同类型的 MCP 服务器
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'ones-mcp': {command: 'npx', args: ['@ones/mcp-server'], env: {TOKEN: 'abc'}},
                    'db-server': {command: 'python', args: ['db_mcp.py']},
                },
            }), 'utf-8');

            const servers = service.list();
            // 验证返回了两个服务器
            expect(servers).toHaveLength(2);

            // 验证 ones-mcp 服务器的完整配置，包括环境变量和推断的 node 类型
            const ones = servers.find(s => s.name === 'ones-mcp')!;
            expect(ones.command).toBe('npx');
            expect(ones.args).toEqual(['@ones/mcp-server']);
            expect(ones.env).toEqual({TOKEN: 'abc'});
            expect(ones.type).toBe('node');

            // 验证 db-server 的配置和推断的 python 类型
            const db = servers.find(s => s.name === 'db-server')!;
            expect(db.command).toBe('python');
            expect(db.type).toBe('python');
        });
    });

    describe('get', () => {
        /**
         * 测试：查询不存在的服务器应返回 undefined
         * @description 验证 get 方法在服务器不存在时返回 undefined 而非抛出异常。
         */
        it('returns undefined for non-existent server', () => {
            expect(service.get('nonexistent')).toBeUndefined();
        });

        /**
         * 测试：应按名称返回服务器的完整配置
         * @description 验证 get 方法能够根据服务器名称正确返回对应的配置信息。
         */
        it('returns server config by name', () => {
            // 写入一个测试服务器配置
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'test-server': {command: 'node', args: ['server.js']},
                },
            }), 'utf-8');

            const config = service.get('test-server');
            // 验证返回的配置对象包含完整的名称、命令和参数
            expect(config).toBeDefined();
            expect(config!.name).toBe('test-server');
            expect(config!.command).toBe('node');
            expect(config!.args).toEqual(['server.js']);
        });
    });

    describe('add', () => {
        /**
         * 测试：应成功添加新的 MCP 服务器配置
         * @description 验证 add 方法能够将新的服务器配置持久化到 settings.json 文件中，
         *              并返回包含名称和初始状态（disconnected）的服务器信息。
         */
        it('adds a new MCP server to settings', () => {
            const result = service.add({
                name: 'new-server',
                type: 'node',
                command: 'npx',
                args: ['@test/mcp'],
                env: {API_KEY: 'key123'},
                enabled: true,
            });

            // 验证返回结果包含正确的名称和初始状态
            expect(result.name).toBe('new-server');
            expect(result.status).toBe('disconnected');

            // 验证配置已正确持久化到磁盘文件
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            expect(raw.mcpServers['new-server']).toBeDefined();
            expect(raw.mcpServers['new-server'].command).toBe('npx');
            expect(raw.mcpServers['new-server'].args).toEqual(['@test/mcp']);
            expect(raw.mcpServers['new-server'].env).toEqual({API_KEY: 'key123'});
        });

        /**
         * 测试：名称为空时应抛出验证错误
         * @description 验证 add 方法对必填字段 name 进行校验。
         */
        it('throws when name is empty', () => {
            expect(() => service.add({
                name: '',
                type: 'node',
                command: 'npx',
                args: [],
                env: {},
                enabled: true,
            })).toThrow('name is required');
        });

        /**
         * 测试：命令为空时应抛出验证错误
         * @description 验证 add 方法对必填字段 command 进行校验。
         */
        it('throws when command is empty', () => {
            expect(() => service.add({
                name: 'test',
                type: 'node',
                command: '',
                args: [],
                env: {},
                enabled: true,
            })).toThrow('command is required');
        });

        /**
         * 测试：添加已存在的服务器名称时应抛出错误
         * @description 验证 add 方法能够检测到重复的服务器名称并阻止添加，
         *              防止意外覆盖已有配置。
         */
        it('throws when server already exists', () => {
            // 先在配置文件中写入一个已存在的服务器
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'existing': {command: 'node', args: []}},
            }), 'utf-8');

            // 尝试添加同名服务器应抛出 "already exists" 错误
            expect(() => service.add({
                name: 'existing',
                type: 'node',
                command: 'node',
                args: [],
                env: {},
                enabled: true,
            })).toThrow('already exists');
        });

        /**
         * 测试：添加服务器时应保留配置文件中的其他字段
         * @description 验证 add 方法在写入 mcpServers 时不会覆盖 settings.json 中的
         *              其他配置字段，确保配置文件的完整性。
         */
        it('preserves other settings fields', () => {
            // 写入包含其他配置字段的 settings.json
            fs.writeFileSync(settingsFile, JSON.stringify({
                otherSetting: 'preserved',
                mcpServers: {},
            }), 'utf-8');

            service.add({
                name: 'new',
                type: 'node',
                command: 'node',
                args: ['app.js'],
                env: {},
                enabled: true,
            });

            // 验证 otherSetting 字段未被修改
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            expect(raw.otherSetting).toBe('preserved');
        });

        /**
         * 测试：空的 args 和 env 应从存储中省略
         * @description 验证 add 方法在持久化时会优化存储格式，
         *              省略空数组和空对象以保持配置文件简洁。
         */
        it('omits empty args and env from storage', () => {
            service.add({
                name: 'minimal',
                type: 'node',
                command: 'node',
                args: [],
                env: {},
                enabled: true,
            });

            // 验证空的 args 和 env 字段未被写入文件
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            expect(raw.mcpServers['minimal'].args).toBeUndefined();
            expect(raw.mcpServers['minimal'].env).toBeUndefined();
        });
    });

    describe('update', () => {
        /**
         * 测试：应成功更新现有服务器的配置
         * @description 验证 update 方法能够修改指定服务器的配置并持久化到磁盘。
         */
        it('updates an existing server config', () => {
            // 写入一个初始配置
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'my-server': {command: 'old-cmd', args: ['old']}},
            }), 'utf-8');

            // 更新命令和参数
            const result = service.update('my-server', {command: 'new-cmd', args: ['new']});
            expect(result.command).toBe('new-cmd');
            expect(result.args).toEqual(['new']);

            // 验证磁盘上的配置已更新
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            expect(raw.mcpServers['my-server'].command).toBe('new-cmd');
        });

        /**
         * 测试：更新不存在的服务器时应抛出错误
         * @description 验证 update 方法在目标服务器不存在时抛出 "not found" 错误。
         */
        it('throws when server does not exist', () => {
            expect(() => service.update('nonexistent', {command: 'test'})).toThrow('not found');
        });

        /**
         * 测试：更新时应保留未修改的字段
         * @description 验证 update 方法支持部分更新，只修改传入的字段，
         *              其他字段（如 env）保持不变。
         */
        it('preserves unchanged fields', () => {
            // 写入包含多个字段的配置
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'server': {command: 'node', args: ['app.js'], env: {KEY: 'val'}}},
            }), 'utf-8');

            // 仅更新 command 字段
            const result = service.update('server', {command: 'python'});
            expect(result.command).toBe('python');
            // 验证 args 和 env 字段未被修改
            expect(result.args).toEqual(['app.js']);
            expect(result.env).toEqual({KEY: 'val'});
        });
    });

    describe('delete', () => {
        /**
         * 测试：删除不存在的服务器应返回 false
         * @description 验证 delete 方法在目标不存在时返回 false 而非抛出异常。
         */
        it('returns false for non-existent server', () => {
            expect(service.delete('nonexistent')).toBe(false);
        });

        /**
         * 测试：应成功从配置中移除指定服务器
         * @description 验证 delete 方法能够正确移除目标服务器，
         *              同时不影响其他服务器的配置。
         */
        it('removes server from settings', () => {
            // 配置两个服务器，一个将被删除，一个将保留
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'keep': {command: 'node', args: []},
                    'remove': {command: 'python', args: []},
                },
            }), 'utf-8');

            const result = service.delete('remove');
            expect(result).toBe(true);

            // 验证目标服务器已被移除，其他服务器不受影响
            const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
            expect(raw.mcpServers['remove']).toBeUndefined();
            expect(raw.mcpServers['keep']).toBeDefined();
        });
    });

    describe('testConnection', () => {
        /**
         * 测试：测试不存在的服务器连接应返回错误状态
         * @description 验证 testConnection 方法在服务器配置不存在时
         *              返回 status 为 'error' 且消息包含 'not found'。
         */
        it('returns error for non-existent server', async () => {
            const result = await service.testConnection('nonexistent');
            expect(result.status).toBe('error');
            expect(result.message).toContain('not found');
        });

        /**
         * 测试：命令无法启动时应返回错误状态
         * @description 验证当 MCP 服务器命令不存在（无法启动子进程）时，
         *              testConnection 返回错误状态。
         *              使用不存在的命令名和较短的超时时间（2秒）来快速完成测试。
         */
        it('returns error when command cannot be spawned', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'bad-server': {command: 'nonexistent-command-xyz-123'}},
            }), 'utf-8');

            // 使用 2 秒超时以加快测试执行速度
            const result = await service.testConnection('bad-server', 2000);
            expect(result.status).toBe('error');
        });

        /**
         * 测试：命令成功执行时应返回已连接状态
         * @description 验证当 MCP 服务器命令能够正常启动和退出时，
         *              testConnection 返回 'connected' 状态。
         *              使用 'echo' 命令（可立即成功执行）作为测试目标。
         */
        it('returns connected for a command that runs successfully', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'echo-server': {command: 'echo', args: ['hello']}},
            }), 'utf-8');

            const result = await service.testConnection('echo-server', 2000);
            expect(result.status).toBe('connected');
        });
    });

    describe('type inference', () => {
        /**
         * 测试：应根据 npx 命令推断为 node 类型
         * @description 验证类型推断逻辑能够识别 npx 命令并将其分类为 node 类型。
         */
        it('infers node type from npx command', () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'test': {command: 'npx', args: ['@test/server']}},
            }), 'utf-8');

            const config = service.get('test');
            expect(config!.type).toBe('node');
        });

        /**
         * 测试：应根据 python 命令推断为 python 类型
         * @description 验证类型推断逻辑能够识别 python 命令。
         */
        it('infers python type from python command', () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'test': {command: 'python', args: ['server.py']}},
            }), 'utf-8');

            const config = service.get('test');
            expect(config!.type).toBe('python');
        });

        /**
         * 测试：应根据 docker 命令推断为 docker 类型
         * @description 验证类型推断逻辑能够识别 docker 命令。
         */
        it('infers docker type from docker command', () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'test': {command: 'docker', args: ['run', 'mcp-image']}},
            }), 'utf-8');

            const config = service.get('test');
            expect(config!.type).toBe('docker');
        });

        /**
         * 测试：无法识别的命令应归类为 custom 类型
         * @description 验证对于不在预定义列表中的命令（如自定义路径），
         *              类型推断逻辑返回 'custom' 作为默认类型。
         */
        it('returns custom for unknown commands', () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {'test': {command: '/usr/local/bin/my-server'}},
            }), 'utf-8');

            const config = service.get('test');
            expect(config!.type).toBe('custom');
        });
    });
});
