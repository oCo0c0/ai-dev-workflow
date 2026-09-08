/**
 * @module platform/mcp-gateway.test
 * @description MCP 聚合网关单元测试（不连接真实上游进程）
 */

import {describe, it, expect, afterEach} from 'vitest';
import express from 'express';
import type {Server} from 'http';
import {McpGateway, PLATFORM_MCP_SERVER_NAME, normalizeWindowsCommand} from './mcp-gateway.js';
import {getPlatformToolRegistry} from './tool-registry.js';
import type {PlatformToolDefinition} from './types.js';
import type {MCPRegistryService} from '../services/mcp-registry-service.js';

/** 空注册中心 stub（不读真实 ~/.ai-dev-workbench/mcp-servers.json） */
function emptyRegistry(): MCPRegistryService {
    return {list: () => []} as unknown as MCPRegistryService;
}

describe('normalizeWindowsCommand', () => {
    it('Windows 下脚本命令经 cmd /c 包装', () => {
        if (process.platform !== 'win32') return; // 仅 Windows 生效
        const result = normalizeWindowsCommand('npx', ['-y', 'server.js']);
        expect(result.command).toBe('cmd');
        expect(result.args).toEqual(['/c', 'npx', '-y', 'server.js']);
    });

    it('已是可执行文件（.exe/.cmd/.bat）不重复包装', () => {
        if (process.platform !== 'win32') return;
        const result = normalizeWindowsCommand('node.exe', ['server.js']);
        expect(result.command).toBe('node.exe');
        expect(result.args).toEqual(['server.js']);
    });
});

describe('McpGateway', () => {
    it('endpoint 未设置时 asClaudeMcpServers 返回 undefined（回退 stdio 的信号）', () => {
        const gateway = new McpGateway(emptyRegistry());
        expect(gateway.asClaudeMcpServers()).toBeUndefined();
    });

    it('设置 endpoint 后返回 HTTP 挂载配置', () => {
        const gateway = new McpGateway(emptyRegistry());
        gateway.setEndpoint('http://127.0.0.1:3777/api/mcp');
        expect(gateway.asClaudeMcpServers()).toEqual({
            [PLATFORM_MCP_SERVER_NAME]: {type: 'http', url: 'http://127.0.0.1:3777/api/mcp'},
        });
    });

    it('servers 白名单以 query 追加，兼容已带 query 的 endpoint', () => {
        const gateway = new McpGateway(emptyRegistry());
        gateway.setEndpoint('http://127.0.0.1:3777/api/mcp?apiKey=secret');

        const servers = gateway.asClaudeMcpServers(['ones', 'github']);
        expect(servers?.[PLATFORM_MCP_SERVER_NAME].url).toBe(
            'http://127.0.0.1:3777/api/mcp?apiKey=secret&servers=ones%2Cgithub'
        );

        gateway.setEndpoint('http://127.0.0.1:3777/api/mcp');
        const plain = gateway.asClaudeMcpServers(['ones']);
        expect(plain?.[PLATFORM_MCP_SERVER_NAME].url).toBe(
            'http://127.0.0.1:3777/api/mcp?servers=ones'
        );
    });

    it('无上游时 listUpstreamTools 返回空数组', async () => {
        const gateway = new McpGateway(emptyRegistry());
        await expect(gateway.listUpstreamTools()).resolves.toEqual([]);
    });

    it('dispose 不抛出（无连接时）', async () => {
        const gateway = new McpGateway(emptyRegistry());
        await expect(gateway.dispose()).resolves.toBeUndefined();
    });

    it('setPlatformEndpoint / getPlatformEndpoint 往返（含 apiKey）', () => {
        const gateway = new McpGateway(emptyRegistry());
        expect(gateway.getPlatformEndpoint()).toBeNull();
        gateway.setPlatformEndpoint('http://127.0.0.1:3000/api/platform', 'secret');
        expect(gateway.getPlatformEndpoint()).toEqual({url: 'http://127.0.0.1:3000/api/platform', apiKey: 'secret'});
    });
});

describe('McpGateway 平台 REST 面（/api/platform）', () => {
    const servers: Server[] = [];

    function listen(app: ReturnType<typeof express>): Promise<string> {
        return new Promise((resolve) => {
            const server = app.listen(0, '127.0.0.1', () => {
                servers.push(server);
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    resolve(`http://127.0.0.1:${addr.port}`);
                }
            });
        });
    }

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
    });

    /** 注册一个测试用原生工具 */
    function registerEchoTool(): PlatformToolDefinition {
        const registry = getPlatformToolRegistry();
        const tool: PlatformToolDefinition = {
            name: 'test__echo',
            label: 'Echo',
            description: '回显输入',
            category: 'mcp',
            inputSchema: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
            async execute(args) {
                return {text: `echo: ${String(args.text ?? '')}`};
            },
        };
        registry.register(tool);
        return tool;
    }

    it('GET /tools 返回工具目录（不含 execute）；POST /call 执行平台工具', async () => {
        const tool = registerEchoTool();
        const gateway = new McpGateway(emptyRegistry());
        const app = express();
        app.use(express.json());
        gateway.attachPlatformApi(app, '/api/platform');
        const base = await listen(app);

        try {
            const listRes = await fetch(`${base}/api/platform/tools`);
            expect(listRes.status).toBe(200);
            const catalog = await listRes.json() as Array<Record<string, unknown>>;
            const echo = catalog.find((t) => t.name === 'test__echo');
            expect(echo).toBeDefined();
            expect(echo!.inputSchema).toEqual(tool.inputSchema);
            // 目录视图不含执行函数
            expect(echo!.execute).toBeUndefined();

            const callRes = await fetch(`${base}/api/platform/call`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({name: 'test__echo', args: {text: '你好'}}),
            });
            expect(callRes.status).toBe(200);
            expect(await callRes.json()).toEqual({text: 'echo: 你好'});
        } finally {
            getPlatformToolRegistry().unregister('test__echo');
        }
    });

    it('POST /call 未知工具返回 404；缺 name 返回 400；执行异常回喂 isError 结果', async () => {
        const registry = getPlatformToolRegistry();
        registry.register({
            name: 'test__boom',
            label: 'Boom',
            description: '总是抛错',
            category: 'mcp',
            inputSchema: {type: 'object', properties: {}},
            async execute() {
                throw new Error('炸了');
            },
        });
        const gateway = new McpGateway(emptyRegistry());
        const app = express();
        app.use(express.json());
        gateway.attachPlatformApi(app, '/api/platform');
        const base = await listen(app);

        try {
            const missing = await fetch(`${base}/api/platform/call`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: {}}),
            });
            expect(missing.status).toBe(400);

            const unknown = await fetch(`${base}/api/platform/call`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({name: 'nope', args: {}}),
            });
            expect(unknown.status).toBe(404);

            const boom = await fetch(`${base}/api/platform/call`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({name: 'test__boom', args: {}}),
            });
            expect(boom.status).toBe(200);
            const payload = await boom.json() as {text: string; isError: boolean};
            expect(payload.isError).toBe(true);
            expect(payload.text).toContain('炸了');
        } finally {
            registry.unregister('test__boom');
        }
    });
});
