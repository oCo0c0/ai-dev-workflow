import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

export interface WorkspaceInfo {
  path: string;
  projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
  contextFiles: string[];
  hasClaudeMd: boolean;
  gitStatus: 'clean' | 'dirty' | 'not_git';
}

export interface SavedWorkspace {
  id: string;
  path: string;
  name: string;           // User-defined display name
  projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
  addedAt: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt: string;
  extension?: string;
}

export interface WorkspaceValidationResult {
  valid: boolean;
  error?: string;
}

export interface GitChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?' | '!';
  staged: boolean;
}

export interface GitStatusResult {
  isGit: boolean;
  branch: string;
  changes: GitChange[];
}

export interface GitDiffResult {
  path: string;
  diff: string;
  additions: number;
  deletions: number;
}

/** Map porcelain XY codes to a single status letter. */
function gitStatusCode(x: string, y: string): GitChange['status'] {
  if (x === '?' && y === '?') return '?';
  if (x === '!' && y === '!') return '!';
  if (x === 'D' || y === 'D') return 'D';
  if (x === 'A' || y === 'A') return 'A';
  if (x === 'R' || y === 'R') return 'R';
  return 'M';
}

/** Join staged and unstaged diff outputs, avoiding duplicate headers. */
function joinDiffs(staged: string, unstaged: string): string {
  if (!staged) return unstaged;
  if (!unstaged) return staged;
  return staged + '\n' + unstaged;
}

const CONFIG_DIR = path.join(os.homedir(), '.ai-dev-workbench');
const MAX_HISTORY = 10;

/** Project type detection mapping: filename → project type */
const PROJECT_TYPE_MAP: Record<string, WorkspaceInfo['projectType']> = {
  'package.json': 'node',
  'pom.xml': 'java',
  'Cargo.toml': 'rust',
  'requirements.txt': 'python',
};

/** Context files to scan for in a workspace */
const CONTEXT_FILES = [
  '.claude.md',
  'package.json',
  'pom.xml',
  'Cargo.toml',
  'requirements.txt',
  'tsconfig.json',
  '.gitignore',
  'Makefile',
  'Dockerfile',
];

