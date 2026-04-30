import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PersistedExecution {
  id: string;
  planId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  currentStep: number;
  totalSteps: number;
  startedAt: string;
  completedAt?: string;
  logs: string[];
  sessionId?: string;
  workspacePath?: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const EXECUTIONS_FILE = path.join(CONFIG_DIR, 'executions.json');
const MAX_EXECUTIONS = 50;

export class ExecutionStoreService {
  private storeFile: string;

  constructor(storeFile?: string) {
    this.storeFile = storeFile ?? EXECUTIONS_FILE;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storeFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): PersistedExecution[] {
    if (!fs.existsSync(this.storeFile)) return [];
    try {
      const raw = fs.readFileSync(this.storeFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(executions: PersistedExecution[]): void {
    this.ensureDir();
    const trimmed = executions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, MAX_EXECUTIONS);
    fs.writeFileSync(this.storeFile, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  list(): PersistedExecution[] {
    return this.load().sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  get(id: string): PersistedExecution | undefined {
    return this.load().find(e => e.id === id);
  }

  upsert(execution: Omit<PersistedExecution, never>): PersistedExecution {
    const executions = this.load();
    const idx = executions.findIndex(e => e.id === execution.id);
    if (idx >= 0) {
      executions[idx] = execution;
    } else {
      executions.push(execution);
    }
    this.save(executions);
    return execution;
  }

  delete(id: string): boolean {
    const executions = this.load();
    const idx = executions.findIndex(e => e.id === id);
    if (idx < 0) return false;
    executions.splice(idx, 1);
    this.save(executions);
    return true;
  }
}
