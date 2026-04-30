import { Router } from 'express';
import crypto from 'crypto';
import { CLIRunnerService } from '../services/cli-runner-service.js';
import { PipelineService } from '../services/pipeline-service.js';
import { TestExecutorService } from '../services/test-executor-service.js';
import { validateBody } from '../middleware/validation.js';
import { broadcast } from '../websocket.js';
import { getPlanStore } from './plan.js';
import { getPhaseSkills } from '../utils/skill-utils.js';
import { ExecutionStoreService, type PersistedExecution } from '../services/execution-store-service.js';
import { TestStoreService, type PersistedTestRun } from '../services/test-store-service.js';
import type { StoredPlan } from './plan.js';

// === In-memory execution store (active executions) ===

export interface StoredExecution {
  id: string;
  planId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  currentStep: number;
  totalSteps: number;
  startedAt: string;
  completedAt?: string;
  logs: string[];
  sessionId?: string;  // Claude session ID for multi-turn
  workspacePath?: string;
  abortController?: AbortController;
}

const executionStore = new Map<string, StoredExecution>();

export function getExecutionStore(): Map<string, StoredExecution> {
  return executionStore;
}

// Helper: convert in-memory execution to persisted format
function toPersisted(exec: StoredExecution): PersistedExecution {
  return {
    id: exec.id,
    planId: exec.planId,
    status: exec.status,
    currentStep: exec.currentStep,
    totalSteps: exec.totalSteps,
    startedAt: exec.startedAt,
    completedAt: exec.completedAt,
    logs: exec.logs,
    sessionId: exec.sessionId,
    workspacePath: exec.workspacePath,
  };
}

