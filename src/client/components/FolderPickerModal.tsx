import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api';
import { cn } from '../lib/utils';
import {
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  Home,
  ArrowLeft,
  X,
  Check,
  Loader2,
} from 'lucide-react';

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt: string;
}

interface FolderPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

export function FolderPickerModal({
  open,
  onClose,
  onSelect,
  initialPath,
  title = 'Select Folder',
}: FolderPickerModalProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || '');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pathStack, setPathStack] = useState<string[]>([]);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<DirectoryEntry[]>(
        `/workspace/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`
      );
      const sorted = [...data].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setCurrentPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setPathStack([]);
      browse(initialPath || '');
    }
  }, [open, initialPath, browse]);

  const navigateInto = (entry: DirectoryEntry) => {
    if (!entry.isDirectory) return;
    setPathStack(prev => [...prev, currentPath]);
    browse(entry.path);
  };

  const navigateBack = () => {
    const prev = pathStack[pathStack.length - 1] ?? '';
    setPathStack(p => p.slice(0, -1));
    browse(prev);
  };

  const navigateHome = () => {
    setPathStack([]);
    browse('');
  };

  const handleSelect = () => {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  };

  const breadcrumbs = currentPath
    ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
    : [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
          <button
            onClick={navigateHome}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Home"
          >
            <Home className="h-4 w-4" />
          </button>
          <button
            onClick={navigateBack}
            disabled={pathStack.length === 0}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-1 flex-1 overflow-hidden text-xs">
            <span className="text-muted-foreground shrink-0">/</span>
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate text-foreground">{crumb}</span>
              </span>
            ))}
            {breadcrumbs.length === 0 && (
              <span className="text-muted-foreground">Home</span>
            )}
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {error && (
            <div className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && entries.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Folder className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Empty directory</p>
            </div>
          )}

          {!loading && entries.map((entry) => (
            <div
              key={entry.path}
              onClick={() => entry.isDirectory && navigateInto(entry)}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 text-sm transition-colors',
                entry.isDirectory
                  ? 'cursor-pointer hover:bg-accent/50 group'
                  : 'opacity-50 cursor-default'
              )}
            >
              {entry.isDirectory ? (
                <FolderOpen className="h-4 w-4 text-blue-400 shrink-0 group-hover:text-blue-300" />
              ) : (
                <File className="h-4 w-4 text-muted-foreground/40 shrink-0" />
              )}
              <span className={cn(
                'flex-1 truncate',
                entry.isDirectory ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}>
                {entry.name}
              </span>
              {entry.isDirectory && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
          <div className="flex-1 min-w-0 mr-3">
            {currentPath ? (
              <p className="text-xs text-muted-foreground truncate font-mono">{currentPath}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Navigate to a folder and click Select</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSelect}
              disabled={!currentPath}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="h-3.5 w-3.5" />
              Select
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
