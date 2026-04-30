import { useState, useEffect, useCallback, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete, pickFolder } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  Package,
  Coffee,
  Cpu,
  HardDrive,
  GitBranch,
  Eye,
  Code,
  FilePlus,
  FileMinus,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

interface SavedWorkspace {
  id: string;
  path: string;
  name: string;
  projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
  addedAt: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt: string;
  extension?: string;
}

interface FileContent {
  content: string;
  encoding: 'text' | 'binary';
  size: number;
}

interface GitChange {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?' | '!';
  staged: boolean;
}

interface GitStatusResult {
  isGit: boolean;
  branch: string;
  changes: GitChange[];
}

interface GitDiffResult {
  path: string;
  diff: string;
  additions: number;
  deletions: number;
}

// === Constants ===
const LEFT_DEFAULT = 224;
const LEFT_MIN = 160;
const LEFT_MAX = 400;
const MIDDLE_DEFAULT = 260;
const MIDDLE_MIN = 180;
const MIDDLE_MAX = 500;

// === Helpers ===

function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    java: 'java', py: 'python', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
    cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
    xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
    sh: 'bash', bat: 'batch', ps1: 'powershell', sql: 'sql',
    properties: 'properties', env: 'bash', gitignore: 'bash',
  };
  return map[ext] || 'text';
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  M: { label: 'M', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  A: { label: 'A', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  D: { label: 'D', color: 'text-red-500', bg: 'bg-red-500/10' },
  R: { label: 'R', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  '?': { label: 'U', color: 'text-gray-400', bg: 'bg-gray-500/10' },
  '!': { label: '!', color: 'text-gray-500', bg: 'bg-gray-500/10' },
};

// === Draggable divider hook ===

function useDragDivider(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onDrag: (dx: number) => void,
) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const start = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      onDrag(dx);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onDrag]);

  return start;
}

// === Sub-components ===

function ProjectTypeIcon({ type, className }: { type: string; className?: string }) {
  const cls = cn('h-4 w-4', className);
  switch (type) {
    case 'node': return <Package className={cn(cls, 'text-green-500')} />;
    case 'python': return <Cpu className={cn(cls, 'text-blue-500')} />;
    case 'java': return <Coffee className={cn(cls, 'text-orange-500')} />;
    case 'rust': return <HardDrive className={cn(cls, 'text-orange-700')} />;
    default: return <Folder className={cn(cls, 'text-muted-foreground')} />;
  }
}

