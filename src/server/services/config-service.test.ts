import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigService, validateConfig, AppConfig } from './config-service.js';

describe('ConfigService', () => {
  let tempDir: string;
  let service: ConfigService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
    service = new ConfigService(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('creates default config when file does not exist', () => {
      const config = service.load();
      expect(config).toEqual(service.getDefaultConfig());
      // File should now exist
      expect(fs.existsSync(service.getConfigFile())).toBe(true);
    });

    it('reads existing valid config', () => {
      const customConfig: AppConfig = {
        server: { port: 4000, host: '0.0.0.0' },
        ui: { theme: 'light', sidebarCollapsed: true },
      };
      fs.writeFileSync(
        path.join(tempDir, 'config.json'),
        JSON.stringify(customConfig),
        'utf-8'
      );

      const loaded = service.load();
      expect(loaded).toEqual(customConfig);
    });

    it('throws on invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'config.json'), 'not json{{{', 'utf-8');
      expect(() => service.load()).toThrow('invalid JSON');
    });

    it('throws on invalid config structure', () => {
      fs.writeFileSync(
        path.join(tempDir, 'config.json'),
        JSON.stringify({ server: { port: 'not-a-number' } }),
        'utf-8'
      );
      expect(() => service.load()).toThrow('Config validation failed');
    });
  });

  describe('save', () => {
    it('saves valid config to disk', () => {
      const config: AppConfig = {
        server: { port: 8080 },
        ui: { theme: 'dark' },
      };
      service.save(config);

      const raw = fs.readFileSync(service.getConfigFile(), 'utf-8');
      expect(JSON.parse(raw)).toEqual(config);
    });

    it('rejects invalid config without writing', () => {
      // Write a valid config first
      const validConfig: AppConfig = { server: { port: 3000 } };
      service.save(validConfig);

      // Try to save invalid config
      const invalidConfig = { server: { port: -1 } } as unknown as AppConfig;
      expect(() => service.save(invalidConfig)).toThrow('Config validation failed');

      // Original file should be unchanged
      const raw = fs.readFileSync(service.getConfigFile(), 'utf-8');
      expect(JSON.parse(raw)).toEqual(validConfig);
    });

    it('creates config directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir');
      const nestedService = new ConfigService(nestedDir);
      nestedService.save({ server: { port: 5000 } });
      expect(fs.existsSync(path.join(nestedDir, 'config.json'))).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('accepts empty object', () => {
      expect(validateConfig({})).toEqual([]);
    });

    it('accepts valid full config', () => {
      const config: AppConfig = {
        server: { port: 3000, host: 'localhost' },
        claudeCodeCli: { path: '/usr/bin/claude' },
        ui: { theme: 'dark', sidebarCollapsed: false },
        defaultPipelineId: 'pipeline-1',
      };
      expect(validateConfig(config)).toEqual([]);
    });

    it('rejects null', () => {
      const errors = validateConfig(null);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects non-object', () => {
      const errors = validateConfig('string');
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects invalid port (out of range)', () => {
      const errors = validateConfig({ server: { port: 99999 } });
      expect(errors.some(e => e.field === 'server.port')).toBe(true);
    });

    it('rejects invalid port (not integer)', () => {
      const errors = validateConfig({ server: { port: 3.14 } });
      expect(errors.some(e => e.field === 'server.port')).toBe(true);
    });

    it('rejects invalid theme value', () => {
      const errors = validateConfig({ ui: { theme: 'blue' } });
      expect(errors.some(e => e.field === 'ui.theme')).toBe(true);
    });

    it('rejects non-boolean sidebarCollapsed', () => {
      const errors = validateConfig({ ui: { sidebarCollapsed: 'yes' } });
      expect(errors.some(e => e.field === 'ui.sidebarCollapsed')).toBe(true);
    });

    it('rejects non-string defaultPipelineId', () => {
      const errors = validateConfig({ defaultPipelineId: 123 });
      expect(errors.some(e => e.field === 'defaultPipelineId')).toBe(true);
    });
  });
});
