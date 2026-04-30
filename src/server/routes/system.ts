import { Router } from 'express';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { MCPConfigService } from '../services/mcp-config-service.js';

export function createSystemRoutes(
  cliRunnerService: CLIRunnerService,
  mcpConfigService: MCPConfigService
): Router {
  const router = Router();

  // GET /api/system/status - System status check
  router.get('/status', async (_req, res) => {
    try {
      const cliInfo = await cliRunnerService.checkAvailability();
      const mcpServers = mcpConfigService.list().map(s => ({
        name: s.name,
        status: s.status ?? 'disconnected',
      }));

      res.json({
        claudeCodeAvailable: cliInfo.available,
        claudeCodeVersion: cliInfo.version,
        mcpServers,
        configPath: mcpConfigService.getSettingsFile(),
        uptime: process.uptime(),
      });
    } catch (err) {
      res.status(500).json({ code: 'SYSTEM_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
