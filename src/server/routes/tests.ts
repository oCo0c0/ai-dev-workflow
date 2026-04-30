import { Router } from 'express';
import crypto from 'crypto';
import { TestExecutorService, TestResults } from '../services/test-executor-service.js';
import { TestStoreService, type PersistedTestRun } from '../services/test-store-service.js';
import { validateBody } from '../middleware/validation.js';
import { broadcast } from '../websocket.js';

// === In-memory store for active runs ===

interface ActiveTestRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: 'manual' | 'pipeline_run_existing' | 'pipeline_ai_generate';
  framework?: string;
  workspacePath: string;
  results?: TestResults;
  rawOutput?: string;
  error?: string;
  executionId?: string;
  planId?: string;
  pipelineId?: string;
  startedAt: string;
  completedAt?: string;
  abortController?: AbortController;
}

const activeRuns = new Map<string, ActiveTestRun>();

export function createTestRoutes(testExecutorService: TestExecutorService): Router {
  const persistStore = new TestStoreService();
  const router = Router();

  // Helper: convert active run to persisted format
  function toPersisted(run: ActiveTestRun): PersistedTestRun {
    const { abortController, ...rest } = run;
    return rest;
  }

  // GET /api/tests/list - List recent test runs
  router.get('/list', (_req, res) => {
    try {
      const runs = persistStore.list().map(r => ({
        id: r.id,
        status: r.status,
        mode: r.mode,
        framework: r.framework,
        workspacePath: r.workspacePath,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        executionId: r.executionId,
        pipelineId: r.pipelineId,
        // Summary numbers
        totalTests: r.results?.totalTests,
        passed: r.results?.passed,
        failed: r.results?.failed,
        skipped: r.results?.skipped,
      }));
      res.json(runs);
    } catch (err) {
      res.status(500).json({ code: 'STORE_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/tests/detect - Detect test frameworks
  router.get('/detect', (req, res) => {
    try {
      const workspacePath = req.query.workspacePath as string;
      if (!workspacePath || workspacePath.trim() === '') {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'Query parameter "workspacePath" is required' });
        return;
      }
      const frameworks = testExecutorService.detectFrameworks(workspacePath);
      res.json(frameworks);
    } catch (err) {
      res.status(500).json({ code: 'TEST_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/tests/run - Run existing tests
  router.post('/run', validateBody([
    { field: 'workspacePath', required: true, type: 'string' },
  ]), async (req, res) => {
    const { framework, command, workspacePath, mode, executionId, planId, pipelineId } = req.body;
    const taskId = crypto.randomUUID();

    const run: ActiveTestRun = {
      id: taskId,
      status: 'running',
      mode: mode || 'manual',
      framework,
      workspacePath,
      startedAt: new Date().toISOString(),
      executionId,
      planId,
      pipelineId,
    };
    activeRuns.set(taskId, run);
    persistStore.upsert(toPersisted(run));

    res.json({ taskId });

    // Run tests asynchronously
    try {
      const results = await testExecutorService.runTests(
        { workspacePath, framework, command },
        {
          onOutput: (data) => {
            run.rawOutput = (run.rawOutput || '') + data;
            broadcast({ type: 'test:output', data: { taskId, content: data } });
          },
        }
      );

      run.status = 'completed';
      run.results = results;
      run.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(run));
      broadcast({ type: 'test:complete', data: { taskId, results, status: 'completed' } });
    } catch (err) {
      run.status = 'failed';
      run.error = (err as Error).message;
      run.completedAt = new Date().toISOString();
      persistStore.upsert(toPersisted(run));
      broadcast({ type: 'error', data: { message: `Test run failed: ${run.error}` } });
    } finally {
      activeRuns.delete(taskId);
    }
  });

  // GET /api/tests/results/:taskId - Get test results
  router.get('/results/:taskId', (req, res) => {
    // Check active first
    const active = activeRuns.get(req.params.taskId);
    if (active) {
      const { abortController, ...rest } = active;
      res.json(rest);
      return;
    }

    // Fall back to persisted
    const persisted = persistStore.get(req.params.taskId);
    if (!persisted) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Test run not found' });
      return;
    }
    res.json(persisted);
  });

  // DELETE /api/tests/:id - Delete test run
  router.delete('/:id', (req, res) => {
    activeRuns.delete(req.params.id);
    const deleted = persistStore.delete(req.params.id);
    res.json({ success: deleted });
  });

  return router;
}
