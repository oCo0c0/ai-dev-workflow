import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { setupWebSocket } from './websocket.js';
import { requestLogger } from './middleware/logger.js';
import { errorHandler } from './middleware/validation.js';

// Services
import { MCPConfigService } from './services/mcp-config-service.js';
import { MCPBridgeService } from './services/mcp-bridge-service.js';
import { WorkspaceService } from './services/workspace-service.js';
import { CLIRunnerService } from './services/cli-runner-service.js';
import { TestExecutorService } from './services/test-executor-service.js';
import { SkillsService } from './services/skills-service.js';
import { PipelineService } from './services/pipeline-service.js';
import { ConfigService } from './services/config-service.js';
import { RequirementStoreService } from './services/requirement-store-service.js';

// Routes
import { createRequirementsRoutes } from './routes/requirements.js';
import { createWorkspaceRoutes } from './routes/workspace.js';
import { createPlanRoutes } from './routes/plan.js';
import { createExecutionRoutes } from './routes/execution.js';
import { createTestRoutes } from './routes/tests.js';
import { createSkillsRoutes } from './routes/skills.js';
import { createMCPServersRoutes } from './routes/mcp-servers.js';
import { createPipelineRoutes } from './routes/pipelines.js';
import { createSystemRoutes } from './routes/system.js';

export async function createServer(port: number): Promise<http.Server> {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  // Instantiate services
  const configService = new ConfigService();
  const mcpConfigService = new MCPConfigService();
  const mcpBridgeService = new MCPBridgeService(mcpConfigService);
  const workspaceService = new WorkspaceService();
  const cliRunnerService = new CLIRunnerService(workspaceService);
  const testExecutorService = new TestExecutorService();
  const skillsService = new SkillsService();
  const pipelineService = new PipelineService();
  const requirementStore = new RequirementStoreService();

  // Register API routes
  app.use('/api/requirements', createRequirementsRoutes(mcpBridgeService, requirementStore));
  app.use('/api/workspace', createWorkspaceRoutes(workspaceService));
  app.use('/api/plan', createPlanRoutes(cliRunnerService, mcpBridgeService, pipelineService));
  app.use('/api/execution', createExecutionRoutes(cliRunnerService, pipelineService, testExecutorService));
  app.use('/api/tests', createTestRoutes(testExecutorService));
  app.use('/api/skills', createSkillsRoutes(skillsService));
  app.use('/api/mcp-servers', createMCPServersRoutes(mcpConfigService));
  app.use('/api/pipelines', createPipelineRoutes(pipelineService, mcpConfigService));
  app.use('/api/system', createSystemRoutes(cliRunnerService, mcpConfigService));

  // Static file serving (production mode)
  // After compilation: __dirname = dist/server/server/, client is at dist/client/
  const clientDistPath = path.resolve(__dirname, '../../client');
  app.use(express.static(clientDistPath));

  // SPA fallback
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ws')) {
      res.sendFile(path.join(clientDistPath, 'index.html'));
    }
  });

  // Error handler (must be last)
  app.use(errorHandler);

  // Create HTTP server
  const server = http.createServer(app);

  // Setup WebSocket
  setupWebSocket(server);

  // Start listening
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      resolve(server);
    });
  });
}
