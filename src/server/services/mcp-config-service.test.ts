import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MCPConfigService } from './mcp-config-service.js';

describe('MCPConfigService', () => {
  let tempDir: string;
  let settingsFile: string;
  let service: MCPConfigService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
    settingsFile = path.join(tempDir, 'settings.json');
    service = new MCPConfigService(settingsFile);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns empty array when settings file does not exist', () => {
      expect(service.list()).toEqual([]);
    });

    it('returns empty array when settings has no mcpServers', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({ otherField: true }), 'utf-8');
      expect(service.list()).toEqual([]);
    });

    it('returns empty array when file contains invalid JSON', () => {
      fs.writeFileSync(settingsFile, 'not json{', 'utf-8');
      expect(service.list()).toEqual([]);
    });

    it('lists configured MCP servers', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'npx', args: ['@ones/mcp-server'], env: { TOKEN: 'abc' } },
          'db-server': { command: 'python', args: ['db_mcp.py'] },
        },
      }), 'utf-8');

      const servers = service.list();
      expect(servers).toHaveLength(2);

      const ones = servers.find(s => s.name === 'ones-mcp')!;
      expect(ones.command).toBe('npx');
      expect(ones.args).toEqual(['@ones/mcp-server']);
      expect(ones.env).toEqual({ TOKEN: 'abc' });
      expect(ones.type).toBe('node');

      const db = servers.find(s => s.name === 'db-server')!;
      expect(db.command).toBe('python');
      expect(db.type).toBe('python');
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent server', () => {
      expect(service.get('nonexistent')).toBeUndefined();
    });

    it('returns server config by name', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'test-server': { command: 'node', args: ['server.js'] },
        },
      }), 'utf-8');

      const config = service.get('test-server');
      expect(config).toBeDefined();
      expect(config!.name).toBe('test-server');
      expect(config!.command).toBe('node');
      expect(config!.args).toEqual(['server.js']);
    });
  });

  describe('add', () => {
    it('adds a new MCP server to settings', () => {
      const result = service.add({
        name: 'new-server',
        type: 'node',
        command: 'npx',
        args: ['@test/mcp'],
        env: { API_KEY: 'key123' },
        enabled: true,
      });

      expect(result.name).toBe('new-server');
      expect(result.status).toBe('disconnected');

      // Verify persisted
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(raw.mcpServers['new-server']).toBeDefined();
      expect(raw.mcpServers['new-server'].command).toBe('npx');
      expect(raw.mcpServers['new-server'].args).toEqual(['@test/mcp']);
      expect(raw.mcpServers['new-server'].env).toEqual({ API_KEY: 'key123' });
    });

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

    it('throws when server already exists', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'existing': { command: 'node', args: [] } },
      }), 'utf-8');

      expect(() => service.add({
        name: 'existing',
        type: 'node',
        command: 'node',
        args: [],
        env: {},
        enabled: true,
      })).toThrow('already exists');
    });

    it('preserves other settings fields', () => {
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

      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(raw.otherSetting).toBe('preserved');
    });

    it('omits empty args and env from storage', () => {
      service.add({
        name: 'minimal',
        type: 'node',
        command: 'node',
        args: [],
        env: {},
        enabled: true,
      });

      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(raw.mcpServers['minimal'].args).toBeUndefined();
      expect(raw.mcpServers['minimal'].env).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates an existing server config', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'my-server': { command: 'old-cmd', args: ['old'] } },
      }), 'utf-8');

      const result = service.update('my-server', { command: 'new-cmd', args: ['new'] });
      expect(result.command).toBe('new-cmd');
      expect(result.args).toEqual(['new']);

      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(raw.mcpServers['my-server'].command).toBe('new-cmd');
    });

    it('throws when server does not exist', () => {
      expect(() => service.update('nonexistent', { command: 'test' })).toThrow('not found');
    });

    it('preserves unchanged fields', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'server': { command: 'node', args: ['app.js'], env: { KEY: 'val' } } },
      }), 'utf-8');

      const result = service.update('server', { command: 'python' });
      expect(result.command).toBe('python');
      expect(result.args).toEqual(['app.js']);
      expect(result.env).toEqual({ KEY: 'val' });
    });
  });

  describe('delete', () => {
    it('returns false for non-existent server', () => {
      expect(service.delete('nonexistent')).toBe(false);
    });

    it('removes server from settings', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'keep': { command: 'node', args: [] },
          'remove': { command: 'python', args: [] },
        },
      }), 'utf-8');

      const result = service.delete('remove');
      expect(result).toBe(true);

      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
      expect(raw.mcpServers['remove']).toBeUndefined();
      expect(raw.mcpServers['keep']).toBeDefined();
    });
  });

  describe('testConnection', () => {
    it('returns error for non-existent server', async () => {
      const result = await service.testConnection('nonexistent');
      expect(result.status).toBe('error');
      expect(result.message).toContain('not found');
    });

    it('returns error when command cannot be spawned', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'bad-server': { command: 'nonexistent-command-xyz-123' } },
      }), 'utf-8');

      const result = await service.testConnection('bad-server', 2000);
      expect(result.status).toBe('error');
    });

    it('returns connected for a command that runs successfully', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'echo-server': { command: 'echo', args: ['hello'] } },
      }), 'utf-8');

      const result = await service.testConnection('echo-server', 2000);
      expect(result.status).toBe('connected');
    });
  });

  describe('type inference', () => {
    it('infers node type from npx command', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'test': { command: 'npx', args: ['@test/server'] } },
      }), 'utf-8');

      const config = service.get('test');
      expect(config!.type).toBe('node');
    });

    it('infers python type from python command', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'test': { command: 'python', args: ['server.py'] } },
      }), 'utf-8');

      const config = service.get('test');
      expect(config!.type).toBe('python');
    });

    it('infers docker type from docker command', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'test': { command: 'docker', args: ['run', 'mcp-image'] } },
      }), 'utf-8');

      const config = service.get('test');
      expect(config!.type).toBe('docker');
    });

    it('returns custom for unknown commands', () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: { 'test': { command: '/usr/local/bin/my-server' } },
      }), 'utf-8');

      const config = service.get('test');
      expect(config!.type).toBe('custom');
    });
  });
});
