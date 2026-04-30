import { Router } from 'express';
import crypto from 'crypto';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { MCPBridgeService } from '../services/mcp-bridge-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { validateBody } from '../middleware/validation.js';
import { broadcast } from '../websocket.js';
import { PlanStoreService, type PersistedPlan } from '../services/plan-store-service.js';
import { getPhaseSkills } from '../utils/skill-utils.js';

// Re-export for backward compatibility with execution routes
export type StoredPlan = PersistedPlan;

// In-memory cache for fast access (backed by file store)
const planCache = new Map<string, PersistedPlan>();

export function getPlanStore(): Map<string, PersistedPlan> {
  return planCache;
}

export function createPlanRoutes(
  cliRunnerService: CLIRunnerService,
  mcpBridgeService: MCPBridgeService,
  pipelineService?: PipelineService
): Router {
  const planStore = new PlanStoreService();
  const router = Router();

  // POST /api/plan/generate - Generate a development plan
  router.post('/generate', validateBody([
    { field: 'requirementId', required: true, type: 'string' },
    { field: 'workspacePath', required: true, type: 'string' },
  ]), async (req, res) => {
    const { requirementId, workspacePath, pipelineId } = req.body;
    const taskId = crypto.randomUUID();

    // Resolve plan skills from pipeline config
    let planSkills: string[] | 'all' | undefined;
    if (pipelineId && pipelineService) {
      const pipeline = pipelineService.get(pipelineId);
      if (pipeline?.steps) {
        planSkills = getPhaseSkills(pipeline.steps, 'plan');
      }
    }

    const plan: PersistedPlan = {
      id: taskId,
      requirementId,
      workspacePath,
      status: 'generating',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pipelineId,  // Store for later phases
    };

    planStore.upsert(plan);
    planCache.set(taskId, plan);

    res.json({ taskId });

    // Generate plan asynchronously
    try {
      const detail = await mcpBridgeService.fetchRequirementDetail(requirementId);
      let accumulatedOutput = '';

      const result = await cliRunnerService.runBridge(
        {
          prompt: `Analyze the following requirement and generate a structured development plan.\n\n## Requirement\n${detail.title}\n\n${detail.description}\n\n## Instructions\nGenerate a development plan. Respond in the same language as the requirement.`,
          cwd: workspacePath,
          maxTurns: 20,
          skills: planSkills,  // Pass plan-phase skills
        },
        {
          workspacePath,
          onOutput: (data) => {
            accumulatedOutput += data;
            plan.rawOutput = accumulatedOutput;
            broadcast({ type: 'plan:progress', data: { taskId, content: data } });
          },
        }
      );

      plan.status = result.exitCode === 0 ? 'ready' : 'failed';
      plan.rawOutput = accumulatedOutput;
      plan.summary = accumulatedOutput.substring(0, 500);
      plan.updatedAt = new Date().toISOString();
      if (result.sessionId) plan.sessionId = result.sessionId;
      if (result.exitCode !== 0) plan.error = result.stderr || 'Plan generation failed';

      planStore.upsert(plan);
      planCache.set(taskId, plan);
      broadcast({ type: 'plan:complete', data: { taskId, status: plan.status } });
    } catch (err) {
      plan.status = 'failed';
      plan.error = (err as Error).message;
      plan.updatedAt = new Date().toISOString();
      planStore.upsert(plan);
      planCache.set(taskId, plan);
      broadcast({ type: 'error', data: { message: `Plan generation failed: ${plan.error}` } });
    }
  });

  // GET /api/plan/list - List recent plans
  router.get('/list', (_req, res) => {
    try {
      const plans = planStore.list().map(p => ({
        id: p.id,
        requirementId: p.requirementId,
        workspacePath: p.workspacePath,
        status: p.status,
        summary: p.summary?.substring(0, 200),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
      res.json(plans);
    } catch (err) {
      res.status(500).json({ code: 'STORE_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/plan/:taskId - Get plan status/result
  router.get('/:taskId', (req, res) => {
    // Check cache first, then file store
    let plan = planCache.get(req.params.taskId);
    if (!plan) {
      plan = planStore.get(req.params.taskId);
      if (plan) planCache.set(plan.id, plan); // warm cache
    }
    if (!plan) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
      return;
    }
    res.json(plan);
  });

  // PUT /api/plan/:taskId - Update plan
  router.put('/:taskId', (req, res) => {
    let plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
    if (!plan) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
      return;
    }

    if (req.body.summary !== undefined) plan.summary = req.body.summary;
    if (req.body.rawOutput !== undefined) plan.rawOutput = req.body.rawOutput;
    plan.updatedAt = new Date().toISOString();

    planStore.upsert(plan);
    planCache.set(plan.id, plan);
    res.json(plan);
  });

  // DELETE /api/plan/:taskId - Delete a plan
  router.delete('/:taskId', (req, res) => {
    const deleted = planStore.delete(req.params.taskId);
    planCache.delete(req.params.taskId);
    res.json({ success: deleted });
  });

  // POST /api/plan/:taskId/reply - Send a reply to Claude during plan generation
  router.post('/:taskId/reply', async (req, res) => {
    let plan = planCache.get(req.params.taskId) ?? planStore.get(req.params.taskId);
    if (!plan) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
      return;
    }

    const { message } = req.body as { message: string };
    if (!message?.trim()) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
      return;
    }

    if (!plan.sessionId) {
      res.status(400).json({ code: 'INVALID_STATE', message: 'No active session to reply to' });
      return;
    }

    res.json({ ok: true });

    plan.status = 'generating';
    plan.updatedAt = new Date().toISOString();
    planStore.upsert(plan);
    planCache.set(plan.id, plan);
    broadcast({ type: 'plan:progress', data: { taskId: plan.id, content: `\n\n**User:** ${message}\n\n` } });

    try {
      const result = await cliRunnerService.runBridge(
        {
          prompt: message,
          cwd: plan.workspacePath,
          sessionId: plan.sessionId,
          maxTurns: 20,
        },
        {
          workspacePath: plan.workspacePath,
          onOutput: (data) => {
            plan!.rawOutput = (plan!.rawOutput || '') + data;
            broadcast({ type: 'plan:progress', data: { taskId: plan!.id, content: data } });
          },
        }
      );

      plan.status = result.exitCode === 0 ? 'ready' : 'failed';
      plan.updatedAt = new Date().toISOString();
      if (result.sessionId) plan.sessionId = result.sessionId;
      if (result.exitCode !== 0) plan.error = result.stderr || 'Reply failed';

      planStore.upsert(plan);
      planCache.set(plan.id, plan);
      broadcast({ type: 'plan:complete', data: { taskId: plan.id, status: plan.status } });
    } catch (err) {
      plan.status = 'failed';
      plan.error = (err as Error).message;
      plan.updatedAt = new Date().toISOString();
      planStore.upsert(plan);
      planCache.set(plan.id, plan);
      broadcast({ type: 'error', data: { message: `Reply failed: ${plan.error}` } });
    }
  });

  return router;
}
