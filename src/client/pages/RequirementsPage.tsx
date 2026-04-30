import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost, apiDelete } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import {
  Search,
  X,
  CheckCircle2,
  AlertCircle,
  User,
  Paperclip,
  Link2,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Download,
  BookOpen,
  Clock,
} from 'lucide-react';

interface Requirement {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  updatedAt: string;
}

interface StoredRequirement extends Requirement {
  description: string;
  acceptanceCriteria: string[];
  attachments: { name: string; url: string; type: string }[];
  relatedIssues: { id: string; title: string; status: string }[];
  savedAt: string;
  source: string;
}

export default function RequirementsPage() {
  // Saved requirements (local store)
  const [saved, setSaved] = useState<StoredRequirement[]>([]);
  const [selected, setSelected] = useState<StoredRequirement | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);

  // Fetch by ID
  const [fetchId, setFetchId] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Search via MCP
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Requirement[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const setSelectedRequirement = useAppStore((s) => s.setSelectedRequirement);

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const data = await apiGet<StoredRequirement[]>('/requirements/saved');
      setSaved(data);
    } catch {
      // ignore
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    loadSaved();
  }, [loadSaved]);

  // Fetch a requirement by ID from MCP and save it
  const handleFetch = async () => {
    if (!fetchId.trim()) return;
    setFetching(true);
    setFetchError(null);
    try {
      const req = await apiPost<StoredRequirement>('/requirements/fetch', { id: fetchId.trim() });
      setSaved(prev => {
        const filtered = prev.filter(r => r.id !== req.id);
        return [req, ...filtered];
      });
      setSelected(req);
      setSelectedRequirement(req);
      setFetchId('');
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to fetch requirement');
    } finally {
      setFetching(false);
    }
  };

  // Search via MCP (results not auto-saved)
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const results = await apiGet<Requirement[]>(
        `/requirements/search?q=${encodeURIComponent(searchQuery)}`
      );
      setSearchResults(results);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Save a search result to local store
  const handleSaveFromSearch = async (req: Requirement) => {
    try {
      const saved = await apiPost<StoredRequirement>('/requirements/fetch', { id: req.id });
      setSaved(prev => {
        const filtered = prev.filter(r => r.id !== saved.id);
        return [saved, ...filtered];
      });
      setSelected(saved);
      setSelectedRequirement(saved);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to save requirement');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(`/requirements/saved/${id}`);
      setSaved(prev => prev.filter(r => r.id !== id));
      if (selected?.id === id) {
        setSelected(null);
        setSelectedRequirement(null);
      }
    } catch {
      // ignore
    }
  };

  const handleSelect = (req: StoredRequirement) => {
    setSelected(req);
    setSelectedRequirement(req);
  };

  const priorityColor = (p: string) => {
    switch (p.toLowerCase()) {
      case 'high': return 'text-red-500 bg-red-500/10';
      case 'medium': return 'text-yellow-500 bg-yellow-500/10';
      case 'low': return 'text-green-500 bg-green-500/10';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  const statusColor = (s: string) => {
    switch (s.toLowerCase()) {
      case 'done': case 'completed': return 'text-green-500 bg-green-500/10';
      case 'in_progress': case 'in progress': return 'text-blue-500 bg-blue-500/10';
      default: return 'text-muted-foreground bg-muted';
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Requirements</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Fetch requirements from ONES and save them for use in pipelines
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search className="h-4 w-4 mr-1.5" />
            Search MCP
          </Button>
        </div>

        {/* Fetch by ID */}
        <div className="mt-4 flex gap-2">
          <div className="relative flex-1">
            <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={fetchId}
              onChange={(e) => setFetchId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
              placeholder="Enter requirement ID (e.g. HRL2p8rTX4mQ9xMv) and press Enter..."
              className="pl-9"
            />
          </div>
          <Button onClick={handleFetch} disabled={fetching || !fetchId.trim()}>
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            {fetching ? 'Fetching...' : 'Fetch & Save'}
          </Button>
        </div>

        {fetchError && (
          <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {fetchError}
          </div>
        )}

        {/* MCP Search panel */}
        {showSearch && (
          <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search requirements in ONES..."
                className="flex-1"
              />
              <Button onClick={handleSearch} disabled={searching} size="sm">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowSearch(false); setSearchResults([]); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {searchError && (
              <p className="mt-2 text-xs text-destructive">{searchError}</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {searchResults.map(r => (
                  <div key={r.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent text-sm">
                    <span className="flex-1 truncate">{r.title}</span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(r.status))}>{r.status}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => handleSaveFromSearch(r)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Save
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-1 min-h-0">
        {/* Saved list */}
        <div className="w-80 flex flex-col border-r border-border">
          <div className="px-4 py-2 border-b border-border bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Saved Requirements ({saved.length})
            </p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingSaved && (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loadingSaved && saved.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
                <FileText className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No saved requirements</p>
                <p className="text-xs text-muted-foreground/60">
                  Enter a requirement ID above to fetch and save it
                </p>
              </div>
            )}
            {saved.map(req => (
              <div
                key={req.id}
                onClick={() => handleSelect(req)}
                className={cn(
                  'flex items-start gap-3 px-4 py-3 border-b border-border/50 cursor-pointer transition-colors group',
                  selected?.id === req.id
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'hover:bg-accent/50'
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{req.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(req.status))}>
                      {req.status}
                    </span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', priorityColor(req.priority))}>
                      {req.priority}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/60">
                    <Clock className="h-3 w-3" />
                    {new Date(req.savedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(req.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto">
          {selected ? (
            <div className="p-6 max-w-2xl">
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-lg font-semibold leading-tight">{selected.title}</h2>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1 rounded hover:bg-accent text-muted-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <span className={cn('text-xs px-2 py-1 rounded-full font-medium', statusColor(selected.status))}>
                  {selected.status}
                </span>
                <span className={cn('text-xs px-2 py-1 rounded-full font-medium', priorityColor(selected.priority))}>
                  {selected.priority}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3" />
                  {selected.assignee || 'Unassigned'}
                </span>
                <span className="text-xs text-muted-foreground">
                  Source: <code className="bg-muted px-1 rounded">{selected.source}</code>
                </span>
              </div>

              {selected.description && (
                <div className="mt-5">
                  <h4 className="text-sm font-medium mb-2">Description</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {selected.description}
                  </p>
                </div>
              )}

              {selected.acceptanceCriteria.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-medium mb-2">Acceptance Criteria</h4>
                  <ul className="space-y-2">
                    {selected.acceptanceCriteria.map((ac, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                        <span>{ac}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.attachments.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-medium mb-2">Attachments</h4>
                  <ul className="space-y-1.5">
                    {selected.attachments.map((att, i) => (
                      <li key={i}>
                        <a href={att.url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline">
                          <Paperclip className="h-3.5 w-3.5" />
                          {att.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected.relatedIssues.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-medium mb-2">Related Issues</h4>
                  <ul className="space-y-1.5">
                    {selected.relatedIssues.map(issue => (
                      <li key={issue.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Link2 className="h-3.5 w-3.5" />
                        <span className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(issue.status))}>
                          {issue.status}
                        </span>
                        <span>{issue.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <FileText className="h-12 w-12 opacity-20" />
              <p className="text-sm">Select a requirement to view details</p>
              <p className="text-xs opacity-60">Selected requirements can be used in Pipeline runs</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
