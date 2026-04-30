import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import {
  Sparkles,
  Pencil,
  RefreshCw,
  Save,
  X,
  AlertTriangle,
  Loader2,
  Info,
  Play,
  Send,
  MessageSquare,
  Clock,
  FolderOpen,
  FileText,
  Trash2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

interface PlanSummary {
  id: string;
  requirementId: string;
  workspacePath: string;
  status: 'generating' | 'ready' | 'failed';
  summary?: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredPlan extends PlanSummary {
  rawOutput?: string;
  error?: string;
  sessionId?: string;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function PlanPage() {
  const navigate = useNavigate();

  // From store
  const taskId = useAppStore((s) => s.plan.taskId);
  const planLogs = useAppStore((s) => s.plan.logs);
  const selectedRequirement = useAppStore((s) => s.requirements.selected);
  const currentWorkspace = useAppStore((s) => s.workspace.current);
  const setPlanStatus = useAppStore((s) => s.setPlanStatus);
  const setPlanTaskId = useAppStore((s) => s.setPlanTaskId);
  const setExecutionId = useAppStore((s) => s.setExecutionId);
  const clearExecutionLogs = useAppStore((s) => s.clearExecutionLogs);
  const clearPlanLogs = useAppStore((s) => s.clearPlanLogs);

  // History list
  const [planHistory, setPlanHistory] = useState<PlanSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Current plan
  const [activePlanId, setActivePlanId] = useState<string | null>(taskId);
  const [plan, setPlan] = useState<StoredPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editedSummary, setEditedSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  const canGenerate = selectedRequirement && currentWorkspace && !generating;

  // Auto-scroll plan logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [planLogs]);

  // Load plan history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await apiGet<PlanSummary[]>('/plan/list');
      setPlanHistory(data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load a specific plan
  const loadPlan = useCallback(async (id: string) => {
    try {
      const data = await apiGet<StoredPlan>(`/plan/${id}`);
      setPlan(data);
      setActivePlanId(id);
      if (data.status === 'generating') {
        setGenerating(true);
      } else {
        setGenerating(false);
      }
    } catch {
      // ignore
    }
  }, []);

  // Auto-load when taskId changes (from Pipeline run or localStorage)
  useEffect(() => {
    if (!taskId) return;
    setActivePlanId(taskId);
    setError(null);
    clearPlanLogs();
    // Try loading plan immediately; only set generating if it's actually in progress
    apiGet<StoredPlan>(`/plan/${taskId}`).then((data) => {
      setPlan(data);
      if (data.status === 'generating') {
        setGenerating(true);
      } else {
        setGenerating(false);
      }
    }).catch(() => {
      // Plan not found or error - ignore, polling will handle it
    });
  }, [taskId, clearPlanLogs]);

  // Poll active plan when generating
  useEffect(() => {
    if (!activePlanId) return;

    const poll = async () => {
      try {
        const result = await apiGet<StoredPlan>(`/plan/${activePlanId}`);
        if (result.status === 'ready') {
          setPlan(result);
          setGenerating(false);
          setPlanStatus('ready');
          loadHistory(); // refresh history list
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (result.status === 'failed') {
          setPlan(result);
          setError(result.error || 'Plan generation failed');
          setGenerating(false);
          setPlanStatus('idle');
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          // still generating - always update plan to show latest content
          setPlan(result);
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activePlanId, setPlanStatus, loadHistory]);

  const generatePlan = async () => {
    if (!selectedRequirement || !currentWorkspace) return;
    setGenerating(true);
    setError(null);
    setPlan(null);
    clearPlanLogs();
    try {
      const { taskId: newTaskId } = await apiPost<{ taskId: string }>('/plan/generate', {
        requirementId: selectedRequirement.id,
        workspacePath: currentWorkspace.path,
      });
      setPlanTaskId(newTaskId);
      setActivePlanId(newTaskId);
      setPlanStatus('generating');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate plan');
      setGenerating(false);
    }
  };

  const savePlan = async () => {
    if (!plan || !activePlanId) return;
    try {
      const updated = await apiPut<StoredPlan>(`/plan/${activePlanId}`, {
        summary: editedSummary,
        rawOutput: editedSummary,
      });
      setPlan(updated);
      setEditing(false);
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    }
  };

  const deletePlan = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiDelete(`/plan/${id}`);
      setPlanHistory(prev => prev.filter(p => p.id !== id));
      if (activePlanId === id) {
        setPlan(null);
        setActivePlanId(null);
        setPlanTaskId(null);
      }
    } catch {
      // ignore
    }
  };

  const handleReply = async () => {
    if (!replyText.trim() || !activePlanId || replying) return;
    const message = replyText.trim();
    setReplying(true);
    setGenerating(true);
    clearPlanLogs();
    setReplyText('');

    try {
      await apiPost(`/plan/${activePlanId}/reply`, { message });

      // Restart polling since activePlanId didn't change
      if (pollRef.current) clearInterval(pollRef.current);
      const poll = async () => {
        try {
          const result = await apiGet<StoredPlan>(`/plan/${activePlanId}`);
          if (result.status === 'ready') {
            setPlan(result);
            setGenerating(false);
            setPlanStatus('ready');
            loadHistory();
            if (pollRef.current) clearInterval(pollRef.current);
            // Restore focus to reply input
            setTimeout(() => replyInputRef.current?.focus(), 100);
          } else if (result.status === 'failed') {
            setPlan(result);
            setError(result.error || 'Reply failed');
            setGenerating(false);
            setPlanStatus('idle');
            if (pollRef.current) clearInterval(pollRef.current);
          } else {
            if (result.rawOutput) setPlan(result);
          }
        } catch {
          // keep polling
        }
      };
      poll();
      pollRef.current = setInterval(poll, 2000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reply');
      setGenerating(false);
    } finally {
      setReplying(false);
    }
  };

  const handleConfirmAndExecute = async () => {
    if (!plan || !activePlanId) return;
    setExecuting(true);
    setError(null);
    clearExecutionLogs();
    try {
      const result = await apiPost<{ executionId: string }>('/execution/start', {
        planId: activePlanId,
      });
      setExecutionId(result.executionId);
      navigate('/execution');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start execution');
      setExecuting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const statusIcon = (status: string) => {
    switch (status) {
      case 'ready': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'failed': return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      case 'generating': return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
      default: return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex h-full">
      {/* Left: Plan History */}
      <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Plan History
          </span>
          {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex-1 overflow-y-auto">
          {planHistory.length === 0 && !loadingHistory && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
              <FileText className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No plans yet</p>
            </div>
          )}

          {planHistory.map((p) => (
            <div
              key={p.id}
              onClick={() => loadPlan(p.id)}
              className={cn(
                'group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors',
                activePlanId === p.id
                  ? 'bg-primary/5 border-l-2 border-l-primary'
                  : 'hover:bg-accent/50'
              )}
            >
              <div className="mt-0.5 shrink-0">{statusIcon(p.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground">
                  {p.summary?.substring(0, 50) || p.requirementId || 'Plan'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(p.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <FolderOpen className="h-3 w-3 text-muted-foreground/40" />
                  <span className="text-xs text-muted-foreground/40 truncate font-mono">
                    {p.workspacePath.split(/[/\\]/).pop()}
                  </span>
                </div>
              </div>
              <button
                onClick={(e) => deletePlan(p.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Plan Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Development Plan</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {generating ? 'Claude is generating a plan...' :
                 plan ? 'Review and confirm the plan before execution' :
                 'Select a plan from history or generate a new one'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {!plan && !generating && (
                <Button onClick={generatePlan} disabled={!canGenerate}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Plan
                </Button>
              )}
              {plan && !editing && !generating && (
                <>
                  <Button variant="outline" size="sm" onClick={() => {
                    setEditing(true);
                    setEditedSummary(plan.rawOutput || plan.summary || '');
                  }}>
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={generatePlan} disabled={generating}>
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    New Plan
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={handleConfirmAndExecute}
                    disabled={executing || plan.status !== 'ready'}
                  >
                    {executing ? (
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-1.5" />
                    )}
                    {executing ? 'Starting...' : 'Confirm & Execute'}
                  </Button>
                </>
              )}
              {editing && (
                <>
                  <Button size="sm" onClick={savePlan}>
                    <Save className="h-4 w-4 mr-1.5" />
                    Save
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                    <X className="h-4 w-4 mr-1.5" />
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* No plan selected */}
          {!activePlanId && !generating && (
            <Card>
              <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">
                  {planHistory.length > 0
                    ? 'Select a plan from the history, or generate a new one'
                    : 'No plans yet. Run a Pipeline or click Generate Plan to start.'}
                </p>
                {!canGenerate && !selectedRequirement && (
                  <p className="text-xs text-muted-foreground/60">
                    Select a requirement first (go to Requirements page)
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Generating indicator */}
          {generating && (
            <Card className="mb-4">
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <span className="text-sm font-medium">Claude is analyzing and generating a plan...</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                  <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
                </div>

                {planLogs.length > 0 && (
                  <div className="rounded-md bg-gray-950 border border-border overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-gray-900/50">
                      <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs text-muted-foreground font-mono">Claude output</span>
                    </div>
                    <div className="max-h-64 overflow-y-auto p-3 font-mono text-xs text-gray-300 leading-relaxed">
                      {planLogs.map((log, i) => (
                        <span key={i}>{log}</span>
                      ))}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                )}

                {planLogs.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Waiting for Claude to start... This may take 30–60 seconds.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-sm text-muted-foreground mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Plan content - only show when plan data is loaded */}
          {plan && (
            <div className="space-y-4">
              {/* Context info */}
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Requirement:</span>
                    <span className="font-medium">
                      {selectedRequirement?.title || plan.requirementId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mt-1">
                    <span className="text-muted-foreground">Workspace:</span>
                    <span className="font-mono text-xs">{plan.workspacePath}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm mt-1">
                    <span className="text-muted-foreground">Created:</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(plan.createdAt).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Streaming output while Claude is continuing */}
              {generating && planLogs.length > 0 && (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                      <span className="text-sm font-medium text-primary">Claude is continuing...</span>
                    </div>
                    <div className="rounded-md bg-gray-950 border border-border overflow-hidden">
                      <div className="max-h-48 overflow-y-auto p-3 font-mono text-xs text-gray-300 leading-relaxed">
                        {planLogs.map((log, i) => (
                          <span key={i}>{log}</span>
                        ))}
                        <div ref={logEndRef} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Plan output */}
              <Card>
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold mb-3">Generated Plan</h3>
                  {editing ? (
                    <textarea
                      value={editedSummary}
                      onChange={(e) => setEditedSummary(e.target.value)}
                      className="w-full min-h-[400px] bg-muted/30 border border-input rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                    />
                  ) : (
                    <pre className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/20 rounded-md p-4 overflow-x-auto">
                      {plan.rawOutput || plan.summary || 'No plan content available.'}
                    </pre>
                  )}
                </CardContent>
              </Card>

              {/* Reply input */}
              {!editing && (
                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Reply to Claude</h3>
                      <span className="text-xs text-muted-foreground">
                        Answer Claude's questions or provide more context
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        ref={replyInputRef}
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                            e.preventDefault();
                            handleReply();
                          }
                        }}
                        placeholder="Type your reply... (Ctrl+Enter to send)"
                        rows={3}
                        disabled={generating}
                        className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                      />
                      <Button
                        onClick={handleReply}
                        disabled={!replyText.trim() || replying || generating}
                        className="self-end"
                        size="sm"
                      >
                        {replying ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {generating && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Waiting for Claude to finish...
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
