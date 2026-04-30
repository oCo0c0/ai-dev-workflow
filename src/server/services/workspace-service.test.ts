import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceService } from './workspace-service.js';

describe('WorkspaceService', () => {
  let tempDir: string;
  let configDir: string;
  let service: WorkspaceService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-test-'));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-config-'));
    service = new WorkspaceService(configDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  describe('browse', () => {
    it('returns directory entries', () => {
      fs.writeFileSync(path.join(tempDir, 'file.txt'), 'hello');
      fs.mkdirSync(path.join(tempDir, 'subdir'));

      const entries = service.browse(tempDir);
      expect(entries.length).toBe(2);

      const file = entries.find(e => e.name === 'file.txt');
      expect(file).toBeDefined();
      expect(file!.isDirectory).toBe(false);
      expect(file!.size).toBe(5);

      const dir = entries.find(e => e.name === 'subdir');
      expect(dir).toBeDefined();
      expect(dir!.isDirectory).toBe(true);
    });

    it('throws for non-existent path', () => {
      expect(() => service.browse('/nonexistent/path/xyz')).toThrow('does not exist');
    });

    it('throws for file path (not directory)', () => {
      const filePath = path.join(tempDir, 'file.txt');
      fs.writeFileSync(filePath, 'content');
      expect(() => service.browse(filePath)).toThrow('not a directory');
    });
  });

  describe('validate', () => {
    it('returns valid for accessible directory', () => {
      const result = service.validate(tempDir);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns invalid for non-existent path', () => {
      const result = service.validate('/nonexistent/path/xyz');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not exist');
    });

    it('returns invalid for file path', () => {
      const filePath = path.join(tempDir, 'file.txt');
      fs.writeFileSync(filePath, 'content');
      const result = service.validate(filePath);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not a directory');
    });
  });

  describe('workspace history', () => {
    it('returns empty array when no history exists', () => {
      expect(service.getHistory()).toEqual([]);
    });

    it('adds workspace to history', () => {
      service.addToHistory(tempDir);
      const history = service.getHistory();
      expect(history).toContain(path.resolve(tempDir));
    });

    it('deduplicates entries (moves to front)', () => {
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws1-'));
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-'));

      service.addToHistory(dir1);
      service.addToHistory(dir2);
      service.addToHistory(dir1); // re-add dir1

      const history = service.getHistory();
      expect(history[0]).toBe(path.resolve(dir1));
      expect(history[1]).toBe(path.resolve(dir2));
      expect(history.length).toBe(2);

      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    });

    it('limits history to 10 entries', () => {
      const dirs: string[] = [];
      for (let i = 0; i < 15; i++) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ws${i}-`));
        dirs.push(dir);
        service.addToHistory(dir);
      }

      const history = service.getHistory();
      expect(history.length).toBe(10);
      // Most recent should be first
      expect(history[0]).toBe(path.resolve(dirs[14]));

      // Cleanup
      for (const dir of dirs) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('most recent entry is first', () => {
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws1-'));
      const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ws2-'));

      service.addToHistory(dir1);
      service.addToHistory(dir2);

      const history = service.getHistory();
      expect(history[0]).toBe(path.resolve(dir2));

      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    });
  });

});
