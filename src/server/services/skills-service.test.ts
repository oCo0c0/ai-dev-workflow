import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SkillsService } from './skills-service.js';

describe('SkillsService', () => {
  let tempDir: string;
  let service: SkillsService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    service = new SkillsService(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns empty array when directory does not exist', () => {
      const nonExistentService = new SkillsService(path.join(tempDir, 'nonexistent'));
      expect(nonExistentService.list()).toEqual([]);
    });

    it('returns empty array when directory is empty', () => {
      expect(service.list()).toEqual([]);
    });

    it('lists .md files as skills', () => {
      fs.writeFileSync(path.join(tempDir, 'code-review.md'), '# Code Review\nReview code for quality', 'utf-8');
      fs.writeFileSync(path.join(tempDir, 'testing.md'), 'Write comprehensive tests', 'utf-8');
      // Non-md file should be ignored
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'not a skill', 'utf-8');

      const skills = service.list();
      expect(skills).toHaveLength(2);
      expect(skills.map(s => s.name).sort()).toEqual(['code-review', 'testing']);
    });

    it('extracts description from first content line', () => {
      fs.writeFileSync(path.join(tempDir, 'my-skill.md'), 'This is the description\nMore content here', 'utf-8');

      const skills = service.list();
      expect(skills[0].description).toBe('This is the description');
    });

    it('extracts description from header', () => {
      fs.writeFileSync(path.join(tempDir, 'my-skill.md'), '# My Skill Title\nContent here', 'utf-8');

      const skills = service.list();
      expect(skills[0].description).toBe('My Skill Title');
    });
  });

  describe('get', () => {
    it('returns undefined for non-existent skill', () => {
      expect(service.get('nonexistent')).toBeUndefined();
    });

    it('returns skill detail with content', () => {
      const content = '# Test Skill\nDo testing things\n\nMore details here.';
      fs.writeFileSync(path.join(tempDir, 'test-skill.md'), content, 'utf-8');

      const detail = service.get('test-skill');
      expect(detail).toBeDefined();
      expect(detail!.name).toBe('test-skill');
      expect(detail!.content).toBe(content);
      expect(detail!.filePath).toBe(path.join(tempDir, 'test-skill.md'));
    });
  });

  describe('create', () => {
    it('creates a new skill file', () => {
      const result = service.create('new-skill', '# New Skill\nDo new things');

      expect(result.name).toBe('new-skill');
      expect(result.content).toBe('# New Skill\nDo new things');
      expect(fs.existsSync(path.join(tempDir, 'new-skill.md'))).toBe(true);
    });

    it('throws when name is empty', () => {
      expect(() => service.create('', 'content')).toThrow('Skill name is required');
    });

    it('throws when content is empty', () => {
      expect(() => service.create('test', '')).toThrow('Skill content cannot be empty');
    });

    it('throws when content is whitespace only', () => {
      expect(() => service.create('test', '   ')).toThrow('Skill content cannot be empty');
    });

    it('throws when skill already exists', () => {
      fs.writeFileSync(path.join(tempDir, 'existing.md'), 'content', 'utf-8');
      expect(() => service.create('existing', 'new content')).toThrow('already exists');
    });

    it('sanitizes name to remove special characters', () => {
      const result = service.create('my skill/name', 'content here');
      expect(result.name).toBe('my-skill-name');
    });

    it('creates commands directory if it does not exist', () => {
      const nestedDir = path.join(tempDir, 'nested', 'commands');
      const nestedService = new SkillsService(nestedDir);
      nestedService.create('test', 'content');
      expect(fs.existsSync(path.join(nestedDir, 'test.md'))).toBe(true);
    });
  });

  describe('update', () => {
    it('updates existing skill content', () => {
      fs.writeFileSync(path.join(tempDir, 'update-me.md'), 'old content', 'utf-8');

      const result = service.update('update-me', 'new content');
      expect(result.content).toBe('new content');

      const onDisk = fs.readFileSync(path.join(tempDir, 'update-me.md'), 'utf-8');
      expect(onDisk).toBe('new content');
    });

    it('throws when content is empty', () => {
      fs.writeFileSync(path.join(tempDir, 'test.md'), 'content', 'utf-8');
      expect(() => service.update('test', '')).toThrow('Skill content cannot be empty');
    });

    it('throws when skill does not exist', () => {
      expect(() => service.update('nonexistent', 'content')).toThrow('not found');
    });
  });

  describe('delete', () => {
    it('returns false for non-existent skill', () => {
      expect(service.delete('nonexistent')).toBe(false);
    });

    it('deletes the skill file', () => {
      fs.writeFileSync(path.join(tempDir, 'delete-me.md'), 'content', 'utf-8');

      const result = service.delete('delete-me');
      expect(result).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'delete-me.md'))).toBe(false);
    });
  });
});
