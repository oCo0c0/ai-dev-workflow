import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PersistedPlan {
  id: string;
  requirementId: string;
  workspacePath: string;
  status: 'generating' | 'ready' | 'failed' | 'waiting_input';
  summary?: string;
  rawOutput?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  sessionId?: string;
  pipelineId?: string;  // Which pipeline triggered this plan
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const PLANS_FILE = path.join(CONFIG_DIR, 'plans.json');
const MAX_PLANS = 50; // Keep last 50 plans

export class PlanStoreService {
  private storeFile: string;

  constructor(storeFile?: string) {
    this.storeFile = storeFile ?? PLANS_FILE;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storeFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): PersistedPlan[] {
    if (!fs.existsSync(this.storeFile)) return [];
    try {
      const raw = fs.readFileSync(this.storeFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(plans: PersistedPlan[]): void {
    this.ensureDir();
    // Keep only the most recent MAX_PLANS
    const trimmed = plans
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, MAX_PLANS);
    fs.writeFileSync(this.storeFile, JSON.stringify(trimmed, null, 2), 'utf-8');
  }

  list(): PersistedPlan[] {
    return this.load().sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  get(id: string): PersistedPlan | undefined {
    return this.load().find(p => p.id === id);
  }

  upsert(plan: Omit<PersistedPlan, 'updatedAt'> & { updatedAt?: string }): PersistedPlan {
    const plans = this.load();
    const idx = plans.findIndex(p => p.id === plan.id);
    const updated: PersistedPlan = {
      ...plan,
      updatedAt: plan.updatedAt ?? new Date().toISOString(),
    };
    if (idx >= 0) {
      plans[idx] = updated;
    } else {
      plans.push(updated);
    }
    this.save(plans);
    return updated;
  }

  delete(id: string): boolean {
    const plans = this.load();
    const idx = plans.findIndex(p => p.id === id);
    if (idx < 0) return false;
    plans.splice(idx, 1);
    this.save(plans);
    return true;
  }
}
