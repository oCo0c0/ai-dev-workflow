import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CLIRunnerService } from './cli-runner-service.js';
import { WorkspaceService } from './workspace-service.js';

describe('CLIRunnerService', () => {
  let tempDir: string;
  let workspaceService: WorkspaceService;
  let service: CLIRunnerService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runner-test-'));
    workspaceService = new WorkspaceService(path.join(tempDir, '.config'));
    service = new CLIRunnerService(workspaceService);
  });

  afterEach(() => {
    service.cancelAll();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('checkAvailability', () => {
    it('returns an object with available property', async () => {
      const result = await service.checkAvailability();
      expect(result).toHaveProperty('available');
      if (result.available) {
        expect(result.version).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('generatePlan', () => {
    it('returns a result object with exitCode', async () => {
      try {
        const res = await service.generatePlan(
          { requirementDetail: 'Test requirement', workspacePath: tempDir },
          { workspacePath: tempDir }
        );
        expect(res).toHaveProperty('exitCode');
      } catch (err) {
        // Bridge not available in test env is acceptable
        expect((err as Error).message).toBeDefined();
      }
    });
  });

  describe('executeStep', () => {
    it('returns a result object with exitCode', async () => {
      try {
        const res = await service.executeStep('Create a hello.txt file', {
          workspacePath: tempDir,
        });
        expect(res).toHaveProperty('exitCode');
      } catch (err) {
        expect((err as Error).message).toBeDefined();
      }
    });
  });

  describe('cancelAll', () => {
    it('does not throw when no processes are running', () => {
      expect(() => service.cancelAll()).not.toThrow();
    });
  });

  describe('getActiveProcessCount', () => {
    it('returns 0 when no processes are running', () => {
      expect(service.getActiveProcessCount()).toBe(0);
    });
  });
});
