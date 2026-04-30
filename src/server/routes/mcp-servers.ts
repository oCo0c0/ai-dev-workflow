import { Router } from 'express';
import { MCPConfigService } from '../services/mcp-config-service.js';
import { validateBody } from '../middleware/validation.js';

export function createMCPServersRoutes(mcpConfigService: MCPConfigService): Router {
  const router = Router();

  // GET /api/mcp-servers - List all MCP servers
  router.get('/', (_req, res) => {
    try {
      const servers = mcpConfigService.list();
      res.json(servers);
    } catch (err) {
      res.status(500).json({ code: 'MCP_CONFIG_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/mcp-servers - Add a new MCP server
  router.post('/', validateBody([
    { field: 'name', required: true, type: 'string' },
    { field: 'command', required: true, type: 'string' },
  ]), (req, res) => {
    try {
      const config = {
        name: req.body.name,
        type: req.body.type ?? 'custom',
        command: req.body.command,
        args: req.body.args ?? [],
        env: req.body.env ?? {},
        enabled: req.body.enabled ?? true,
      };
      const server = mcpConfigService.add(config);
      res.status(201).json(server);
    } catch (err) {
      res.status(400).json({ code: 'MCP_CONFIG_ERROR', message: (err as Error).message });
    }
  });

  // PUT /api/mcp-servers/:name - Update an MCP server
  router.put('/:name', (req, res) => {
    try {
      const server = mcpConfigService.update(req.params.name, req.body);
      res.json(server);
    } catch (err) {
      res.status(400).json({ code: 'MCP_CONFIG_ERROR', message: (err as Error).message });
    }
  });

  // DELETE /api/mcp-servers/:name - Delete an MCP server
  router.delete('/:name', (req, res) => {
    try {
      const deleted = mcpConfigService.delete(req.params.name);
      if (!deleted) {
        res.status(404).json({ code: 'NOT_FOUND', message: `MCP Server "${req.params.name}" not found` });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ code: 'MCP_CONFIG_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/mcp-servers/:name/test - Test MCP server connection
  router.post('/:name/test', async (req, res) => {
    try {
      const result = await mcpConfigService.testConnection(req.params.name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ code: 'MCP_CONFIG_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