export class WorkspaceService {
  private configDir: string;
  private historyFile: string;
  private savedWorkspacesFile: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? CONFIG_DIR;
    this.historyFile = path.join(this.configDir, 'workspace-history.json');
    this.savedWorkspacesFile = path.join(this.configDir, 'saved-workspaces.json');
  }

  /**
   * Browse a directory and return its entries.
   */
  browse(dirPath: string): DirectoryEntry[] {
    const resolvedPath = path.resolve(dirPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Directory does not exist: ${resolvedPath}`);
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${resolvedPath}`);
    }

    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
    const result: DirectoryEntry[] = [];

    for (const entry of entries) {
      const entryPath = path.join(resolvedPath, entry.name);
      try {
        const entryStat = fs.statSync(entryPath);
        result.push({
          name: entry.name,
          path: entryPath,
          isDirectory: entry.isDirectory(),
          size: entry.isDirectory() ? undefined : entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat (permission issues, etc.)
      }
    }

    return result;
  }

  /**
   * Validate that a path is a valid workspace (exists, is directory, has read/write permissions).
   */
  validate(workspacePath: string): WorkspaceValidationResult {
    const resolvedPath = path.resolve(workspacePath);

    if (!fs.existsSync(resolvedPath)) {
      return { valid: false, error: 'Directory does not exist' };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      return { valid: false, error: 'Cannot access directory' };
    }

    if (!stat.isDirectory()) {
      return { valid: false, error: 'Path is not a directory' };
    }

    // Check read permission
    try {
      fs.accessSync(resolvedPath, fs.constants.R_OK);
    } catch {
      return { valid: false, error: 'Directory is not readable' };
    }

    // Check write permission
    try {
      fs.accessSync(resolvedPath, fs.constants.W_OK);
    } catch {
      return { valid: false, error: 'Directory is not writable' };
    }

    return { valid: true };
  }

  /**
   * Detect the project type based on configuration files present in the workspace.
   */
  private detectProjectType(workspacePath: string): WorkspaceInfo['projectType'] {
    const resolvedPath = path.resolve(workspacePath);

    for (const [filename, projectType] of Object.entries(PROJECT_TYPE_MAP)) {
      if (fs.existsSync(path.join(resolvedPath, filename))) {
        return projectType;
      }
    }

    return 'unknown';
  }

  /**
   * Scan for context files in the workspace.
   */
  private scanContextFiles(workspacePath: string): string[] {
    const resolvedPath = path.resolve(workspacePath);
    const found: string[] = [];

    for (const filename of CONTEXT_FILES) {
      if (fs.existsSync(path.join(resolvedPath, filename))) {
        found.push(filename);
      }
    }

    return found;
  }

  /**
   * Select a workspace: validate, detect project type, scan context files.
   */
  select(workspacePath: string): WorkspaceInfo {
    const resolvedPath = path.resolve(workspacePath);
    const validation = this.validate(resolvedPath);

    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid workspace');
    }

    const projectType = this.detectProjectType(resolvedPath);
    const contextFiles = this.scanContextFiles(resolvedPath);
    const hasClaudeMd = fs.existsSync(path.join(resolvedPath, '.claude.md'));
    const gitStatus = this.detectGitStatus(resolvedPath);

    return {
      path: resolvedPath,
      projectType,
      contextFiles,
      hasClaudeMd,
      gitStatus,
    };
  }

  /**
   * Detect git status of the workspace (simple heuristic).
   */
  private detectGitStatus(workspacePath: string): WorkspaceInfo['gitStatus'] {
    const gitDir = path.join(workspacePath, '.git');
    if (!fs.existsSync(gitDir)) {
      return 'not_git';
    }
    return 'clean';
  }

  // === Git Operations ===

  /**
   * Get detailed git status using `git status --porcelain`.
   */
  async gitStatus(workspacePath: string): Promise<GitStatusResult> {
    const resolvedPath = path.resolve(workspacePath);
    const gitDir = path.join(resolvedPath, '.git');
    if (!fs.existsSync(gitDir)) {
      return { isGit: false, branch: '', changes: [] };
    }

    const [branch, porcelain] = await Promise.all([
      this.execGit(resolvedPath, ['branch', '--show-current']),
      this.execGit(resolvedPath, ['status', '--porcelain']),
    ]);

    const changes: GitChange[] = [];
    for (const line of porcelain.split('\n').filter(Boolean)) {
      const x = line[0];   // staging area status
      const y = line[1];   // working tree status
      const filePath = line.slice(3);

      // Derive a simplified status letter
      const status = gitStatusCode(x, y);
      const staged = x !== ' ' && x !== '?';

      changes.push({ path: filePath, status, staged });
    }

    return { isGit: true, branch: branch.trim(), changes };
  }

  /**
   * Get unified diff for a specific file or the entire working tree.
   * Combines both staged and unstaged changes.
   */
  async gitDiff(workspacePath: string, filePath?: string): Promise<GitDiffResult> {
    const resolvedPath = path.resolve(workspacePath);
    let diff = '';

    if (filePath) {
      // Check if the file is untracked
      const statusLine = await this.execGit(resolvedPath, ['status', '--porcelain', '--', filePath]).catch(() => '');

      if (statusLine.startsWith('??')) {
        // Untracked file: read content and present as pure additions
        const fullPath = path.join(resolvedPath, filePath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n');
          diff = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
          for (const line of lines) {
            diff += `+${line}\n`;
          }
        } catch {
          diff = '';
        }
      } else {
        // Tracked file: merge staged + unstaged diffs
        const [unstaged, staged] = await Promise.all([
          this.execGit(resolvedPath, ['diff', '--', filePath]).catch(() => ''),
          this.execGit(resolvedPath, ['diff', '--cached', '--', filePath]).catch(() => ''),
        ]);
        diff = joinDiffs(staged, unstaged);
      }
    } else {
      // All files: merge staged + unstaged
      const [unstaged, staged] = await Promise.all([
        this.execGit(resolvedPath, ['diff']).catch(() => ''),
        this.execGit(resolvedPath, ['diff', '--cached']).catch(() => ''),
      ]);
      diff = joinDiffs(staged, unstaged);
    }

    // Count additions / deletions
    let additions = 0;
    let deletions = 0;
    for (const line of diff.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }

    return { path: filePath || '', diff, additions, deletions };
  }

  /**
   * Execute a git command and return its stdout.
   * Tolerates exit code 1 (used by diff commands to indicate differences).
   */
  private execGit(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code) => {
        // code=0: success, code=1: diff has changes (not an error)
        if (code === 0 || code === 1) resolve(stdout);
        else reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`));
      });
      child.on('error', (err) => reject(err));
    });
  }

  /**
   * Get workspace history (most recent first, max 10 entries).
   */
  getHistory(): string[] {
    if (!fs.existsSync(this.historyFile)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.historyFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return [];
    }
  }

  /**
   * Add a workspace path to history.
   * - Deduplicates (moves existing entry to front)
   * - Keeps max 10 entries
   * - Most recent first
   */
  addToHistory(workspacePath: string): void {
    const resolvedPath = path.resolve(workspacePath);
    let history = this.getHistory();

    // Remove existing entry if present (dedup)
    history = history.filter(p => p !== resolvedPath);

    // Add to front (most recent first)
    history.unshift(resolvedPath);

    // Trim to max size
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    // Ensure config dir exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf-8');
  }

  /**
   * Check if a target path is within the workspace boundary.
   * Prevents path traversal attacks (e.g., using ../ to escape workspace).
   */
  private isWithinWorkspace(workspacePath: string, targetPath: string): boolean {
    const resolvedWorkspace = path.resolve(workspacePath);
    const resolvedTarget = path.resolve(workspacePath, targetPath);

    if (resolvedTarget === resolvedWorkspace) {
      return true;
    }

    return resolvedTarget.startsWith(resolvedWorkspace + path.sep);
  }

  // === Saved Workspaces ===

  private loadSavedWorkspaces(): SavedWorkspace[] {
    if (!fs.existsSync(this.savedWorkspacesFile)) return [];
    try {
      const raw = fs.readFileSync(this.savedWorkspacesFile, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveSavedWorkspaces(workspaces: SavedWorkspace[]): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.savedWorkspacesFile, JSON.stringify(workspaces, null, 2), 'utf-8');
  }

  listSavedWorkspaces(): SavedWorkspace[] {
    return this.loadSavedWorkspaces();
  }

  addSavedWorkspace(workspacePath: string, name?: string): SavedWorkspace {
    const resolvedPath = path.resolve(workspacePath);
    const validation = this.validate(resolvedPath);
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid workspace path');
    }

    const workspaces = this.loadSavedWorkspaces();
    // Check if already exists
    const existing = workspaces.find(w => w.path === resolvedPath);
    if (existing) return existing;

    const projectType = this.detectProjectType(resolvedPath);
    const displayName = name || resolvedPath.split(path.sep).pop() || resolvedPath;

    const saved: SavedWorkspace = {
      id: `ws-${Date.now()}`,
      path: resolvedPath,
      name: displayName,
      projectType,
      addedAt: new Date().toISOString(),
    };

    workspaces.push(saved);
    this.saveSavedWorkspaces(workspaces);
    return saved;
  }

  removeSavedWorkspace(id: string): boolean {
    const workspaces = this.loadSavedWorkspaces();
    const idx = workspaces.findIndex(w => w.id === id);
    if (idx < 0) return false;
    workspaces.splice(idx, 1);
    this.saveSavedWorkspaces(workspaces);
    return true;
  }

  updateSavedWorkspaceName(id: string, name: string): SavedWorkspace | undefined {
    const workspaces = this.loadSavedWorkspaces();
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return undefined;
    ws.name = name;
    this.saveSavedWorkspaces(workspaces);
    return ws;
  }

  // === File Content Reading ===

  readFileContent(filePath: string, workspacePath: string): { content: string; encoding: 'text' | 'binary'; size: number } {
    const resolvedPath = path.resolve(filePath);

    // Security: must be within workspace
    if (!this.isWithinWorkspace(workspacePath, resolvedPath)) {
      throw new Error('Access denied: file is outside workspace');
    }

    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File not found');
    }

    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error('Path is a directory, not a file');
    }

    // Limit file size for preview (1MB)
    const MAX_SIZE = 1024 * 1024;
    if (stat.size > MAX_SIZE) {
      return {
        content: `[File too large to preview: ${(stat.size / 1024).toFixed(1)}KB]`,
        encoding: 'text',
        size: stat.size,
      };
    }

    // Check if binary by extension
    const binaryExtensions = new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
      '.pdf', '.zip', '.tar', '.gz', '.jar', '.war', '.class',
      '.exe', '.dll', '.so', '.dylib',
    ]);
    const ext = path.extname(resolvedPath).toLowerCase();
    if (binaryExtensions.has(ext)) {
      return { content: `[Binary file: ${ext}]`, encoding: 'binary', size: stat.size };
    }

    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      return { content, encoding: 'text', size: stat.size };
    } catch {
      return { content: '[Cannot read file: encoding error]', encoding: 'binary', size: stat.size };
    }
  }
}
