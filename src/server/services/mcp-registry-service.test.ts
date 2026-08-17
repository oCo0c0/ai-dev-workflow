/**
 * @file mcp-registry-service.test.ts
 * @description MCPRegistryService 单元测试
 *
 * 验证 adw 自有 MCP 注册中心的核心功能：
 * - CRUD（add/list/get/update/delete）
 * - 参数校验（命令必填、shell 元字符拦截、重复名称拒绝）
 * - importFromProviders：从 claude/codex/pi 配置文件导入并标记来源
 * - 导入不覆盖已存在的服务器
 * 所有文件路径通过构造选项注入临时目录，测试完全隔离。
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {MCPRegistryService} from './mcp-registry-service.js';

describe('MCPRegistryService', () => {
    let tempDir: string;
    let registryFile: string;
    let claudeGlobalFile: string;
    let codexConfigFile: string;
    let piSettingsFile: string;
    let service: MCPRegistryService;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-registry-test-'));
        registryFile = path.join(tempDir, 'mcp-servers.json');
        claudeGlobalFile = path.join(tempDir, 'claude.json');
        codexConfigFile = path.join(tempDir, 'config.toml');
        piSettingsFile = path.join(tempDir, 'pi-settings.json');
        service = new MCPRegistryService({
            registryFile,
            claudeGlobalFile,
            claudeSettingsFile: path.join(tempDir, 'claude-settings.json'),
            codexConfigFile,
            piSettingsFile,
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    describe('CRUD', () => {
        it('adds, lists, gets, updates and deletes servers', () => {
            expect(service.list()).toEqual([]);

            const added = service.add({name: 'ones-api', command: 'npx', args: ['-y', 'ai-dev-requirements'], env: {KEY: 'V'}});
            expect(added.name).toBe('ones-api');
            expect(added.type).toBe('node'); // npx → node
            expect(added.source).toBe('manual');

            expect(service.list()).toHaveLength(1);
            expect(service.get('ones-api')?.command).toBe('npx');
            expect(service.get('missing')).toBeUndefined();

            const updated = service.update('ones-api', {command: 'node'});
            expect(updated.command).toBe('node');

            expect(service.delete('ones-api')).toBe(true);
            expect(service.delete('ones-api')).toBe(false);
            expect(service.list()).toEqual([]);
        });

        it('rejects duplicate names', () => {
            service.add({name: 'dup', command: 'node'});
            expect(() => service.add({name: 'dup', command: 'python'})).toThrow('already exists');
        });

        it('rejects empty or unsafe commands', () => {
            expect(() => service.add({name: 'x', command: ''})).toThrow('required');
            expect(() => service.add({name: 'x', command: 'node; rm -rf /'})).toThrow('invalid characters');
            expect(() => service.add({name: 'x', command: 'node', env: {K: 123 as unknown as string}})).toThrow('must be a string');
            expect(() => service.add({name: 'x', command: 'node', args: ['a', 1 as unknown as string]})).toThrow('must be an array of strings');
        });

        it('persists to the registry file', () => {
            service.add({name: 'persist-me', command: 'python server.py'});
            expect(JSON.parse(fs.readFileSync(registryFile, 'utf-8')).servers).toHaveLength(1);

            // 新实例读取同一文件
            const reloaded = new MCPRegistryService({
                registryFile,
                claudeGlobalFile,
                codexConfigFile,
                piSettingsFile,
            });
            expect(reloaded.get('persist-me')?.command).toBe('python server.py');
        });

        it('returns empty list when registry file is corrupted', () => {
            fs.writeFileSync(registryFile, '{not valid json', 'utf-8');
            expect(service.list()).toEqual([]);
        });
    });

    describe('importFromProviders', () => {
        it('imports servers from claude/codex/pi configs with source tags', () => {
            // Claude 全局配置
            fs.writeFileSync(claudeGlobalFile, JSON.stringify({
                mcpServers: {
                    'ones-api': {command: 'cmd', args: ['/c', 'npx', 'ai-dev-requirements']},
                    'memory': {command: 'cmd', args: ['/c', 'npx', 'server-memory']},
                },
            }), 'utf-8');
            // Codex config.toml
            fs.writeFileSync(codexConfigFile, [
                '[mcp_servers.github]',
                'command = "npx"',
                'args = ["-y", "@github/mcp"]',
                '',
                '[mcp_servers.db]',
                'command = "docker run mcp-db"',
            ].join('\n'), 'utf-8');
            // Pi settings.json
            fs.writeFileSync(piSettingsFile, JSON.stringify({
                defaultProvider: 'deepseek',
                mcpServers: {
                    'pi-server': {command: 'node', args: ['pi-mcp.js']},
                },
            }), 'utf-8');

            const stats = service.importFromProviders();

            expect(stats.imported).toBe(5); // 2 claude + 2 codex + 1 pi，无重名
            expect(stats.sources.claude).toBe(2);
            expect(stats.sources.codex).toBe(2);
            expect(stats.sources.pi).toBe(1);

            const list = service.list();
            expect(list).toHaveLength(5);
            expect(service.get('ones-api')?.source).toBe('claude');
            expect(service.get('github')?.source).toBe('codex');
            expect(service.get('pi-server')?.source).toBe('pi');
            expect(service.get('db')?.type).toBe('docker');
        });

        it('does not overwrite existing registry entries', () => {
            service.add({name: 'ones-api', command: 'my-custom-command', source: 'manual'});
            fs.writeFileSync(claudeGlobalFile, JSON.stringify({
                mcpServers: {'ones-api': {command: 'npx'}},
            }), 'utf-8');

            const stats = service.importFromProviders();
            expect(stats.imported).toBe(0);
            expect(service.get('ones-api')?.command).toBe('my-custom-command');
            expect(service.get('ones-api')?.source).toBe('manual');
        });

        it('is safe when provider configs do not exist', () => {
            const stats = service.importFromProviders();
            expect(stats.imported).toBe(0);
            expect(service.list()).toEqual([]);
        });
    });
});
