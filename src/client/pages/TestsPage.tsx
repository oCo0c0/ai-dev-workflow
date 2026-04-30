import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Play,
  CheckCircle2,
  XCircle,
  SkipForward,
  Loader2,
  TestTube,
  Scan,
  AlertCircle,
  Trash2,
  Clock,
  FolderOpen,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Terminal,
  Link,
  Zap,
} from 'lucide-react';

// === Types ===

interface TestFrameworkInfo {
  name: string;
  detected: boolean;
  configFile?: string;
  command: string;
}

interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
}

interface TestSuite {
  name: string;
  tests: TestCase[];
}

interface TestResults {
  framework: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  coverage?: number;
  suites: TestSuite[];
}

interface TestRunSummary {
  id: string;
  status: 'running' | 'completed' | 'failed';
  mode: 'manual' | 'pipeline_run_existing' | 'pipeline_ai_generate';
  framework?: string;
  workspacePath: string;
  startedAt: string;
  completedAt?: string;
  executionId?: string;
  pipelineId?: string;
  totalTests?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
}

interface TestRunDetail extends TestRunSummary {
  results?: TestResults;
  rawOutput?: string;
  error?: string;
}

interface ExecutionSummary {
  id: string;
  planId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  startedAt: string;
  completedAt?: string;
  workspacePath?: string;
}