export function createExecutionRoutes(
  cliRunnerService: CLIRunnerService,
  pipelineService?: PipelineService,
  testExecutorService?: TestExecutorService
): Router {
  const persistStore = new ExecutionStoreService();
  const testPersistStore = new TestStoreService();
  const router = Router();

  // GET /api/execution/list - List recent executions
  router.get('/list', (_req, res) => {
    try {
      const executions = persistStore.list().map(e => ({
        id: e.id,
        planId: e.planId,
        status: e.status,
        currentStep: e.currentStep,
        totalSteps: e.totalSteps,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        workspacePath: e.workspacePath,
        logCount: e.logs.length,
      }));
      res.json(executions);
    } catch (err) {
      res.status(500).json({ code: 'STORE_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/execution/start - Start execution
  router.post('/start', validateBody([
    { field: 'planId', required: true, type: 'string' },
  ]), async (req, res) => {
    const { planId } = req.body;
    const plan = getPlanStore().get(planId);

    if (!plan) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Plan not found' });
      return;
    }

    // Allow execution if plan is ready or generating (in case of timing issues)
    if (plan.status === 'failed') {
      res.status(400).json({ code: 'INVALID_STATE', message: 'Plan generation failed, cannot execute' });
      return;
    }

    const executionId = crypto.randomUUID();
    const abortController = new AbortController();

    // Resolve execution skills from pipeline config
    let executionSkills: string[] | 'all' | undefined;
    if (plan.pipelineId && pipelineService) {
      const pipeline = pipelineService.get(plan.pipelineId);
      if (pipeline?.steps) {
        executionSkills = getPhaseSkills(pipeline.steps, 'execution');
      }
    }

    const execution: StoredExecution = {
      id: executionId,
      planId,
      status: 'running',
      currentStep: 0,
      totalSteps: 1,
      startedAt: new Date().toISOString(),
      logs: [],
      sessionId: plan.sessionId,
      workspacePath: plan.workspacePath,
      abortController,
    };
    executionStore.set(executionId, execution);
    persistStore.upsert(toPersisted(execution));

    res.json({ executionId });

    // Execute asynchronously
    try {
      const result = await cliRunnerService.runBridge(
        {
          prompt: plan.rawOutput ?? plan.summary ?? '',
          cwd: plan.workspacePath,
          sessionId: plan.sessionId,
          maxTurns: 50,
          skills: executionSkills,  // Pass execution-phase skills
        },
        {
          workspacePath: plan.workspacePath,
          onOutput: (data) => {
            execution.logs.push(data);
            broadcast({ type: 'execution:output', data: { executionId, stepIndex: execution.currentStep, content: data } });
          },
          signal: abortController.signal,
        }
      );

      if (result.sessionId) execution.sessionId = result.sessionId;

      if (result.aborted) {
        execution.status = 'aborted';
      } else if (result.exitCode === 0) {
        execution.status = 'completed';
      } else {
        execution.status = 'failed';
      }
      execution.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(execution));
      broadcast({ type: 'execution:complete', data: { executionId, status: execution.status } });

      // Auto-trigger test phase if configured
      if (execution.status === 'completed' && plan.pipelineId && pipelineService && testExecutorService) {
        triggerTestPhase(execution, plan, pipelineService, cliRunnerService, testExecutorService, testPersistStore);
      }
    } catch (err) {
      execution.status = 'failed';
      execution.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(execution));
      broadcast({ type: 'error', data: { message: `Execution failed: ${(err as Error).message}` } });
    }
  });

  // POST /api/execution/:id/pause - Pause execution
  router.post('/:id/pause', (req, res) => {
    const execution = executionStore.get(req.params.id);
    if (!execution) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }
    if (execution.status !== 'running') {
      res.status(400).json({ code: 'INVALID_STATE', message: 'Execution is not running' });
      return;
    }
    execution.status = 'paused';
    execution.abortController?.abort();
    persistStore.upsert(toPersisted(execution));
    res.json({ status: 'paused' });
  });

  // POST /api/execution/:id/retry-step - Retry current step
  router.post('/:id/retry-step', (req, res) => {
    const execution = executionStore.get(req.params.id);
    if (!execution) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }
    if (execution.status !== 'paused' && execution.status !== 'failed') {
      res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to retry' });
      return;
    }
    execution.status = 'running';
    persistStore.upsert(toPersisted(execution));
    res.json({ status: 'retrying' });
  });

  // POST /api/execution/:id/skip-step - Skip current step
  router.post('/:id/skip-step', (req, res) => {
    const execution = executionStore.get(req.params.id);
    if (!execution) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }
    if (execution.status !== 'paused' && execution.status !== 'failed') {
      res.status(400).json({ code: 'INVALID_STATE', message: 'Execution must be paused or failed to skip' });
      return;
    }
    execution.currentStep += 1;
    execution.status = 'running';
    persistStore.upsert(toPersisted(execution));
    res.json({ status: 'skipped' });
  });

  // POST /api/execution/:id/abort - Abort execution
  router.post('/:id/abort', (req, res) => {
    const execution = executionStore.get(req.params.id);
    if (!execution) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }
    execution.status = 'aborted';
    execution.completedAt = new Date().toISOString();
    execution.abortController?.abort();
    persistStore.upsert(toPersisted(execution));
    res.json({ status: 'aborted' });
  });

  // GET /api/execution/:id/status - Get execution status and logs
  router.get('/:id/status', (req, res) => {
    // Check in-memory first (active execution with latest state)
    const active = executionStore.get(req.params.id);
    if (active) {
      res.json({
        id: active.id,
        planId: active.planId,
        status: active.status,
        currentStep: active.currentStep,
        totalSteps: active.totalSteps,
        startedAt: active.startedAt,
        completedAt: active.completedAt,
        logs: active.logs,
      });
      return;
    }

    // Fall back to persisted store
    const persisted = persistStore.get(req.params.id);
    if (!persisted) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }
    res.json(persisted);
  });

  // DELETE /api/execution/:id - Delete execution record
  router.delete('/:id', (req, res) => {
    executionStore.delete(req.params.id);
    const deleted = persistStore.delete(req.params.id);
    res.json({ success: deleted });
  });

  // POST /api/execution/:id/reply - Send a reply to Claude during execution
  router.post('/:id/reply', async (req, res) => {
    const execution = executionStore.get(req.params.id);
    if (!execution) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Execution not found' });
      return;
    }

    const { message } = req.body as { message: string };
    if (!message?.trim()) {
      res.status(400).json({ code: 'VALIDATION_ERROR', message: 'message is required' });
      return;
    }

    if (!execution.sessionId) {
      res.status(400).json({ code: 'INVALID_STATE', message: 'No active session to reply to' });
      return;
    }

    res.json({ ok: true });

    execution.status = 'running';
    execution.logs.push(`\n**User:** ${message}\n`);
    broadcast({ type: 'execution:output', data: { executionId: execution.id, stepIndex: execution.currentStep, content: `\n**User:** ${message}\n` } });

    try {
      const result = await cliRunnerService.runBridge(
        {
          prompt: message,
          cwd: execution.workspacePath || process.cwd(),
          sessionId: execution.sessionId,
          maxTurns: 50,
        },
        {
          workspacePath: execution.workspacePath || process.cwd(),
          onOutput: (data) => {
            execution.logs.push(data);
            broadcast({ type: 'execution:output', data: { executionId: execution.id, stepIndex: execution.currentStep, content: data } });
          },
          signal: execution.abortController?.signal,
        }
      );

      if (result.sessionId) execution.sessionId = result.sessionId;

      if (result.aborted) {
        execution.status = 'aborted';
      } else if (result.exitCode === 0) {
        execution.status = 'completed';
      } else {
        execution.status = 'failed';
      }
      execution.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(execution));
      broadcast({ type: 'execution:complete', data: { executionId: execution.id, status: execution.status } });
    } catch (err) {
      execution.status = 'failed';
      execution.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(execution));
      broadcast({ type: 'error', data: { message: `Execution reply failed: ${(err as Error).message}` } });
    }
  });

  return router;
}

