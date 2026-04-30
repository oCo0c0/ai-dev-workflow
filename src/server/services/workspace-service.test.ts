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

  describe('detectProjectType', () => {
    it('detects node project (package.json)', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      expect(service.detectProjectType(tempDir)).toBe('node');
    });

    it('detects java project (pom.xml)', () => {
      fs.writeFileSync(path.join(tempDir, 'pom.xml'), '<project/>');
      expect(service.detectProjectType(tempDir)).toBe('java');
    });

    it('detects rust project (Cargo.toml)', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]');
      expect(service.detectProjectType(tempDir)).toBe('rust');
    });

    it('detects python project (requirements.txt)', () => {
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'flask');
      expect(service.detectProjectType(tempDir)).toBe('python');
    });

    it('returns unknown for empty directory', () => {
      expect(service.detectProjectType(tempDir)).toBe('unknown');
    });
  });

  describe('scanContextFiles', () => {
    it('finds context files present in workspace', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(tempDir, '.gitignore'), '');

      const files = service.scanContextFiles(tempDir);
      expect(files).toContain('package.json');
      expect(files).toContain('tsconfig.json');
      expect(files).toContain('.gitignore');
    });

    it('returns empty array for empty directory', () => {
      const files = service.scanContextFiles(tempDir);
      expect(files).toEqual([]);
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

  describe('isWithinWorkspace', () => {
    it('returns true for paths within workspace', () => {
      expect(service.isWithinWorkspace(tempDir, 'src/file.ts')).toBe(true);
      expect(service.isWithinWorkspace(tempDir, 'nested/deep/file.ts')).toBe(true);
    });

    it('returns true for workspace root itself', () => {
      expect(service.isWithinWorkspace(tempDir, '')).toBe(true);
      expect(service.isWithinWorkspace(tempDir, '.')).toBe(true);
    });

    it('returns false for path traversal with ../', () => {
      expect(service.isWithinWorkspace(tempDir, '../outside')).toBe(false);
      expect(service.isWithinWorkspace(tempDir, 'src/../../outside')).toBe(false);
    });

    it('returns false for absolute paths outside workspace', () => {
      expect(service.isWithinWorkspace(tempDir, '/etc/passwd')).toBe(false);
      expect(service.isWithinWorkspace(tempDir, '/tmp/other')).toBe(false);
    });

    it('handles paths that start with workspace name but are not children', () => {
      // e.g., workspace is /tmp/workspace, target resolves to /tmp/workspace-evil
      const workspace = path.join(tempDir, 'workspace');
      fs.mkdirSync(workspace);
      // A sibling directory that starts with the same prefix
      expect(service.isWithinWorkspace(workspace, '../workspace-evil/file.txt')).toBe(false);
    });
  });
});