interface PipelineInfo {
  id: string;
  name: string;
  steps?: {
    testStrategy?: {
      mode: 'ai_generate' | 'run_existing';
      framework?: string;
      command?: string;
      autoRunAfterExecution: boolean;
    };
  };
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
    default: return <TestTube className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function modeLabel(mode: string) {
  switch (mode) {
    case 'pipeline_ai_generate': return 'AI Test';
    case 'pipeline_run_existing': return 'Pipeline';
    case 'manual': return 'Manual';
    default: return mode;
  }
}

function modeBadgeVariant(mode: string): 'default' | 'secondary' | 'outline' {
  switch (mode) {
    case 'pipeline_ai_generate': return 'default';
    case 'pipeline_run_existing': return 'secondary';
    default: return 'outline';
  }
}

function testCaseStatusIcon(status: string) {
  switch (status) {
    case 'passed': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'failed': return <XCircle className="h-4 w-4 text-red-500" />;
    case 'skipped': return <SkipForward className="h-4 w-4 text-amber-500" />;
    default: return null;
  }
}

// === Component ===

export default function TestsPage() {
  const [searchParams] = useSearchParams();
  const currentWorkspace = useAppStore((s) => s.workspace.current);

  // History list
  const [history, setHistory] = useState<TestRunSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Active test run
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TestRunDetail | null>(null);
  const [frameworks, setFrameworks] = useState<TestFrameworkInfo[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'skipped'>('all');
  const [showRawOutput, setShowRawOutput] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Execution context (linked from Execution page or manual selection)
  const [linkedExecution, setLinkedExecution] = useState<ExecutionSummary | null>(null);
  const [pipelineInfo, setPipelineInfo] = useState<PipelineInfo | null>(null);
  const [executionList, setExecutionList] = useState<ExecutionSummary[]>([]);
  const [showExecSelector, setShowExecSelector] = useState(false);

  // Resolve effective workspace: linked execution > store workspace
  const effectiveWorkspace = linkedExecution?.workspacePath || currentWorkspace?.path || '';

  // Load execution context from URL param on mount
  useEffect(() => {
    const execId = searchParams.get('executionId');
    if (!execId) return;

    apiGet<ExecutionSummary>(`/execution/${execId}/status`)
      .then((exec) => {
        if (exec.status === 'completed') {
          setLinkedExecution(exec);
          // Try to load pipeline info for test strategy
          apiGet<{ pipelineId?: string }>(`/plan/${exec.planId}`)
            .then((plan) => {
              if (plan.pipelineId) {
                // Get pipeline from list (no GET /:id endpoint)
                return apiGet<PipelineInfo[]>('/pipelines').then((list) => {
                  const found = list.find(p => p.id === plan.pipelineId);
                  if (found) setPipelineInfo(found);
                  return null;
                });
              }
              return null;
            })
            .catch(() => {});

          // Auto-detect frameworks for this workspace
          if (exec.workspacePath) {
            apiGet<TestFrameworkInfo[]>(
              `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
            ).then(setFrameworks).catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [searchParams]);

  // Load execution list for selector
  const loadExecutions = useCallback(async () => {
    try {
      const data = await apiGet<ExecutionSummary[]>('/execution/list');
      setExecutionList(data.filter(e => e.status === 'completed'));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadExecutions();
  }, [loadExecutions]);

  // Load history
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const data = await apiGet<TestRunSummary[]>('/tests/list');
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

  // Load detail
  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await apiGet<TestRunDetail>(`/tests/results/${id}`);
      setDetail(data);
      setActiveId(id);
      setError(null);
    } catch {
      // ignore
    }
  }, []);

  // Auto-select first history item
  useEffect(() => {
    if (!activeId && history.length > 0) {
      loadDetail(history[0].id);
    }
  }, [activeId, history, loadDetail]);

  // Poll active test run
  useEffect(() => {
    if (!activeId) return;
    const current = history.find(h => h.id === activeId);
    if (current?.status !== 'running') return;

    const poll = async () => {
      try {
        const data = await apiGet<TestRunDetail>(`/tests/results/${activeId}`);
        setDetail(data);
        if (['completed', 'failed'].includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          loadHistory();
        }
      } catch {
        // keep polling
      }
    };

    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeId, history, loadHistory]);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // === Actions ===

  const detectFrameworks = async () => {
    if (!effectiveWorkspace) return;
    setDetecting(true);
    setError(null);
    try {
      const data = await apiGet<TestFrameworkInfo[]>(
        `/tests/detect?workspacePath=${encodeURIComponent(effectiveWorkspace)}`
      );
      setFrameworks(data);
      if (data.every((f) => !f.detected)) {
        setError('No test framework detected in this workspace.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to detect frameworks');
    } finally {
      setDetecting(false);
    }
  };

  const runTests = async (framework?: string) => {
    if (!effectiveWorkspace) return;
    setRunning(true);
    setError(null);
    try {
      const body: Record<string, string> = {
        workspacePath: effectiveWorkspace,
        mode: linkedExecution ? 'pipeline_run_existing' : 'manual',
      };
      if (framework) body.framework = framework;
      if (linkedExecution) body.executionId = linkedExecution.id;
      if (pipelineInfo) body.pipelineId = pipelineInfo.id;
      const { taskId } = await apiPost<{ taskId: string }>('/tests/run', body);
      setActiveId(taskId);
      setDetail({
        id: taskId,
        status: 'running',
        mode: linkedExecution ? 'pipeline_run_existing' : 'manual',
        framework,
        workspacePath: effectiveWorkspace,
        executionId: linkedExecution?.id,
        pipelineId: pipelineInfo?.id,
        startedAt: new Date().toISOString(),
      });
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run tests');
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiGet<void>(`/tests/${id}`);
      const res = await fetch(`/api/tests/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setHistory(prev => prev.filter(h => h.id !== id));
      if (activeId === id) {
        setDetail(null);
        setActiveId(null);
      }
    } catch {
      // ignore
    }
  };

  // Filtered suites
  const filteredSuites = detail?.results?.suites.map((suite) => ({
    ...suite,
    tests: suite.tests.filter((t) => filter === 'all' || t.status === filter),
  })).filter((suite) => suite.tests.length > 0);

  return (
    <div className="flex h-full">
      {/* Left: Test History */}
      <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Test History
          </span>
          {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex-1 overflow-y-auto">
          {history.length === 0 && !loadingHistory && (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
              <TestTube className="h-7 w-7 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No test runs yet</p>
            </div>
          )}

          {history.map((run) => (
            <div
              key={run.id}
              onClick={() => loadDetail(run.id)}
              className={cn(
                'group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-b border-border/50 transition-colors',
                activeId === run.id
                  ? 'bg-primary/5 border-l-2 border-l-primary'
                  : 'hover:bg-accent/50'
              )}
            >
              <div className="mt-0.5 shrink-0">{statusIcon(run.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Badge variant={modeBadgeVariant(run.mode)} className="text-[10px] px-1.5 py-0">
                    {modeLabel(run.mode)}
                  </Badge>
                  {run.framework && (
                    <span className="text-xs text-muted-foreground truncate">{run.framework}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                </div>
                {run.workspacePath && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FolderOpen className="h-3 w-3 text-muted-foreground/40" />
                    <span className="text-xs text-muted-foreground/40 truncate font-mono">
                      {run.workspacePath.split(/[/\\]/).pop()}
                    </span>
                  </div>
                )}
                {run.status === 'completed' && run.totalTests !== undefined && (
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-emerald-500">{run.passed} pass</span>
                    {(run.failed ?? 0) > 0 && <span className="text-red-500">{run.failed} fail</span>}
                    {(run.skipped ?? 0) > 0 && <span className="text-amber-500">{run.skipped} skip</span>}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => handleDelete(run.id, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Test Detail */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with actions */}
        <div className="border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">Tests</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {detail?.status === 'running' ? 'Tests are running...' :
                 detail ? 'Test results' :
                 'Run tests manually or via pipeline execution'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={detectFrameworks}
                disabled={!effectiveWorkspace || detecting}
              >
                {detecting ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Scan className="h-4 w-4 mr-1.5" />
                )}
                Detect
              </Button>
              <Button
                size="sm"
                onClick={() => runTests()}
                disabled={!effectiveWorkspace || running}
              >
                {running ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1.5" />
                )}
                Run Tests
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowExecSelector(!showExecSelector)}
              >
                <Link className="h-4 w-4 mr-1.5" />
                Link Execution
              </Button>
              {!effectiveWorkspace && (
                <span className="text-xs text-muted-foreground">Select a workspace or link an execution</span>
              )}
            </div>
          </div>

          {/* Linked execution context */}
          {linkedExecution && (
            <div className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
              <Link className="h-4 w-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">Linked Execution</p>
                <p className="text-xs text-muted-foreground font-mono truncate">
                  {linkedExecution.workspacePath || linkedExecution.id}
                </p>
              </div>
              {pipelineInfo?.steps?.testStrategy && (
                <Badge variant="secondary" className="text-[10px]">
                  <Zap className="h-3 w-3 mr-0.5" />
                  {pipelineInfo.steps.testStrategy.mode === 'ai_generate' ? 'AI Generate' : 'Run Existing'}
                </Badge>
              )}
              <button
                onClick={() => { setLinkedExecution(null); setPipelineInfo(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Unlink
              </button>
            </div>
          )}

          {/* Execution selector */}
          {showExecSelector && (
            <div className="mt-3 border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
              <div className="px-3 py-2 bg-muted/30 border-b border-border">
                <p className="text-xs font-medium text-muted-foreground">Select a completed execution</p>
              </div>
              {executionList.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <p className="text-xs text-muted-foreground">No completed executions found</p>
                </div>
              ) : (
                executionList.map((exec) => (
                  <div
                    key={exec.id}
                    onClick={async () => {
                      setLinkedExecution(exec);
                      setShowExecSelector(false);
                      // Auto-detect frameworks for this workspace
                      if (exec.workspacePath) {
                        try {
                          const fw = await apiGet<TestFrameworkInfo[]>(
                            `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
                          );
                          setFrameworks(fw);
                        } catch { /* ignore */ }
                      }
                    }}
                    className={cn(
                      'px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-accent/50 transition-colors',
                      linkedExecution?.id === exec.id && 'bg-primary/5'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground">{exec.id.substring(0, 8)}...</span>
                      <Clock className="h-3 w-3 text-muted-foreground/50 ml-auto" />
                      <span className="text-xs text-muted-foreground/60">{formatRelativeTime(exec.startedAt)}</span>
                    </div>
                    {exec.workspacePath && (
                      <p className="text-xs text-muted-foreground/50 font-mono mt-0.5 truncate pl-5">
                        {exec.workspacePath}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Detected frameworks */}
          {frameworks.length > 0 && (
            <div className="mt-3 flex gap-2 flex-wrap">
              {frameworks.map((fw) => (
                <Badge
                  key={fw.name}
                  variant={fw.detected ? 'success' : 'secondary'}
                  className="px-3 py-1 cursor-pointer"
                  onClick={() => fw.detected && runTests(fw.name)}
                >
                  {fw.detected ? (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  ) : (
                    <XCircle className="h-3 w-3 mr-1" />
                  )}
                  {fw.name}
                  {fw.configFile && (
                    <span className="ml-1 opacity-60">({fw.configFile})</span>
                  )}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Error */}
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Running indicator */}
          {detail?.status === 'running' && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                  <span className="text-sm font-medium">
                    {detail.mode === 'pipeline_ai_generate' ? 'AI is generating and running tests...' : 'Tests are running...'}
                  </span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-3">
                  <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Detail error */}
          {detail?.error && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
              <p className="text-sm text-destructive">{detail.error}</p>
            </div>
          )}

          {/* Results summary */}
          {detail?.results && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-5 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold">{detail.results.totalTests}</p>
                    <p className="text-xs text-muted-foreground mt-1">Total</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-500/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-emerald-500">{detail.results.passed}</p>
                    <p className="text-xs text-muted-foreground mt-1">Passed</p>
                  </CardContent>
                </Card>
                <Card className="border-red-500/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-red-500">{detail.results.failed}</p>
                    <p className="text-xs text-muted-foreground mt-1">Failed</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-500/20">
                  <CardContent className="p-4 text-center">
                    <p className="text-2xl font-bold text-amber-500">{detail.results.skipped}</p>
                    <p className="text-xs text-muted-foreground mt-1">Skipped</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm font-medium">{detail.results.framework}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {(detail.results.duration / 1000).toFixed(2)}s
                      {detail.results.coverage !== undefined && ` · ${detail.results.coverage}%`}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Filter Tabs */}
              <div className="flex gap-1 p-1 bg-secondary rounded-lg w-fit">
                {(['all', 'passed', 'failed', 'skipped'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      filter === f
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              {/* Test Suites */}
              <div className="space-y-2">
                {filteredSuites?.map((suite) => (
                  <Card key={suite.name}>
                    <div className="px-4 py-2.5 border-b border-border">
                      <h4 className="text-sm font-medium">{suite.name}</h4>
                    </div>
                    <div className="divide-y divide-border">
                      {suite.tests.map((test, i) => (
                        <div key={i} className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            {testCaseStatusIcon(test.status)}
                            <span className="text-sm flex-1">{test.name}</span>
                            <span className="text-xs text-muted-foreground font-mono">
                              {test.duration}ms
                            </span>
                          </div>
                          {test.error && (
                            <pre className="mt-2 text-xs text-red-400 bg-red-500/5 border border-red-500/10 rounded-md p-2 overflow-x-auto font-mono">
                              {test.error}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Raw Output (for AI mode or any run) */}
          {detail?.rawOutput && (
            <div className="mt-4">
              <button
                onClick={() => setShowRawOutput(!showRawOutput)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showRawOutput ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Raw Output
                {detail.mode === 'pipeline_ai_generate' && (
                  <Sparkles className="h-3 w-3 text-primary" />
                )}
              </button>
              {showRawOutput && (
                <div className="mt-2 rounded-lg border border-border bg-gray-950 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-gray-900/50">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground font-mono">Output</span>
                  </div>
                  <div className="max-h-96 overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {detail.rawOutput}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!detail && !error && (
            <Card>
              <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                <TestTube className="h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No test results yet</p>
                <p className="text-xs text-muted-foreground/60">
                  Run tests manually or trigger a Pipeline to see results here
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