// === Auto-trigger test phase after execution completes ===

function triggerTestPhase(
  execution: StoredExecution,
  plan: StoredPlan,
  pipelineService: PipelineService,
  cliRunnerService: CLIRunnerService,
  testExecutorService: TestExecutorService,
  testPersistStore: TestStoreService
): void {
  const pipeline = pipelineService.get(plan.pipelineId!);
  if (!pipeline?.steps) return;

  const testStrategy = pipeline.steps.testStrategy;
  if (!testStrategy.autoRunAfterExecution) return;

  const testRunId = crypto.randomUUID();
  const testSkills = getPhaseSkills(pipeline.steps, 'test');

  if (testStrategy.mode === 'run_existing') {
    // Run existing tests using TestExecutorService
    const testRun: PersistedTestRun = {
      id: testRunId,
      status: 'running',
      mode: 'pipeline_run_existing',
      framework: testStrategy.framework,
      workspacePath: plan.workspacePath,
      executionId: execution.id,
      planId: plan.id,
      pipelineId: plan.pipelineId,
      startedAt: new Date().toISOString(),
    };
    testPersistStore.upsert(testRun);
    broadcast({ type: 'test:auto_start', data: { testRunId, executionId: execution.id, mode: 'run_existing' } });

    testExecutorService.runTests(
      {
        workspacePath: plan.workspacePath,
        framework: testStrategy.framework || '',
        command: testStrategy.command,
      },
      {
        onOutput: (data) => {
          testRun.rawOutput = (testRun.rawOutput || '') + data;
          broadcast({ type: 'test:output', data: { taskId: testRunId, content: data } });
        },
      }
    ).then((results) => {
      testRun.status = 'completed';
      testRun.results = results;
      testRun.completedAt = new Date().toISOString();
      testPersistStore.upsert(testRun);
      broadcast({ type: 'test:complete', data: { taskId: testRunId, results, status: 'completed' } });
    }).catch((err) => {
      testRun.status = 'failed';
      testRun.error = (err as Error).message;
      testRun.completedAt = new Date().toISOString();
      testPersistStore.upsert(testRun);
      broadcast({ type: 'error', data: { message: `Auto test run failed: ${testRun.error}` } });
    });

  } else {
    // AI generate tests using CLIRunnerService
    const testRun: PersistedTestRun = {
      id: testRunId,
      status: 'running',
      mode: 'pipeline_ai_generate',
      workspacePath: plan.workspacePath,
      executionId: execution.id,
      planId: plan.id,
      pipelineId: plan.pipelineId,
      startedAt: new Date().toISOString(),
    };
    testPersistStore.upsert(testRun);
    broadcast({ type: 'test:auto_start', data: { testRunId, executionId: execution.id, mode: 'ai_generate' } });

    const prompt = `The execution has been completed. Now analyze the changes made and write appropriate tests.\n\n## Context\n- Workspace: ${plan.workspacePath}\n- Plan summary: ${plan.summary || 'See previous context'}\n\n## Instructions\n1. Review the code changes that were just made\n2. Write appropriate unit and/or integration tests\n3. Run the tests and report results\n4. If tests fail, fix the issues and re-run\n\nRespond in the same language as the project.`;

    let accumulatedOutput = '';
    cliRunnerService.runBridge(
      {
        prompt,
        cwd: plan.workspacePath,
        sessionId: execution.sessionId,
        maxTurns: 30,
        skills: testSkills,
      },
      {
        workspacePath: plan.workspacePath,
        onOutput: (data) => {
          accumulatedOutput += data;
          testRun.rawOutput = accumulatedOutput;
          broadcast({ type: 'test:output', data: { taskId: testRunId, content: data } });
        },
      }
    ).then((result) => {
      testRun.status = result.exitCode === 0 ? 'completed' : 'failed';
      testRun.rawOutput = accumulatedOutput;
      testRun.completedAt = new Date().toISOString();
      if (result.exitCode !== 0) testRun.error = 'AI test generation failed';
      testPersistStore.upsert(testRun);
      broadcast({ type: 'test:complete', data: { taskId: testRunId, status: testRun.status, rawOutput: accumulatedOutput } });
    }).catch((err) => {
      testRun.status = 'failed';
      testRun.error = (err as Error).message;
      testRun.completedAt = new Date().toISOString();
      testPersistStore.upsert(testRun);
      broadcast({ type: 'error', data: { message: `AI test generation failed: ${testRun.error}` } });
    });
  }
}
