import { Router } from 'express';
import { MCPBridgeService } from '../services/mcp-bridge-service.js';
import { RequirementStoreService } from '../services/requirement-store-service.js';

export function createRequirementsRoutes(
  mcpBridgeService: MCPBridgeService,
  requirementStore: RequirementStoreService
): Router {
  const router = Router();

  // ─── Local Store (saved requirements) ───────────────────────────────────────

  // GET /api/requirements/saved - List locally saved requirements
  router.get('/saved', (_req, res) => {
    try {
      res.json(requirementStore.list());
    } catch (err) {
      res.status(500).json({ code: 'STORE_ERROR', message: (err as Error).message });
    }
  });

  // DELETE /api/requirements/saved/:id - Remove a saved requirement
  router.delete('/saved/:id', (req, res) => {
    try {
      const deleted = requirementStore.delete(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ code: 'STORE_ERROR', message: (err as Error).message });
    }
  });

  // ─── MCP Fetch + Auto-save ───────────────────────────────────────────────────

  // POST /api/requirements/fetch - Fetch a requirement by ID or number from MCP and save it
  router.post('/fetch', async (req, res) => {
    try {
      const { id, mcpServerName } = req.body as { id: string; mcpServerName?: string };
      if (!id?.trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Requirement ID is required' });
        return;
      }

      // If a specific MCP server is requested, temporarily switch
      const originalServer = mcpBridgeService.getServerName();
      if (mcpServerName) mcpBridgeService.setServerName(mcpServerName);

      try {
        let resolvedId = id.trim();

        // If input looks like a number or #number, search for the actual ID
        const numberMatch = resolvedId.match(/^#?(\d+)$/);
        if (numberMatch) {
          const number = numberMatch[1];
          const results = await mcpBridgeService.searchRequirements(number);
          if (results.length === 0) {
            res.status(404).json({ code: 'NOT_FOUND', message: `No requirement found with number #${number}` });
            return;
          }
          // Use the first match's ID
          resolvedId = results[0].id;
        }

        const detail = await mcpBridgeService.fetchRequirementDetail(resolvedId);
        const saved = requirementStore.upsert({
          ...detail,
          source: mcpBridgeService.getServerName(),
        });
        res.json(saved);
      } finally {
        if (mcpServerName) mcpBridgeService.setServerName(originalServer);
      }
    } catch (err) {
      res.status(500).json({ code: 'MCP_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/requirements/search?q= - Search via MCP (does NOT auto-save)
  router.get('/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query?.trim()) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Query parameter "q" is required' });
        return;
      }
      const results = await mcpBridgeService.searchRequirements(query);
      res.json(results);
    } catch (err) {
      res.status(500).json({ code: 'MCP_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/requirements/:id - Get requirement detail from MCP (does NOT auto-save)
  router.get('/:id', async (req, res) => {
    try {
      // Check local store first
      const local = requirementStore.get(req.params.id);
      if (local) {
        res.json(local);
        return;
      }
      // Fall back to MCP
      const detail = await mcpBridgeService.fetchRequirementDetail(req.params.id);
      res.json(detail);
    } catch (err) {
      res.status(500).json({ code: 'MCP_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
