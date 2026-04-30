import { Router } from 'express';
import { SkillsService } from '../services/skills-service.js';
import { validateBody } from '../middleware/validation.js';

export function createSkillsRoutes(skillsService: SkillsService): Router {
  const router = Router();

  // GET /api/skills - List all skills
  router.get('/', (_req, res) => {
    try {
      const skills = skillsService.list();
      res.json(skills);
    } catch (err) {
      res.status(500).json({ code: 'SKILLS_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/skills/:name - Get skill detail
  router.get('/:name', (req, res) => {
    try {
      const skill = skillsService.get(req.params.name);
      if (!skill) {
        res.status(404).json({ code: 'NOT_FOUND', message: `Skill "${req.params.name}" not found` });
        return;
      }
      res.json(skill);
    } catch (err) {
      res.status(500).json({ code: 'SKILLS_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/skills - Create a new skill
  router.post('/', validateBody([
    { field: 'name', required: true, type: 'string' },
    { field: 'content', required: true, type: 'string' },
  ]), (req, res) => {
    try {
      const { name, content } = req.body;
      const skill = skillsService.create(name, content);
      res.status(201).json(skill);
    } catch (err) {
      res.status(400).json({ code: 'SKILLS_ERROR', message: (err as Error).message });
    }
  });

  // PUT /api/skills/:name - Update a skill
  router.put('/:name', validateBody([
    { field: 'content', required: true, type: 'string' },
  ]), (req, res) => {
    try {
      const skill = skillsService.update(req.params.name, req.body.content);
      res.json(skill);
    } catch (err) {
      res.status(400).json({ code: 'SKILLS_ERROR', message: (err as Error).message });
    }
  });

  // DELETE /api/skills/:name - Delete a skill
  router.delete('/:name', (req, res) => {
    try {
      const deleted = skillsService.delete(req.params.name);
      if (!deleted) {
        res.status(404).json({ code: 'NOT_FOUND', message: `Skill "${req.params.name}" not found` });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ code: 'SKILLS_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
