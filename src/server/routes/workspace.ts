import { Router } from 'express';
import os from 'os';
import { spawn } from 'child_process';
import { WorkspaceService } from '../services/workspace-service.js';
import { validateBody } from '../middleware/validation.js';

/**
 * Sanitize title to prevent shell injection across all platforms.
 * Only allows letters, digits, spaces, hyphens, underscores, and common CJK characters.
 */
function sanitizeTitle(title: string): string {
  return title.replace(/[^a-zA-Z0-9\s\-_\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, '').slice(0, 100) || 'Select Folder';
}

/**
 * Open the system native folder picker dialog.
 */
function openSystemFolderPicker(title: string): Promise<string | null> {
  const safe = sanitizeTitle(title);
  return new Promise((resolve) => {
    const platform = process.platform;

    if (platform === 'win32') {
      // Escape single quotes for PowerShell single-quoted string
      const escaped = safe.replace(/'/g, "''");
      const script = [
        '$shell = New-Object -ComObject Shell.Application',
        `$folder = $shell.BrowseForFolder(0, '${escaped}', 0, 0)`,
        'if ($folder) { Write-Output $folder.Self.Path }',
      ].join('; ');

      const child = spawn('powershell', ['-NoProfile', '-Command', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      child.on('close', () => resolve(output.trim() || null));
      child.on('error', () => resolve(null));

    } else if (platform === 'darwin') {
      // Escape double quotes for osascript
      const escaped = safe.replace(/"/g, '\\"');
      const script = `choose folder with prompt "${escaped}"`;
      const child = spawn('osascript', ['-e', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      child.on('close', () => {
        const raw = output.trim().replace(/^alias /, '');
        const p = raw ? '/' + raw.split(':').slice(1).join('/') : null;
        resolve(p);
      });
      child.on('error', () => resolve(null));

    } else {
      // Escape for zenity --title argument
      const escaped = safe.replace(/"/g, '');
      const child = spawn('zenity', ['--file-selection', '--directory', `--title=${escaped}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (d: Buffer) => { output += d.toString(); });
      child.on('close', () => resolve(output.trim() || null));
      child.on('error', () => resolve(null));
    }
  });
}

export function createWorkspaceRoutes(workspaceService: WorkspaceService): Router {
  const router = Router();

  // ─── Saved Workspaces ────────────────────────────────────────────────────────

  // GET /api/workspace/saved - List all saved workspaces
  router.get('/saved', (_req, res) => {
    try {
      res.json(workspaceService.listSavedWorkspaces());
    } catch (err) {
      res.status(500).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/workspace/saved - Add a workspace to saved list
  router.post('/saved', validateBody([{ field: 'path', required: true, type: 'string' }]), (req, res) => {
    try {
      const { path: workspacePath, name } = req.body as { path: string; name?: string };
      const saved = workspaceService.addSavedWorkspace(workspacePath, name);
      res.status(201).json(saved);
    } catch (err) {
      res.status(400).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // PUT /api/workspace/saved/:id - Rename a saved workspace
  router.put('/saved/:id', (req, res) => {
    try {
      const { name } = req.body as { name: string };
      const updated = workspaceService.updateSavedWorkspaceName(req.params.id, name);
      if (!updated) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Workspace not found' });
        return;
      }
      res.json(updated);
    } catch (err) {
      res.status(400).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // DELETE /api/workspace/saved/:id - Remove a saved workspace
  router.delete('/saved/:id', (req, res) => {
    try {
      const deleted = workspaceService.removeSavedWorkspace(req.params.id);
      res.json({ success: deleted });
    } catch (err) {
      res.status(500).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // ─── Legacy / Active Workspace ───────────────────────────────────────────────

  // POST /api/workspace/select - Select a workspace as active
  router.post('/select', validateBody([{ field: 'path', required: true, type: 'string' }]), async (req, res) => {
    try {
      const workspacePath = req.body.path as string;
      const info = workspaceService.select(workspacePath);
      workspaceService.addToHistory(workspacePath);
      res.json(info);
    } catch (err) {
      res.status(400).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/workspace/history - Get workspace history
  router.get('/history', (_req, res) => {
    try {
      res.json(workspaceService.getHistory());
    } catch (err) {
      res.status(500).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/workspace/browse?path= - Browse directory
  router.get('/browse', (req, res) => {
    try {
      const dirPath = (req.query.path as string) || '';
      const resolvedPath = dirPath.trim() === '' ? os.homedir() : dirPath;
      const entries = workspaceService.browse(resolvedPath);
      res.json(entries);
    } catch (err) {
      res.status(400).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/workspace/file?path=&workspace= - Read file content for preview
  router.get('/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      const workspacePath = req.query.workspace as string;

      if (!filePath || !workspacePath) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'path and workspace are required' });
        return;
      }

      const result = workspaceService.readFileContent(filePath, workspacePath);
      res.json(result);
    } catch (err) {
      res.status(400).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // POST /api/workspace/pick - Open system native folder picker
  router.post('/pick', async (req, res) => {
    try {
      const title = (req.body?.title as string) || 'Select Workspace Folder';
      const selectedPath = await openSystemFolderPicker(title);
      res.json({ path: selectedPath });
    } catch (err) {
      res.status(500).json({ code: 'WORKSPACE_ERROR', message: (err as Error).message });
    }
  });

  // ─── Git Operations ────────────────────────────────────────────────────────

  // GET /api/workspace/git/status?workspacePath=xxx
  router.get('/git/status', async (req, res) => {
    try {
      const workspacePath = req.query.workspacePath as string;
      if (!workspacePath) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'workspacePath is required' });
        return;
      }
      const result = await workspaceService.gitStatus(workspacePath);
      res.json(result);
    } catch (err) {
      res.status(500).json({ code: 'GIT_ERROR', message: (err as Error).message });
    }
  });

  // GET /api/workspace/git/diff?workspacePath=xxx&file=xxx
  router.get('/git/diff', async (req, res) => {
    try {
      const workspacePath = req.query.workspacePath as string;
      const file = req.query.file as string | undefined;
      if (!workspacePath) {
        res.status(400).json({ code: 'VALIDATION_ERROR', message: 'workspacePath is required' });
        return;
      }
      const result = await workspaceService.gitDiff(workspacePath, file);
      res.json(result);
    } catch (err) {
      res.status(500).json({ code: 'GIT_ERROR', message: (err as Error).message });
    }
  });

  return router;
}
