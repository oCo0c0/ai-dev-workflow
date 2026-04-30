import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PipelineService, WorkflowPipeline, PipelineStepConfig } from './pipeline-service.js';

function createSteps(overrides?: Partial<PipelineStepConfig>): PipelineStepConfig {
  return {
    requirementSource: { type: 'manual' },
    workspace: {},
    skillSet: { mode: 'all', selectedSkills: [] },
    mcpToolSet: { mode: 'all', selectedServers: [] },
    testStrategy: { mode: 'run_existing', framework: 'vitest', command: 'npm test', autoRunAfterExecution: true },
    ...overrides,
  };
}

describe('PipelineService', () => {
  let tempDir: string;
  let service: PipelineService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
    service = new PipelineService(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns empty array when no pipelines file exists', () => {
      expect(service.list()).toEqual([]);
    });

    it('returns empty array when file contains invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'pipelines.json'), 'not json', 'utf-8');
      expect(service.list()).toEqual([]);
    });

    it('returns empty array when file contains non-array JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'pipelines.json'), '{}', 'utf-8');
      expect(service.list()).toEqual([]);
    });

    it('returns pipelines from file', () => {
      const pipeline = service.create({ name: 'Test', description: 'desc', isDefault: false, steps: createSteps() });
      const list = service.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(pipeline.id);
    });
  });

  describe('create', () => {
    it('creates a pipeline with generated id and timestamps', () => {
      const pipeline = service.create({
        name: 'My Pipeline',
        description: 'A test pipeline',
        isDefault: false,
        steps: createSteps(),
      });

      expect(pipeline.id).toBeDefined();
      expect(pipeline.name).toBe('My Pipeline');
      expect(pipeline.description).toBe('A test pipeline');
      expect(pipeline.isDefault).toBe(false);
      expect(pipeline.createdAt).toBeDefined();
      expect(pipeline.updatedAt).toBeDefined();
    });

    it('persists pipeline to disk', () => {
      service.create({ name: 'Persisted', description: '', isDefault: false, steps: createSteps() });
      const raw = fs.readFileSync(path.join(tempDir, 'pipelines.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Persisted');
    });

    it('unsets other defaults when creating a default pipeline', () => {
      const first = service.create({ name: 'First', description: '', isDefault: true, steps: createSteps() });
      const second = service.create({ name: 'Second', description: '', isDefault: true, steps: createSteps() });

      const list = service.list();
      const firstUpdated = list.find(p => p.id === first.id)!;
      const secondUpdated = list.find(p => p.id === second.id)!;

      expect(firstUpdated.isDefault).toBe(false);
      expect(secondUpdated.isDefault).toBe(true);
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent id', () => {
      expect(service.get('non-existent')).toBeUndefined();
    });

    it('returns the pipeline by id', () => {
      const created = service.create({ name: 'Find Me', description: '', isDefault: false, steps: createSteps() });
      const found = service.get(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('Find Me');
    });
  });

  describe('update', () => {
    it('throws when pipeline not found', () => {
      expect(() => service.update('non-existent', { name: 'New' })).toThrow('Pipeline not found');
    });

    it('updates pipeline fields', () => {
      const created = service.create({ name: 'Original', description: 'old', isDefault: false, steps: createSteps() });
      const updated = service.update(created.id, { name: 'Updated', description: 'new' });

      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('new');
      expect(updated.id).toBe(created.id);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.updatedAt).not.toBe(created.updatedAt);
    });

    it('unsets other defaults when setting as default', () => {
      const first = service.create({ name: 'First', description: '', isDefault: true, steps: createSteps() });
      const second = service.create({ name: 'Second', description: '', isDefault: false, steps: createSteps() });

      service.update(second.id, { isDefault: true });

      const list = service.list();
      expect(list.find(p => p.id === first.id)!.isDefault).toBe(false);
      expect(list.find(p => p.id === second.id)!.isDefault).toBe(true);
    });
  });

  describe('delete', () => {
    it('returns false for non-existent pipeline', () => {
      expect(service.delete('non-existent')).toBe(false);
    });

    it('removes pipeline from storage', () => {
      const created = service.create({ name: 'Delete Me', description: '', isDefault: false, steps: createSteps() });
      const result = service.delete(created.id);

      expect(result).toBe(true);
      expect(service.list()).toHaveLength(0);
    });
  });

  describe('setDefault', () => {
    it('throws when pipeline not found', () => {
      expect(() => service.setDefault('non-existent')).toThrow('Pipeline not found');
    });

    it('sets the specified pipeline as default and unsets others', () => {
      const first = service.create({ name: 'First', description: '', isDefault: true, steps: createSteps() });
      const second = service.create({ name: 'Second', description: '', isDefault: false, steps: createSteps() });

      service.setDefault(second.id);

      const list = service.list();
      expect(list.find(p => p.id === first.id)!.isDefault).toBe(false);
      expect(list.find(p => p.id === second.id)!.isDefault).toBe(true);
    });
  });

  describe('validate', () => {
    it('returns valid for a pipeline with no MCP references', () => {
      const pipeline: WorkflowPipeline = {
        id: 'test-id',
        name: 'Valid Pipeline',
        description: '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: createSteps(),
      };

      const result = service.validate(pipeline, ['server-a', 'server-b']);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error when name is empty', () => {
      const pipeline: WorkflowPipeline = {
        id: 'test-id',
        name: '',
        description: '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: createSteps(),
      };

      const result = service.validate(pipeline, []);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'name')).toBe(true);
    });

    it('returns error when requirement source references non-existent MCP server', () => {
      const pipeline: WorkflowPipeline = {
        id: 'test-id',
        name: 'Test',
        description: '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: createSteps({
          requirementSource: { type: 'ones', mcpServerName: 'missing-server' },
        }),
      };

      const result = service.validate(pipeline, ['server-a']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('missing-server'))).toBe(true);
    });

    it('returns error when MCP tool set references non-existent servers', () => {
      const pipeline: WorkflowPipeline = {
        id: 'test-id',
        name: 'Test',
        description: '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: createSteps({
          mcpToolSet: { mode: 'selected', selectedServers: ['exists', 'missing'] },
        }),
      };

      const result = service.validate(pipeline, ['exists']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.message.includes('missing'))).toBe(true);
    });

    it('passes when all referenced MCP servers exist', () => {
      const pipeline: WorkflowPipeline = {
        id: 'test-id',
        name: 'Test',
        description: '',
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: createSteps({
          requirementSource: { type: 'ones', mcpServerName: 'ones-server' },
          mcpToolSet: { mode: 'selected', selectedServers: ['ones-server', 'other-server'] },
        }),
      };

      const result = service.validate(pipeline, ['ones-server', 'other-server']);
      expect(result.valid).toBe(true);
    });
  });
});
