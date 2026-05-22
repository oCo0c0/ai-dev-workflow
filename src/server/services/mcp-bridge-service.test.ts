/**
 * @file MCPBridgeService 单元测试
 * @description 测试 MCP（Model Context Protocol）桥接服务的核心功能，包括：
 *              1. 需求详情获取（fetchRequirementDetail） - 通过 MCP 协议从 ONES 平台获取需求详情
 *              2. 需求搜索（searchRequirements） - 通过 MCP 协议在 ONES 平台中搜索需求
 *              3. 服务器名称管理（getServerName / setServerName） - 配置和切换 MCP 服务器
 *              4. 响应解析（parseRequirementList） - 处理 MCP 服务器返回的 JSON-RPC 响应
 *              该服务作为应用与 MCP 服务器之间的桥梁，负责启动 MCP 客户端进程、
 *              发送请求并处理响应。测试通过临时配置文件和模拟命令来验证各种边界情况。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {MCPConfigService} from './mcp-config-service.js';
import {MCPBridgeService} from './mcp-bridge-service.js';

describe('MCPBridgeService', () => {
    /** @description 测试用临时目录路径 */
    let tempDir: string;
    /** @description 临时 MCP 配置文件路径（settings.json） */
    let settingsFile: string;
    /** @description MCP 配置服务实例，用于管理 MCP 服务器配置 */
    let mcpConfigService: MCPConfigService;
    /** @description 被测试的 MCP 桥接服务实例 */
    let service: MCPBridgeService;

    /**
     * 测试前置钩子：在每个测试用例执行前
     * - 创建唯一的临时目录
     * - 构造临时配置文件路径
     * - 实例化 MCPConfigService 和 MCPBridgeService
     */
    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-test-'));
        settingsFile = path.join(tempDir, 'settings.json');
        mcpConfigService = new MCPConfigService(settingsFile);
        service = new MCPBridgeService(mcpConfigService);
    });

    /**
     * 测试后置钩子：在每个测试用例执行后
     * - 递归删除临时目录，清理所有测试产生的文件和子进程
     */
    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('fetchRequirementDetail', () => {
        /**
         * 测试：MCP 服务器未配置时应抛出错误
         * @description 当没有配置任何 MCP 服务器时，fetchRequirementDetail 方法
         *              应抛出包含 "not configured" 的错误，提示用户先配置 MCP 服务器。
         */
        it('throws when MCP server is not configured', async () => {
            await expect(service.fetchRequirementDetail('123')).rejects.toThrow('not configured');
        });

        /**
         * 测试：MCP 调用失败时应抛出友好的错误消息
         * @description 当 MCP 服务器配置存在但无法正常启动（如命令不存在）时，
         *              应抛出 "Failed to fetch requirement detail" 错误，
         *              而非底层的系统错误，提供更好的用户体验。
         *              测试使用一个不存在的命令来模拟启动失败的场景。
         */
        it('throws with helpful message when MCP call fails', async () => {
            // 配置一个不存在的 MCP 服务器命令，模拟启动失败
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'ones-mcp': {command: 'nonexistent-mcp-command-xyz'},
                },
            }), 'utf-8');

            await expect(service.fetchRequirementDetail('123')).rejects.toThrow('Failed to fetch requirement detail');
        });
    });

    describe('searchRequirements', () => {
        /**
         * 测试：MCP 服务器未配置时应抛出错误
         * @description 与 fetchRequirementDetail 类似，searchRequirements 在
         *              未配置 MCP 服务器时也应提示用户进行配置。
         */
        it('throws when MCP server is not configured', async () => {
            await expect(service.searchRequirements('test')).rejects.toThrow('not configured');
        });

        /**
         * 测试：MCP 调用失败时应抛出友好的错误消息
         * @description 验证搜索需求时，MCP 服务器启动失败会抛出
         *              "Failed to search requirements" 错误。
         */
        it('throws with helpful message when MCP call fails', async () => {
            // 配置一个不存在的 MCP 服务器命令
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'ones-mcp': {command: 'nonexistent-mcp-command-xyz'},
                },
            }), 'utf-8');

            await expect(service.searchRequirements('test')).rejects.toThrow('Failed to search requirements');
        });
    });

    describe('getServerName / setServerName', () => {
        /**
         * 测试：默认服务器名称应为 'ones-mcp'
         * @description 验证在不指定服务器名称的情况下，MCPBridgeService
         *              默认使用 'ones-mcp' 作为 MCP 服务器名称。
         */
        it('defaults to ones-mcp', () => {
            expect(service.getServerName()).toBe('ones-mcp');
        });

        /**
         * 测试：应允许动态更改服务器名称
         * @description 验证 setServerName 方法能够在运行时切换 MCP 服务器，
         *              getServerName 应返回更新后的名称。
         */
        it('allows changing the server name', () => {
            service.setServerName('custom-mcp');
            expect(service.getServerName()).toBe('custom-mcp');
        });

        /**
         * 测试：构造函数应支持自定义服务器名称
         * @description 验证通过构造函数的第二个参数传入自定义服务器名称，
         *              服务应使用该名称而非默认值。
         */
        it('uses custom server name in constructor', () => {
            const customService = new MCPBridgeService(mcpConfigService, 'my-server');
            expect(customService.getServerName()).toBe('my-server');
        });
    });

    describe('parseRequirementList (via integration)', () => {
        /**
         * 测试：MCP 服务器立即退出且无输出时应正确处理
         * @description 这是一个集成测试，间接验证响应解析逻辑。
         *              当 MCP 服务器进程启动后立即退出（退出码为 0）但不产生任何输出时，
         *              搜索方法应抛出异常而非静默失败。
         *              使用 'true' 命令（Unix/Linux 中退出码为 0 且无输出的命令）来模拟此场景。
         */
        it('handles MCP server that exits immediately with no output', async () => {
            // 使用 'true' 命令模拟一个立即退出且无输出的 MCP 服务器
            fs.writeFileSync(settingsFile, JSON.stringify({
                mcpServers: {
                    'ones-mcp': {command: 'true'},
                },
            }), 'utf-8');

            // 验证服务能够检测到异常并抛出错误
            await expect(service.searchRequirements('test')).rejects.toThrow();
        });
    });
});
