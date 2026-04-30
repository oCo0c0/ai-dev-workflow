import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import {
  Pause,
  RotateCcw,
  SkipForward,
  Square,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Terminal,
  Send,
  MessageSquare,
  Play,
  Clock,
  FolderOpen,
  TestTube,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

// === Types ===

interface ExecutionSummary {
  id: string;
  planId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  currentStep: number;
  totalSteps: number;
  startedAt: string;
  completedAt?: string;
  workspacePath?: string;
  logCount: number;
}

interface ExecutionDetail extends ExecutionSummary {
  logs: string[];
  sessionId?: string;
}

// === Helpers ===

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

function statusIcon(status: string) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'failed': return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case 'running': return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    case 'paused': return <AlertCircle className="h-3.5 w-3.5 text-yellow-500" />;
    case 'aborted': return <Square className="h-3.5 w-3.5 text-muted-foreground" />;
    default: return <Terminal className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

// === Component ===

export default function ExecutionPage() {
  const navigate = useNavigate();

  // From store (for live execution triggered from Plan page)
  const storeExecutionId = useAppStore((s) => s.execution.executionId);
  const storeStatus = useAppStore((s) => s.execution.status);
  const storeLogs = useAppStore((s) => s.execution.logs);
  const setExecutionStatus = useAppStore((s) => s.setExecutionStatus);
  const addExecutionLog = useAppStore((s) => s.addExecutionLog);
  const clearExecutionLogs = useAppStore((s) => s.clearExecutionLogs);
  const setExecutionId = useAppStore((s) => s.setExecutionId);

  // History list
  const [history, setHistory] = useState<ExecutionSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Active execution (from history click or store)
  const [activeId, setActiveId] = useState<string | null>(storeExecutionId);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  // Derive execution status
  const execStatus = detail?.status ?? storeStatus?.status ?? 'idle';
  const isRunning = execStatus === 'running';
  const isPaused = execStatus === 'paused';
  const isCompleted = execStatus === 'completed';
  const isFailed = execStatus === 'failed';
  const isAborted = execStatus === 'aborted';
  const isDone = isCompleted || isFailed || isAborted;

  // Build merged logs: use storeLogs for live execution, detail.logs for historical
  const displayLogs = activeId === storeExecutionId && storeLogs.length > 0
    ? storeLogs
    : (detail?.logs ?? []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayLogs]);

  // Load execution history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await apiGet<ExecutionSummary[]>('/execution/list');
      setHistory(data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Load execution detail
  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await apiGet<ExecutionDetail>(`/execution/${id}/status`);
      setDetail(data);
      setActiveId(id);
    } catch {
      // ignore
    }
  }, []);

  // When storeExecutionId changes (new execution triggered from Plan page), switch to it
  useEffect(() => {
    if (!storeExecutionId) return;
    setActiveId(storeExecutionId);
    setDetail(null);
  }, [storeExecutionId]);

  // Poll active execution
  useEffect(() => {
    if (!activeId) return;

    const poll = async () => {
      try {
        const data = await apiGet<ExecutionDetail>(`/execution/${activeId}/status`);

        // Update detail
        setDetail(data);

        // Also sync store if this is the live execution
        if (activeId === storeExecutionId) {
          setExecutionStatus({
            executionId: data.id,
            planId: data.planId,
            currentStep: data.currentStep,
            totalSteps: data.totalSteps,
            status: data.status as 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted',
            startedAt: data.startedAt,
            completedAt: data.completedAt,
          });

          // Add new logs to store for live display
          if (data.logs && data.logs.length > storeLogs.length) {
            const newLogs = data.logs.slice(storeLogs.length);
            for (const log of newLogs) {
              addExecutionLog({
                timestamp: new Date().toISOString(),
                stepIndex: data.currentStep,
                type: 'output',
                content: log,
              });
            }
          }
        }

        // Stop polling when done
        if (['completed', 'failed', 'aborted'].includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          loadHistory();
          setTimeout(() => replyInputRef.current?.focus(), 100);
        }
      } catch {
        // keep polling
      }
    };

    poll();
    pollRef.current = setInterval(poll, 1500);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeId, storeExecutionId, storeLogs.length, setExecutionStatus, addExecutionLog, loadHistory]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Auto-select the first (most recent) execution if no active one
  useEffect(() => {
    if (!activeId && history.length > 0) {
      loadDetail(history[0].id);
    }
  }, [activeId, history, loadDetail]);

  // === Actions ===

  const handlePause = async () => {
    if (!activeId) return;
    try { await apiPost(`/execution/${activeId}/pause`); } catch { /* handled via polling */ }
  };

  const handleRetry = async () => {
    if (!activeId) return;
    try { await apiPost(`/execution/${activeId}/retry-step`); } catch { /* handled via polling */ }
  };

  const handleSkip = async () => {
    if (!activeId) return;
    try { await apiPost(`/execution/${activeId}/skip-step`); } catch { /* handled via polling */ }
  };

  const handleAbort = async () => {
    if (!activeId) return;
    try { await apiPost(`/execution/${activeId}/abort`); } catch { /* handled via polling */ }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiGet<void>(`/execution/${id}`); // Will 404 if not supported, but DELETE is the real call
      // Actually call delete
      const res = await fetch(`/api/execution/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setHistory(prev => prev.filter(e => e.id !== id));
      if (activeId === id) {
        setDetail(null);
        setActiveId(null);
        setExecutionId(null);
      }
    } catch {
      // ignore
    }
  };

  const handleReply = async () => {
    if (!activeId || !replyText.trim() || replying) return;
    const message = replyText.trim();
    setReplying(true);
    setReplyText('');
    try {
      await apiPost(`/execution/${activeId}/reply`, { message });
    } catch (err) {
      addExecutionLog({
        timestamp: new Date().toISOString(),
        stepIndex: 0,
        type: 'error',
        content: `Reply failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    } finally {
      setReplying(false);
    }
  };

  const handleReExecute = () => {
    if (!detail?.planId) return;
    // Navigate to plan page with the plan selected
    navigate('/plan');
  };

  const statusConfig = {
    idle: { label: 'Idle', color: 'text-muted-foreground', bg: 'bg-muted' },
    running: { label: 'Running', color: 'text-blue-500', bg: 'bg-blue-500/10' },
    paused: { label: 'Paused', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    completed: { label: 'Completed', color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    failed: { label: 'Failed', color: 'text-destructive', bg: 'bg-destructive/10' },
    aborted: { label: 'Aborted', color: 'text-muted-foreground', bg: 'bg-muted' },
  };

  const cfg = statusConfig[execStatus] ?? statusConfig.idle;

  const logTypeColor = (type: string) => {
    switch (type) {
      case 'error': return 'text-red-400';
      case 'warning': return 'text-yellow-400';
      case 'info': return 'text-blue-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="flex h-full">
      {/* Left: Execution History */}
      <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Execution History
          </span>
          {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex-1 overflow-y-auto">
          {history.length === 0 && !loadingHistory && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
              <Terminal className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No executions yet</p>
            </div>
          )}

          {history.map((exec) => (
            <div
              key={exec.id}
              onClick={() => loadDetail(exec.id)}
              className={cn(
                'group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors',
                activeId === exec.id
                  ? 'bg-primary/5 border-l-2 border-l-primary'
                  : 'hover:bg-accent/50'
              )}
            >
              <div className="mt-0.5 shrink-0">{statusIcon(exec.status)}</div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate text-foreground">
                  {exec.planId.substring(0, 8)}...
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(exec.startedAt)}
                  </span>
                </div>
                {exec.workspacePath && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground/40 truncate font-mono">
                      {exec.workspacePath.split(/[/\\]/).pop()}
                    </span>
                  </div>
                )}
              </div>
              <button
                onClick={(e) => handleDelete(exec.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Execution Detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Execution</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isRunning ? 'Execution is in progress...' :
                 isDone ? `Execution ${execStatus}` :
                 activeId ? 'Monitor real-time progress' :
                 'Select an execution from history or start from Plan page'}
              </p>
            </div>

            {/* Status badge */}
            {activeId && (
              <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium', cfg.bg, cfg.color)}>
                {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isCompleted && <CheckCircle2 className="h-3.5 w-3.5" />}
                {isFailed && <XCircle className="h-3.5 w-3.5" />}
                {isPaused && <AlertCircle className="h-3.5 w-3.5" />}
                {cfg.label}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 p-6 gap-4">
          {/* No execution */}
          {!activeId && (
            <Card>
              <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                <Terminal className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No execution selected</p>
                <p className="text-xs text-muted-foreground/60">
                  Go to Plan page, confirm a plan to start execution, or select from history
                </p>
              </CardContent>
            </Card>
          )}

          {/* Progress bar */}
          {activeId && detail && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    Step {detail.currentStep} / {detail.totalSteps || '?'}
                  </span>
                  {detail.totalSteps > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {Math.round((detail.currentStep / detail.totalSteps) * 100)}%
                    </span>
                  )}
                </div>
                {detail.totalSteps > 0 && (
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        isCompleted ? 'bg-emerald-500' : isFailed ? 'bg-destructive' : 'bg-primary'
                      )}
                      style={{
                        width: `${(detail.currentStep / detail.totalSteps) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Controls */}
          {activeId && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePause}
                disabled={!isRunning}
              >
                <Pause className="h-4 w-4 mr-1.5" />
                Pause
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetry}
                disabled={!isPaused && !isFailed}
              >
                <RotateCcw className="h-4 w-4 mr-1.5" />
                Retry
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkip}
                disabled={!isPaused && !isFailed}
              >
                <SkipForward className="h-4 w-4 mr-1.5" />
                Skip
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAbort}
                disabled={isDone || (!isRunning && !isPaused)}
                className="text-destructive hover:text-destructive"
              >
                <Square className="h-4 w-4 mr-1.5" />
                Abort
              </Button>
              {isDone && detail?.planId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReExecute}
                  className="ml-1"
                >
                  <Play className="h-4 w-4 mr-1.5" />
                  Re-execute
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={clearExecutionLogs}
                className="ml-auto text-muted-foreground"
              >
                <Trash2 className="h-4 w-4 mr-1.5" />
                Clear
              </Button>
            </div>
          )}

          {/* Reply input */}
          {activeId && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Reply to Claude</span>
                  <span className="text-xs text-muted-foreground">
                    If Claude asks questions during execution, answer here
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
                    rows={2}
                    disabled={isRunning}
                    className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                  />
                  <Button
                    onClick={handleReply}
                    disabled={!replyText.trim() || replying || isRunning}
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
                {isRunning && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Claude is working... reply will be available when it pauses or asks a question
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Log output */}
          {activeId && (
            <div className="flex-1 min-h-0 rounded-lg border border-border bg-gray-950 dark:bg-gray-950 overflow-hidden flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-gray-900/50">
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground font-mono">Output</span>
                {isRunning && (
                  <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 font-mono text-xs">
                {displayLogs.length === 0 ? (
                  <div className="text-gray-500 text-center py-8">
                    {activeId ? 'Waiting for output...' : 'No output yet'}
                  </div>
                ) : (
                  displayLogs.map((entry, i) => {
                    // Handle both string logs and ExecutionLogEntry objects
                    const isObj = typeof entry === 'object' && 'content' in entry;
                    const content = isObj ? (entry as { content: string }).content : String(entry);
                    const type = isObj ? (entry as { type: string }).type : 'output';
                    const stepIndex = isObj ? (entry as { stepIndex: number }).stepIndex : 0;
                    const timestamp = isObj ? (entry as { timestamp: string }).timestamp : '';

                    return (
                      <div key={i} className={cn('py-0.5 leading-relaxed', logTypeColor(type))}>
                        {timestamp && (
                          <span className="text-gray-600 mr-2 select-none">
                            {new Date(timestamp).toLocaleTimeString()}
                          </span>
                        )}
                        {stepIndex > 0 && (
                          <span className="text-gray-500 mr-2 select-none">[Step {stepIndex}]</span>
                        )}
                        <span>{content}</span>
                      </div>
                    );
                  })
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          {/* Completion summary */}
          {isDone && detail && (
            <Card className={cn(
              'border',
              isCompleted ? 'border-emerald-500/30 bg-emerald-500/5' :
              isFailed ? 'border-destructive/30 bg-destructive/5' :
              'border-border'
            )}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  {isCompleted ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : isFailed ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <h3 className="text-sm font-semibold">
                    Execution {isCompleted ? 'Completed' : isFailed ? 'Failed' : 'Aborted'}
                  </h3>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Steps</p>
                    <p className="font-medium">
                      {detail.currentStep} / {detail.totalSteps}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Started</p>
                    <p className="font-medium text-xs">
                      {new Date(detail.startedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  {detail.completedAt && (
                    <div>
                      <p className="text-xs text-muted-foreground">Completed</p>
                      <p className="font-medium text-xs">
                        {new Date(detail.completedAt).toLocaleTimeString()}
                      </p>
                    </div>
                  )}
                </div>
                {isCompleted && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => navigate(`/tests?executionId=${detail.id}`)}
                    >
                      <TestTube className="h-4 w-4 mr-1.5" />
                      Run Tests
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
