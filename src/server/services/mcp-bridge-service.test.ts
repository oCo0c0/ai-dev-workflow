import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MCPConfigService } from './mcp-config-service.js';
import { MCPBridgeService } from './mcp-bridge-service.js';

describe('MCPBridgeService', () => {
  let tempDir: string;
  let settingsFile: string;
  let mcpConfigService: MCPConfigService;
  let service: MCPBridgeService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-bridge-test-'));
    settingsFile = path.join(tempDir, 'settings.json');
    mcpConfigService = new MCPConfigService(settingsFile);
    service = new MCPBridgeService(mcpConfigService);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('checkAvailability', () => {
    it('returns false when MCP server is not configured', async () => {
      const result = await service.checkAvailability();
      expect(result).toBe(false);
    });

    it('returns false when MCP server command does not exist', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'nonexistent-mcp-command-xyz' },
        },
      }), 'utf-8');

      const result = await service.checkAvailability();
      expect(result).toBe(false);
    });
  });

  describe('testConnection', () => {
    it('returns not configured message when server does not exist', async () => {
      const result = await service.testConnection();
      expect(result.connected).toBe(false);
      expect(result.message).toContain('not configured');
    });

    it('returns error when server command fails', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'nonexistent-mcp-command-xyz' },
        },
      }), 'utf-8');

      const result = await service.testConnection();
      expect(result.connected).toBe(false);
    });

    it('returns connected for a valid command', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'echo', args: ['hello'] },
        },
      }), 'utf-8');

      const result = await service.testConnection();
      expect(result.connected).toBe(true);
      expect(result.latency).toBeDefined();
    });
  });

  describe('fetchRequirements', () => {
    it('throws when MCP server is not configured', async () => {
      await expect(service.fetchRequirements()).rejects.toThrow('not configured');
    });

    it('throws with helpful message when MCP call fails', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'nonexistent-mcp-command-xyz' },
        },
      }), 'utf-8');

      await expect(service.fetchRequirements()).rejects.toThrow('Failed to fetch requirements');
    });
  });

  describe('fetchRequirementDetail', () => {
    it('throws when MCP server is not configured', async () => {
      await expect(service.fetchRequirementDetail('123')).rejects.toThrow('not configured');
    });

    it('throws with helpful message when MCP call fails', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'nonexistent-mcp-command-xyz' },
        },
      }), 'utf-8');

      await expect(service.fetchRequirementDetail('123')).rejects.toThrow('Failed to fetch requirement detail');
    });
  });

  describe('searchRequirements', () => {
    it('throws when MCP server is not configured', async () => {
      await expect(service.searchRequirements('test')).rejects.toThrow('not configured');
    });

    it('throws with helpful message when MCP call fails', async () => {
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'nonexistent-mcp-command-xyz' },
        },
      }), 'utf-8');

      await expect(service.searchRequirements('test')).rejects.toThrow('Failed to search requirements');
    });
  });

  describe('getServerName / setServerName', () => {
    it('defaults to ones-mcp', () => {
      expect(service.getServerName()).toBe('ones-mcp');
    });

    it('allows changing the server name', () => {
      service.setServerName('custom-mcp');
      expect(service.getServerName()).toBe('custom-mcp');
    });

    it('uses custom server name in constructor', () => {
      const customService = new MCPBridgeService(mcpConfigService, 'my-server');
      expect(customService.getServerName()).toBe('my-server');
    });
  });

  describe('parseRequirementList (via integration)', () => {
    // Test the parsing logic indirectly through a mock MCP server
    // that outputs JSON-RPC responses
    it('handles MCP server that exits immediately with no output', async () => {
      // Use 'true' command which exits with 0 but produces no output
      fs.writeFileSync(settingsFile, JSON.stringify({
        mcpServers: {
          'ones-mcp': { command: 'true' },
        },
      }), 'utf-8');

      await expect(service.fetchRequirements()).rejects.toThrow();
    });
  });
});
