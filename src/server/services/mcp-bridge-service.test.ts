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

    describe('tool error surfacing & connection recovery', () => {
        /**
         * 最小 stdio MCP fixture server（JSON-RPC over stdio，无 SDK 依赖）
         * @description 通过 FIXTURE_MODE 环境变量控制行为：
         *   - ok            正常返回需求详情 Markdown
         *   - toolerror     get_issue 返回 {isError:true}（模拟 ones-api "Task not found"）
         *   - searcherror   search_issues 返回 {isError:true}（验证纯编号搜索失败不中断）
         *   - die-after-first 首次调用响应后进程退出（模拟连接池中子进程死亡）
         */
        const FIXTURE_SERVER_SCRIPT = [
            'const readline = require("readline");',
            'const rl = readline.createInterface({input: process.stdin});',
            'const MODE = process.env.FIXTURE_MODE || "ok";',
            'let calls = 0;',
            'function send(obj) { process.stdout.write(JSON.stringify(obj) + "\\n"); }',
            'rl.on("line", (line) => {',
            '  line = line.trim();',
            '  if (!line) return;',
            '  let msg; try { msg = JSON.parse(line); } catch { return; }',
            '  if (msg.method === "initialize") {',
            '    send({jsonrpc:"2.0", id: msg.id, result: {protocolVersion: msg.params && msg.params.protocolVersion || "2024-11-05", capabilities: {tools:{}}, serverInfo: {name:"fixture", version:"0.0.1"}}});',
            '  } else if (msg.method === "tools/list") {',
            '    send({jsonrpc:"2.0", id: msg.id, result: {tools: [',
            '      {name:"get_issue", description:"get issue by id", inputSchema:{type:"object", properties:{id:{type:"string"}}, required:["id"]}},',
            '      {name:"search_issues", description:"search issues", inputSchema:{type:"object", properties:{query:{type:"string"}}, required:["query"]}}',
            '    ]}});',
            '  } else if (msg.method === "tools/call") {',
            '    calls++;',
            '    const tool = msg.params.name;',
            '    if (MODE === "toolerror" && tool === "get_issue") {',
            '      send({jsonrpc:"2.0", id: msg.id, result: {content:[{type:"text", text:"Error: ONES: Task #424242 not found in current team"}], isError:true}});',
            '      return;',
            '    }',
            '    if (MODE === "searcherror" && tool === "search_issues") {',
            '      send({jsonrpc:"2.0", id: msg.id, result: {content:[{type:"text", text:"Error: search backend unavailable"}], isError:true}});',
            '      return;',
            '    }',
            '    if (MODE === "die-after-first" && calls === 1) {',
            '      send({jsonrpc:"2.0", id: msg.id, result: {content:[{type:"text", text:"# First\\n\\nok"}]}});',
            '      setTimeout(() => process.exit(0), 50);',
            '      return;',
            '    }',
            '    send({jsonrpc:"2.0", id: msg.id, result: {content:[{type:"text", text:"# Issue 42 title\\n\\n## Description\\n\\nhello world"}]}});',
            '  }',
            '});',
        ].join('\n');

        /** 写入 fixture server 脚本并注册为 FIXTURE_SERVER 配置 */
        function configureFixture(mode: string): void {
            const script = path.join(tempDir, `fixture-server-${mode}.cjs`);
            fs.writeFileSync(script, FIXTURE_SERVER_SCRIPT, 'utf-8');
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    [FIXTURE_SERVER]: {
                        command: process.execPath,
                        args: [script],
                        env: {FIXTURE_MODE: mode},
                    },
                },
            }), 'utf-8');
        }

        it('parses a successful detail response', async () => {
            configureFixture('ok');
            const detail = await service.fetchRequirementDetail('task-abc');
            expect(detail.title).toBe('Issue 42 title');
            expect(detail.description).toBe('hello world');
        });

        /**
         * 测试：工具级错误（isError）必须抛出异常，而非把错误文本解析成空需求壳
         * @description ones-api 对不可见条目返回 {content:[{text:"Error: Task not found"}], isError:true}，
         *              旧实现忽略 isError → 解析出全空字段 → 静默保存空需求。
         */
        it('surfaces tool-level isError instead of producing an empty shell', async () => {
            configureFixture('toolerror');
            await expect(service.fetchRequirementDetail('task-abc'))
                .rejects.toThrow(/get_issue.*reported an error.*not found/s);
        });

        /**
         * 测试：纯编号拉取时搜索工具报错应回退用编号直拉详情（不中断）
         */
        it('falls back to direct detail call when search tool errors (plain number)', async () => {
            configureFixture('searcherror');
            const {detail} = await service.fetchRequirementByInput('123');
            expect(detail.title).toBe('Issue 42 title');
        });

        /**
         * 测试：连接池中的子进程死亡后应驱逐死连接并自动重连恢复
         * @description die-after-first 模式下首个进程响应一次后退出；第二次拉取
         *              应重新拉起进程并成功返回（旧行为：永远 "Not connected"）。
         */
        it('recovers after the pooled server process dies', async () => {
            configureFixture('die-after-first');
            const first = await service.fetchRequirementDetail('task-abc');
            expect(first.title).toBe('First');
            // 等待 onclose 触发（即使未触发，重试包装也会在 "Not connected" 时自愈）
            await new Promise(resolve => setTimeout(resolve, 200));
            const second = await service.fetchRequirementDetail('task-abc');
            expect(second.title).toBe('First');
        });
    });
});
