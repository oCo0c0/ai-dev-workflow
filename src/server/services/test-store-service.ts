import fs from 'fs';
import path from 'path';
import os from 'os';
import type { TestResults } from './test-executor-service.js';

export interface PersistedTestRun {
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
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const TEST_RUNS_FILE = path.join(CONFIG_DIR, 'test-runs.json');
const MAX_RUNS = 50;

export class TestStoreService {
  private storeFile: string;

  constructor(storeFile?: string) {
    this.storeFile = storeFile ?? TEST_RUNS_FILE;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storeFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): PersistedTestRun[] {
    if (!fs.existsSync(this.storeFile)) return [];
    try {
      const raw = fs.readFileSync(this.storeFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(runs: PersistedTestRun[]): void {
    this.ensureDir();
    const trimmed = runs
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, MAX_RUNS);
    fs.writeFileSync(this.storeFile, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  list(): PersistedTestRun[] {
    return this.load().sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  get(id: string): PersistedTestRun | undefined {
    return this.load().find(r => r.id === id);
  }

  upsert(run: PersistedTestRun): PersistedTestRun {
    const runs = this.load();
    const idx = runs.findIndex(r => r.id === run.id);
    if (idx >= 0) {
      runs[idx] = run;
    } else {
      runs.push(run);
    }
    this.save(runs);
    return run;
  }

  delete(id: string): boolean {
    const runs = this.load();
    const idx = runs.findIndex(r => r.id === id);
    if (idx < 0) return false;
    runs.splice(idx, 1);
    this.save(runs);
    return true;
  }
}
