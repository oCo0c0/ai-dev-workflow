/**
 * @file MCPBridgeService 单元测试
 * @description 测试 MCP（Model Context Protocol）桥接服务的核心功能，包括：
 *              1. 需求详情获取（fetchRequirementDetail） - 通过 MCP 协议从外部需求源获取需求详情
 *              2. 需求搜索（searchRequirements） - 通过 MCP 协议搜索需求
 *              3. 服务器名称管理（getServerName / setServerName） - 配置和切换需求源
 *              4. 响应解析（parseRequirementList） - 处理 MCP 服务器返回的 JSON-RPC 响应
 *              测试通过临时配置文件隔离文件系统操作；显式指定服务器名，
 *              避免与本机全局 MCP 配置（~/.claude）耦合，保证测试封闭性。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {MCPConfigService} from './mcp-config-service.js';
import {MCPBridgeService} from './mcp-bridge-service.js';

describe('MCPBridgeService', () => {
    /** @description 测试用临时目录路径，用于模拟配置文件存储位置 */
    let tempDir: string;
    /** @description 临时 MCP 配置文件路径（settings.json） */
    let settingsFile: string;
    /** @description MCP 配置服务实例，用于管理 MCP 服务器配置 */
    let mcpConfigService: MCPConfigService;
    /** @description 被测试的 MCP 桥接服务实例（显式指定 fixture 服务器名，隔离全局配置） */
    let service: MCPBridgeService;

    /** fixture 服务器名（仅存在于临时配置文件中，不与本机全局配置冲突） */
    const FIXTURE_SERVER = 'test-mcp-fixture';

    /**
     * 测试前置钩子：在每个测试用例执行前
     * - 创建唯一的临时目录，构造临时配置文件路径
     * - 实例化 MCPConfigService 和 MCPBridgeService（显式指定 fixture 服务器名）
     */
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-test-'));
        settingsFile = path.join(tempDir, 'settings.json');
        mcpConfigService = new MCPConfigService(settingsFile);
        service = new MCPBridgeService(mcpConfigService, FIXTURE_SERVER);
    });

    /**
     * 测试后置钩子：在每个测试用例执行后
     * - 递归删除临时目录，清理测试产生的所有文件和子进程
     */
    afterEach(async () => {
        await service.disconnect().catch(() => {});
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('fetchRequirementDetail', () => {
        /**
         * 测试：MCP 服务器未配置时应抛出错误
         * @description 用空桩配置源（get 恒 undefined、list 恒空）隔离本机全局
         *              MCP 配置（~/.claude.json），保证 "not configured" 场景可达。
         */
        it('throws when MCP server is not configured', async () => {
            const isolated = new MCPBridgeService({get: () => undefined, list: () => []});
            await expect(isolated.fetchRequirementDetail('123')).rejects.toThrow('not configured');
        });

        /**
         * 测试：显式指定的服务器未配置时应报错而非静默切换
         */
        it('throws for explicit unconfigured server instead of silent fallback', async () => {
            await expect(
                service.fetchRequirementDetail('123', {serverName: 'no-such-server-xyz'})
            ).rejects.toThrow('not configured');
        });

        /**
         * 测试：MCP 调用失败时应抛出友好的错误消息
         * @description 当 MCP 服务器配置存在但无法正常启动（如命令不存在）时，
         *              应抛出 "Failed to fetch requirement detail" 错误。
         */
        it('throws with helpful message when MCP call fails', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    [FIXTURE_SERVER]: {command: 'nonexistent-mcp-command-xyz'},
                },
            }), 'utf-8');

            await expect(service.fetchRequirementDetail('123')).rejects.toThrow('Failed to fetch requirement detail');
        });
    });

    describe('searchRequirements', () => {
        /**
         * 测试：MCP 服务器未配置时应抛出错误（空桩配置源隔离全局配置）
         */
        it('throws when MCP server is not configured', async () => {
            const isolated = new MCPBridgeService({get: () => undefined, list: () => []});
            await expect(isolated.searchRequirements('test')).rejects.toThrow('not configured');
        });

        /**
         * 测试：MCP 调用失败时应抛出友好的错误消息
         */
        it('throws with helpful message when MCP call fails', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    [FIXTURE_SERVER]: {command: 'nonexistent-mcp-command-xyz'},
                },
            }), 'utf-8');

            await expect(service.searchRequirements('test')).rejects.toThrow('Failed to search requirements');
        });
    });

    describe('getServerName / setServerName', () => {
        /**
         * 测试：未指定服务器名时应使用协议默认名 'ones-api'
         * @description 历史默认值，保持向后兼容（自动路由未命中时也以此名报错提示）。
         */
        it('defaults to ones-api', () => {
            expect(new MCPBridgeService(mcpConfigService).getServerName()).toBe('ones-api');
        });

        /**
         * 测试：应允许动态更改服务器名称
         */
        it('allows changing the server name', () => {
            service.setServerName('custom-mcp');
            expect(service.getServerName()).toBe('custom-mcp');
        });

        /**
         * 测试：构造函数应支持自定义服务器名称
         */
        it('uses custom server name in constructor', () => {
            const customService = new MCPBridgeService(mcpConfigService, 'my-server');
            expect(customService.getServerName()).toBe('my-server');
        });
    });

    describe('parseRequirementList (via integration)', () => {
        /**
         * 测试：MCP 服务器立即退出且无输出时应正确处理
         * @description 集成测试：服务器进程启动后立即退出（退出码 0）且无输出时，
         *              搜索方法应抛出异常而非静默失败。
         *              使用 `node -e ""`（跨平台：退出码 0 且无输出）模拟此场景。
         */
        it('handles MCP server that exits immediately with no output', async () => {
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    [FIXTURE_SERVER]: {command: process.execPath, args: ['-e', '']},
                },
            }), 'utf-8');

            await expect(service.searchRequirements('test')).rejects.toThrow();
        });
    });

    describe('source catalog & install', () => {
        /** 桩配置源：内存 servers，支持 get/list/add（一键安装路径） */
        function makeStubSource(servers: MCPServerConfig[]) {
            return {
                get: (name: string) => servers.find(s => s.name === name),
                list: () => servers,
                add: (config: MCPServerConfig) => {
                    servers.push(config);
                    return config;
                },
            };
        }

        /** github 系 server（供目录归类） */
        const githubServer: MCPServerConfig = {
            name: 'gh', type: 'custom', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-github'],
            env: {}, enabled: true,
        };

        it('lists the adapter catalog (never tool-type MCP servers)', () => {
            const stub = makeStubSource([
                githubServer,
                {...githubServer, name: 'memory', command: 'cmd', args: ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory']},
            ]);
            const bridge = new MCPBridgeService(stub);
            const catalog = bridge.listSources();
            // 目录按适配器组织，只有 ones / github 两个条目
            expect(catalog.map(c => c.adapterId).sort()).toEqual(['github', 'ones']);
            const gh = catalog.find(c => c.adapterId === 'github')!;
            expect(gh.servers).toEqual(['gh']);
            expect(gh.installTemplate?.serverName).toBe('github');
            // memory 等工具型 MCP 不会出现
            expect(JSON.stringify(catalog)).not.toContain('memory');
        });

        it('installs a source from the adapter template (windows cmd wrap, credentials persisted)', async () => {
            const stub = makeStubSource([]);
            const bridge = new MCPBridgeService(stub);
            const result = await bridge.installSource('github', {
                GITHUB_PERSONAL_ACCESS_TOKEN: 'tok',
                GITHUB_REPOSITORY: 'foo/bar',
            });
            expect(result.serverName).toBe('github');
            const created = stub.get('github')!;
            // Windows 下自动 cmd /c 包装
            expect(created.command).toBe('cmd');
            expect(created.args).toEqual(['/c', 'npx', '-y', '@modelcontextprotocol/server-github']);
            expect(created.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('tok');
            expect(created.env.GITHUB_REPOSITORY).toBe('foo/bar');
        });

        it('rejects install when required credentials are missing', async () => {
            const bridge = new MCPBridgeService(makeStubSource([]));
            await expect(bridge.installSource('github', {})).rejects.toThrow(/Missing required credentials/);
        });

        it('rejects install when the template server name already exists', async () => {
            const bridge = new MCPBridgeService(makeStubSource([
                {...githubServer, name: 'github'},
            ]));
            await expect(
                bridge.installSource('github', {GITHUB_PERSONAL_ACCESS_TOKEN: 'tok'})
            ).rejects.toThrow(/already exists/);
        });

        it('rejects unknown adapters', async () => {
            const bridge = new MCPBridgeService(makeStubSource([]));
            await expect(bridge.installSource('nope', {})).rejects.toThrow(/Unknown requirement source/);
        });
    });
});