function DiffView({ diff, additions, deletions, filePath }: { diff: string; additions: number; deletions: number; filePath: string }) {
  if (!diff) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <FilePlus className="h-8 w-8 opacity-20" />
        <p className="text-sm">No changes to display</p>
      </div>
    );
  }

  const lines = diff.split('\n');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30 shrink-0">
        <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-mono text-foreground truncate flex-1">
          {filePath || 'All changes'}
        </span>
        <span className="text-xs text-emerald-500 shrink-0">+{additions}</span>
        <span className="text-xs text-red-500 shrink-0">-{deletions}</span>
      </div>

      <div className="flex-1 overflow-auto bg-[#1e1e1e]">
        <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto min-h-full">
          {lines.map((line, i) => {
            let lineClass = 'text-gray-200';
            let bgClass = '';

            if (line.startsWith('@@') || line.startsWith('## ')) {
              lineClass = 'text-blue-400';
              bgClass = 'bg-blue-500/5';
            } else if (line.startsWith('+++') || line.startsWith('---')) {
              lineClass = 'text-yellow-300';
              bgClass = 'bg-yellow-500/5';
            } else if (line.startsWith('+')) {
              lineClass = 'text-emerald-300';
              bgClass = 'bg-emerald-500/10';
            } else if (line.startsWith('-')) {
              lineClass = 'text-red-300';
              bgClass = 'bg-red-500/10';
            }

            return (
              <div key={i} className={cn(bgClass)}>
                <span className={lineClass}>{line}</span>
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

function FileTreeNode({
  entry,
  workspacePath,
  depth,
  onFileClick,
  selectedFile,
}: {
  entry: DirectoryEntry;
  workspacePath: string;
  depth: number;
  onFileClick: (path: string, name: string) => void;
  selectedFile: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadChildren = async () => {
    setLoading(true);
    try {
      const data = await apiGet<DirectoryEntry[]>(
        `/workspace/browse?path=${encodeURIComponent(entry.path)}`
      );
      const sorted = [...data].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setChildren(sorted);
      setLoaded(true);
      setExpanded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const toggle = async () => {
    if (!entry.isDirectory) {
      onFileClick(entry.path, entry.name);
      return;
    }
    if (!loaded) {
      await loadChildren();
    } else {
      setExpanded(!expanded);
    }
  };

  const isSelected = !entry.isDirectory && selectedFile === entry.path;

  return (
    <div>
      <div
        onClick={toggle}
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors select-none',
          isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50',
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {entry.isDirectory ? (
          <>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
            ) : expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            {expanded ? (
              <FolderOpen className="h-4 w-4 text-blue-400 shrink-0" />
            ) : (
              <Folder className="h-4 w-4 text-blue-400 shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <File className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          </>
        )}
        <span className={cn(
          'truncate text-xs',
          entry.isDirectory ? 'font-medium text-foreground' : 'text-muted-foreground'
        )}>
          {entry.name}
        </span>
        {!entry.isDirectory && entry.size !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground/40 shrink-0">
            {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(0)}K`}
          </span>
        )}
      </div>
      {entry.isDirectory && expanded && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              workspacePath={workspacePath}
              depth={depth + 1}
              onFileClick={onFileClick}
              selectedFile={selectedFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// === Divider ===

function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
      onMouseDown={onMouseDown}
    />
  );
}

type MiddleTab = 'files' | 'changes';

// === Main component ===

export default function WorkspacePage() {
  // Panel sizing
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [middleWidth, setMiddleWidth] = useState(MIDDLE_DEFAULT);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [middleCollapsed, setMiddleCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Workspace data
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
  const [selectedWs, setSelectedWs] = useState<SavedWorkspace | null>(null);
  const [rootEntries, setRootEntries] = useState<DirectoryEntry[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Git state
  const [middleTab, setMiddleTab] = useState<MiddleTab>('files');
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [gitDiffResult, setGitDiffResult] = useState<GitDiffResult | null>(null);
  const [selectedChange, setSelectedChange] = useState<string | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);

  const setCurrentWorkspace = useAppStore((s) => s.setCurrentWorkspace);

  // Drag handlers
  const dragLeft = useDragDivider(containerRef, useCallback((dx: number) => {
    setLeftWidth(w => Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + dx)));
  }, []));

  const dragMiddle = useDragDivider(containerRef, useCallback((dx: number) => {
    setMiddleWidth(w => Math.min(MIDDLE_MAX, Math.max(MIDDLE_MIN, w + dx)));
  }, []));

  // Data loading
  const loadSavedWorkspaces = useCallback(async () => {
    try {
      const data = await apiGet<SavedWorkspace[]>('/workspace/saved');
      setSavedWorkspaces(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSavedWorkspaces(); }, [loadSavedWorkspaces]);

  const loadGitStatus = useCallback(async (wsPath: string) => {
    setLoadingGit(true);
    try {
      const data = await apiGet<GitStatusResult>(
        `/workspace/git/status?workspacePath=${encodeURIComponent(wsPath)}`
      );
      setGitStatus(data);
    } catch {
      setGitStatus(null);
    } finally {
      setLoadingGit(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWs && middleTab === 'changes') {
      loadGitStatus(selectedWs.path);
      setSelectedChange(null);
      setGitDiffResult(null);
    }
  }, [selectedWs, middleTab, loadGitStatus]);

  const handleAddWorkspace = async () => {
    const picked = await pickFolder('Select Workspace Folder');
    if (!picked) return;
    try {
      const saved = await apiPost<SavedWorkspace>('/workspace/saved', { path: picked });
      setSavedWorkspaces(prev => [...prev, saved]);
      selectWorkspace(saved);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add workspace');
    }
  };

  const handleRemove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDelete(`/workspace/saved/${id}`);
      setSavedWorkspaces(prev => prev.filter(w => w.id !== id));
      if (selectedWs?.id === id) {
        setSelectedWs(null);
        setRootEntries([]);
        setSelectedFile(null);
        setFileContent(null);
        setGitStatus(null);
        setGitDiffResult(null);
        setSelectedChange(null);
      }
    } catch { /* ignore */ }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const updated = await apiPut<SavedWorkspace>(`/workspace/saved/${id}`, { name: editName.trim() });
      setSavedWorkspaces(prev => prev.map(w => w.id === id ? updated : w));
      setEditingId(null);
    } catch { /* ignore */ }
  };

  const selectWorkspace = async (ws: SavedWorkspace) => {
    setSelectedWs(ws);
    setSelectedFile(null);
    setFileContent(null);
    setMiddleTab('files');
    setGitStatus(null);
    setGitDiffResult(null);
    setSelectedChange(null);
    setLoadingTree(true);
    try {
      const data = await apiGet<DirectoryEntry[]>(
        `/workspace/browse?path=${encodeURIComponent(ws.path)}`
      );
      const sorted = [...data].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setRootEntries(sorted);
      try {
        const info = await apiPost('/workspace/select', { path: ws.path });
        setCurrentWorkspace(info as Parameters<typeof setCurrentWorkspace>[0]);
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    finally { setLoadingTree(false); }
  };

  const handleFileClick = async (filePath: string, fileName: string) => {
    if (!selectedWs) return;
    setSelectedFile(filePath);
    setSelectedFileName(fileName);
    setLoadingFile(true);
    setFileContent(null);
    setSelectedChange(null);
    setGitDiffResult(null);
    try {
      const data = await apiGet<FileContent>(
        `/workspace/file?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(selectedWs.path)}`
      );
      setFileContent(data);
    } catch (err) {
      setFileContent({
        content: `Error reading file: ${err instanceof Error ? err.message : 'Unknown error'}`,
        encoding: 'text',
        size: 0,
      });
    } finally {
      setLoadingFile(false);
    }
  };

  const handleChangeClick = async (changePath: string) => {
    if (!selectedWs) return;
    setSelectedChange(changePath);
    setSelectedFile(null);
    setFileContent(null);
    setLoadingDiff(true);
    setGitDiffResult(null);
    try {
      const data = await apiGet<GitDiffResult>(
        `/workspace/git/diff?workspacePath=${encodeURIComponent(selectedWs.path)}&file=${encodeURIComponent(changePath)}`
      );
      setGitDiffResult(data);
    } catch {
      setGitDiffResult(null);
    } finally {
      setLoadingDiff(false);
    }
  };

  const showDiffView = selectedChange !== null;
  const showFilePreview = selectedFile !== null && !showDiffView;

  // Effective panel widths (0 when collapsed)
  const effectiveLeft = leftCollapsed ? 0 : leftWidth;
  const effectiveMiddle = middleCollapsed ? 0 : middleWidth;

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      {/* ====== Left: Workspace List ====== */}
      {!leftCollapsed && (
        <>
          <div
            className="flex flex-col border-r border-border bg-muted/10 shrink-0 overflow-hidden"
            style={{ width: effectiveLeft }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Workspaces
              </span>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleAddWorkspace} title="Add workspace">
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost" size="sm" className="h-6 w-6 p-0"
                  onClick={() => setLeftCollapsed(true)} title="Collapse panel"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto py-1">
              {savedWorkspaces.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 px-3 text-center gap-2">
                  <Folder className="h-7 w-7 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">No workspaces yet</p>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleAddWorkspace}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Workspace
                  </Button>
                </div>
              )}

              {savedWorkspaces.map((ws) => (
                <div
                  key={ws.id}
                  onClick={() => selectWorkspace(ws)}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                    selectedWs?.id === ws.id
                      ? 'bg-primary/5 border-l-2 border-l-primary'
                      : 'hover:bg-accent/50'
                  )}
                >
                  <ProjectTypeIcon type={ws.projectType} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    {editingId === ws.id ? (
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRename(ws.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          className="h-5 text-xs px-1 py-0"
                          autoFocus
                        />
                        <button onClick={() => handleRename(ws.id)} className="text-emerald-500 hover:text-emerald-400">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-xs font-medium truncate">{ws.name}</p>
                        <p className="text-xs text-muted-foreground/50 truncate font-mono">{ws.path.split(/[/\\]/).slice(-2).join('/')}</p>
                      </>
                    )}
                  </div>
                  {editingId !== ws.id && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); setEditingId(ws.id); setEditName(ws.name); }}
                        className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        onClick={e => handleRemove(ws.id, e)}
                        className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Left divider */}
          <Divider onMouseDown={dragLeft} />
        </>
      )}

      {/* Collapsed left - expand button */}
      {leftCollapsed && (
        <div className="flex flex-col items-center pt-3 px-1 border-r border-border bg-muted/10 shrink-0">
          <Button
            variant="ghost" size="sm" className="h-6 w-6 p-0 mb-1"
            onClick={() => setLeftCollapsed(false)} title="Show workspaces"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ====== Middle: File Tree / Changes ====== */}
      {!middleCollapsed ? (
        <>
          <div
            className="flex flex-col border-r border-border shrink-0 overflow-hidden"
            style={{ width: effectiveMiddle }}
          >
            {selectedWs ? (
              <>
                {/* Workspace header */}
                <div className="px-3 py-2.5 border-b border-border bg-muted/10 shrink-0">
                  <div className="flex items-center gap-2">
                    <ProjectTypeIcon type={selectedWs.projectType} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{selectedWs.name}</p>
                      <div className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3 text-muted-foreground/50" />
                        <span className="text-xs text-muted-foreground/50 truncate font-mono">
                          {gitStatus?.isGit ? gitStatus.branch : selectedWs.projectType}
                        </span>
                        {gitStatus?.isGit && gitStatus.changes.length > 0 && (
                          <span className="text-xs text-amber-500 ml-auto shrink-0">
                            {gitStatus.changes.length}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0"
                      onClick={() => setMiddleCollapsed(true)} title="Collapse panel"
                    >
                      <PanelLeftClose className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Tab switch */}
                <div className="flex border-b border-border shrink-0">
                  <button
                    onClick={() => setMiddleTab('files')}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
                      middleTab === 'files'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Files
                  </button>
                  <button
                    onClick={() => setMiddleTab('changes')}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-xs font-medium transition-colors relative',
                      middleTab === 'changes'
                        ? 'text-primary border-b-2 border-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Changes
                    {gitStatus && gitStatus.changes.length > 0 && (
                      <span className="ml-1 text-xs text-amber-500">{gitStatus.changes.length}</span>
                    )}
                  </button>
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-y-auto py-1">
                  {middleTab === 'files' ? (
                    loadingTree ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      rootEntries.map((entry) => (
                        <FileTreeNode
                          key={entry.path}
                          entry={entry}
                          workspacePath={selectedWs.path}
                          depth={0}
                          onFileClick={handleFileClick}
                          selectedFile={selectedFile}
                        />
                      ))
                    )
                  ) : (
                    loadingGit ? (
                      <div className="flex justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : !gitStatus?.isGit ? (
                      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
                        <GitBranch className="h-6 w-6 opacity-30" />
                        <p className="text-xs text-center">Not a git repository</p>
                      </div>
                    ) : gitStatus.changes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
                        <Check className="h-6 w-6 opacity-30 text-emerald-500" />
                        <p className="text-xs text-center">No changes</p>
                        <Button variant="ghost" size="sm" className="text-xs h-6 mt-1"
                          onClick={() => loadGitStatus(selectedWs.path)}>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Refresh
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="px-2 py-1 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {gitStatus.changes.length} file{gitStatus.changes.length > 1 ? 's' : ''} changed
                          </span>
                          <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                            onClick={() => loadGitStatus(selectedWs.path)} title="Refresh">
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                        {gitStatus.changes.map((change) => {
                          const cfg = STATUS_CONFIG[change.status] || STATUS_CONFIG['?'];
                          const isSelected = selectedChange === change.path;
                          return (
                            <div
                              key={change.path}
                              onClick={() => handleChangeClick(change.path)}
                              className={cn(
                                'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
                                isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'
                              )}
                            >
                              <span className={cn(
                                'text-xs font-mono font-bold w-4 text-center shrink-0',
                                cfg.color
                              )}>
                                {cfg.label}
                              </span>
                              <span className="text-xs truncate flex-1 font-mono text-muted-foreground">
                                {change.path}
                              </span>
                              {change.staged && (
                                <span className="text-xs text-emerald-500 shrink-0">S</span>
                              )}
                            </div>
                          );
                        })}
                      </>
                    )
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground px-4 text-center">
                <FolderOpen className="h-8 w-8 opacity-30" />
                <p className="text-xs">Select a workspace to browse files</p>
              </div>
            )}
          </div>

          {/* Middle divider */}
          <Divider onMouseDown={dragMiddle} />
        </>
      ) : (
        /* Collapsed middle - expand button */
        <div className="flex flex-col items-center pt-3 px-1 border-r border-border bg-muted/10 shrink-0">
          <Button
            variant="ghost" size="sm" className="h-6 w-6 p-0 mb-1"
            onClick={() => setMiddleCollapsed(false)} title="Show file tree"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* ====== Right: File Preview / Diff View ====== */}
      <div className="flex-1 flex flex-col min-w-0">
        {showDiffView ? (
          loadingDiff ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin opacity-20" />
              <p className="text-sm">Loading diff...</p>
            </div>
          ) : gitDiffResult ? (
            <DiffView
              diff={gitDiffResult.diff}
              additions={gitDiffResult.additions}
              deletions={gitDiffResult.deletions}
              filePath={gitDiffResult.path}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <FileMinus className="h-10 w-10 opacity-20" />
              <p className="text-sm">No diff available</p>
            </div>
          )
        ) : showFilePreview ? (
          <>
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
              <Code className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-mono text-foreground truncate">{selectedFileName}</span>
              <span className="text-xs text-muted-foreground/50 ml-auto shrink-0">
                {getLanguage(selectedFileName)}
              </span>
              {fileContent && (
                <span className="text-xs text-muted-foreground/50 shrink-0">
                  {fileContent.size < 1024
                    ? `${fileContent.size}B`
                    : `${(fileContent.size / 1024).toFixed(1)}KB`}
                </span>
              )}
            </div>

            <div className="flex-1 overflow-auto bg-[#1e1e1e]">
              {loadingFile ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                </div>
              ) : fileContent ? (
                <pre className="p-4 text-xs font-mono text-gray-200 leading-relaxed whitespace-pre overflow-x-auto min-h-full">
                  {fileContent.content}
                </pre>
              ) : null}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Eye className="h-10 w-10 opacity-20" />
            <p className="text-sm">Select a file to preview</p>
            <p className="text-xs opacity-60">Click any file in the tree to view its contents</p>
          </div>
        )}
      </div>
    </div>
  );
}
