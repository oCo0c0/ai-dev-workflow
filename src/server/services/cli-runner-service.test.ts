import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CLIRunnerService } from './cli-runner-service.js';

describe('CLIRunnerService', () => {
  let tempDir: string;
  let service: CLIRunnerService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-runner-test-'));
    service = new CLIRunnerService();
  });

  afterEach(() => {
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
});
