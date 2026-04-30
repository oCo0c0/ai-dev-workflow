import fs from 'fs';
import path from 'path';
import os from 'os';

export interface StoredRequirement {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  updatedAt: string;
  description: string;
  acceptanceCriteria: string[];
  attachments: { name: string; url: string; type: string }[];
  relatedIssues: { id: string; title: string; status: string }[];
  savedAt: string;       // when it was saved to local store
  source: string;        // which MCP server it came from
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const STORE_FILE = path.join(CONFIG_DIR, 'requirements.json');

export class RequirementStoreService {
  private storeFile: string;

  constructor(storeFile?: string) {
    this.storeFile = storeFile ?? STORE_FILE;
  }

  private ensureDir(): void {
    const dir = path.dirname(this.storeFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private load(): StoredRequirement[] {
    if (!fs.existsSync(this.storeFile)) return [];
    try {
      const raw = fs.readFileSync(this.storeFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(items: StoredRequirement[]): void {
    this.ensureDir();
    fs.writeFileSync(this.storeFile, JSON.stringify(items, null, 2), 'utf-8');
  }

  list(): StoredRequirement[] {
    return this.load().sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  }

  get(id: string): StoredRequirement | undefined {
    return this.load().find(r => r.id === id);
  }

  upsert(req: Omit<StoredRequirement, 'savedAt'> & { savedAt?: string }): StoredRequirement {
    const items = this.load();
    const existing = items.findIndex(r => r.id === req.id);
    const stored: StoredRequirement = {
      ...req,
      savedAt: req.savedAt ?? new Date().toISOString(),
    };
    if (existing >= 0) {
      items[existing] = stored;
    } else {
      items.push(stored);
    }
    this.save(items);
    return stored;
  }

  delete(id: string): boolean {
    const items = this.load();
    const idx = items.findIndex(r => r.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    this.save(items);
    return true;
  }
}
