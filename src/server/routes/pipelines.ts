import { Router } from 'express';
import { PipelineService } from '../services/pipeline-service.js';
import { MCPConfigService } from '../services/mcp-config-service.js';
import { validateBody } from '../middleware/validation.js';

export function createPipelineRoutes(
  pipelineService: PipelineService,
  mcpConfigService: MCPConfigService
): Router {
  const router = Router();

  // GET /api/pipelines - List all pipelines
  router.get('/', (_req, res) => {
    try {
      const pipelines = pipelineService.list();
      res.json(pipelines);
    } catch (err) {
      res.status(500).json({ code: 'PIPELINE_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/pipelines - Create a new pipeline
  router.post('/', validateBody([
    { field: 'name', required: true, type: 'string' },
    { field: 'steps', required: true, type: 'object' },
  ]), (req, res) => {
    try {
      const pipeline = pipelineService.create(req.body);
      res.status(201).json(pipeline);
    } catch (err) {
      res.status(400).json({ code: 'PIPELINE_ERROR', message: (err as Error).message });
    }
  });

  // PUT /api/pipelines/:id - Update a pipeline
  router.put('/:id', (req, res) => {
    try {
      const pipeline = pipelineService.update(req.params.id, req.body);
      res.json(pipeline);
    } catch (err) {
      res.status(400).json({ code: 'PIPELINE_ERROR', message: (err as Error).message });
    }
  });

  // DELETE /api/pipelines/:id - Delete a pipeline
  router.delete('/:id', (req, res) => {
    try {
      const deleted = pipelineService.delete(req.params.id);
      if (!deleted) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Pipeline not found' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ code: 'PIPELINE_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/pipelines/:id/set-default - Set pipeline as default
  router.post('/:id/set-default', (req, res) => {
    try {
      pipelineService.setDefault(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ code: 'PIPELINE_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
