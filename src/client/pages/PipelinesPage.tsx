import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost, apiPut, apiDelete, pickFolder } from '../api';
import { useAppStore } from '../stores/app-store';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { FolderPickerModal } from '../components/FolderPickerModal';
import {
  Plus,
  Trash2,
  Star,
  Save,
  X,
  GitBranch,
  Loader2,
  AlertTriangle,
  Workflow,
  FolderOpen,
  Play,
  ChevronRight,
  ChevronLeft,
  FileText,
  CheckCircle2,
  FolderSearch,
  Clock,
  BookOpen,
  Download,
} from 'lucide-react';

interface PipelineStepConfig {
  requirementSource: { type: string; mcpServerName?: string };
  workspace: { boundPath?: string };
  planSkills?: { mode: string; selectedSkills: string[] };
  executionSkills?: { mode: string; selectedSkills: string[] };
  testSkills?: { mode: string; selectedSkills: string[] };
  skillSet?: { mode: string; selectedSkills: string[] }; // legacy
  mcpToolSet: { mode: string; selectedServers: string[] };
  testStrategy: {
    mode: 'ai_generate' | 'run_existing';
    framework?: string;
    command?: string;
    autoRunAfterExecution: boolean;
  };
}

interface Pipeline {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  steps: PipelineStepConfig;
}

interface MCPServerConfig {
  name: string;
  enabled: boolean;
}

interface Skill {
  name: string;
}

interface StoredRequirement {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  description: string;
  savedAt: string;
  source: string;
}

// ─── Execution Wizard ────────────────────────────────────────────────────────

interface WizardState {
  pipeline: Pipeline;
  step: 1 | 2 | 3;
  // Step 1
  selectedRequirement: StoredRequirement | null;
  manualRequirementText: string;
  fetchId: string;
  fetchError: string | null;
  fetching: boolean;
  savedRequirements: StoredRequirement[];
  loadingSaved: boolean;
  // Step 2
  workspacePath: string;
  workspaceHistory: string[];
  loadingHistory: boolean;
  folderPickerOpen: boolean;
  // Step 3
  starting: boolean;
  startError: string | null;
}

interface ExecutionWizardProps {
  pipeline: Pipeline;
  onClose: () => void;
  savedWorkspaces: { id: string; name: string; path: string }[];
}

function ExecutionWizard({ pipeline, onClose, savedWorkspaces }: ExecutionWizardProps) {
  const navigate = useNavigate();
  const setSelectedRequirement = useAppStore((s) => s.setSelectedRequirement);
  const setPlanTaskId = useAppStore((s) => s.setPlanTaskId);
  const setPlanStatus = useAppStore((s) => s.setPlanStatus);
  const isManual = pipeline.steps?.requirementSource?.type === 'manual';
  const boundPath = pipeline.steps?.workspace?.boundPath;
  const mcpServerName = pipeline.steps?.requirementSource?.mcpServerName;

  const [state, setState] = useState<WizardState>({
    pipeline,
    step: 1,
    selectedRequirement: null,
    manualRequirementText: '',
    fetchId: '',
    fetchError: null,
    fetching: false,
    savedRequirements: [],
    loadingSaved: false,
    workspacePath: boundPath || '',
    workspaceHistory: [],
    loadingHistory: false,
    folderPickerOpen: false,
    starting: false,
    startError: null,
  });

  const update = (patch: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  // Load saved requirements on mount (step 1)
  useEffect(() => {
    if (!isManual) {
      update({ loadingSaved: true });
      apiGet<StoredRequirement[]>('/requirements/saved')
        .then((data) => update({ savedRequirements: data, loadingSaved: false }))
        .catch(() => update({ loadingSaved: false }));
    }
  }, [isManual]);

  // Load workspace history when entering step 2
  useEffect(() => {
    if (state.step === 2 && !boundPath) {
      update({ loadingHistory: true });
      apiGet<string[]>('/workspace/history')
        .then((data) => update({ workspaceHistory: data, loadingHistory: false }))
        .catch(() => update({ loadingHistory: false }));
    }
  }, [state.step, boundPath]);

  const handleFetchRequirement = async () => {
    if (!state.fetchId.trim()) return;
    update({ fetching: true, fetchError: null });
    try {
      const req = await apiPost<StoredRequirement>('/requirements/fetch', {
        id: state.fetchId.trim(),
        ...(mcpServerName ? { mcpServerName } : {}),
      });
      update({
        fetching: false,
        selectedRequirement: req,
        fetchId: '',
        savedRequirements: [req, ...state.savedRequirements.filter((r) => r.id !== req.id)],
      });
    } catch (err) {
      update({
        fetching: false,
        fetchError: err instanceof Error ? err.message : 'Failed to fetch requirement',
      });
    }
  };

  const handleBrowse = async () => {
    const path = await pickFolder('Select Workspace Folder');
    if (path) {
      update({ workspacePath: path });
    } else {
      update({ folderPickerOpen: true });
    }
  };

  const canProceedStep1 = isManual
    ? state.manualRequirementText.trim().length > 0
    : state.selectedRequirement !== null;

  const canProceedStep2 = state.workspacePath.trim().length > 0;

  const handleNext = () => {
    if (state.step === 1 && canProceedStep1) update({ step: 2 });
    else if (state.step === 2 && canProceedStep2) update({ step: 3 });
  };

  const handleBack = () => {
    if (state.step === 2) update({ step: 1 });
    else if (state.step === 3) update({ step: 2 });
  };

  const handleStart = async () => {
    update({ starting: true, startError: null });
    try {
      const requirementId = isManual ? undefined : state.selectedRequirement?.id;

      const result = await apiPost<{ taskId: string }>('/plan/generate', {
        requirementId,
        workspacePath: state.workspacePath,
        pipelineId: pipeline.id,  // Pass pipeline ID for skill resolution
        ...(isManual ? { requirementText: state.manualRequirementText } : {}),
      });

      // Store taskId and set status to generating
      setPlanTaskId(result.taskId);
      setPlanStatus('generating');

      // Save fetched requirement to store
      if (!isManual && state.selectedRequirement) {
        setSelectedRequirement(state.selectedRequirement as Parameters<typeof setSelectedRequirement>[0]);
      }

      navigate('/plan');
    } catch (err) {
      update({
        starting: false,
        startError: err instanceof Error ? err.message : 'Failed to start pipeline',
      });
    }
  };

  const stepLabels = ['Select Requirement', 'Confirm Workspace', 'Review & Start'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">Run Pipeline</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{pipeline.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0 px-5 py-3 border-b border-border bg-muted/20">
          {stepLabels.map((label, i) => {
            const stepNum = (i + 1) as 1 | 2 | 3;
            const isActive = state.step === stepNum;
            const isDone = state.step > stepNum;
            return (
              <div key={i} className="flex items-center flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className={cn(
                      'flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 transition-colors',
                      isActive && 'bg-primary text-primary-foreground',
                      isDone && 'bg-emerald-500 text-white',
                      !isActive && !isDone && 'bg-muted text-muted-foreground'
                    )}
                  >
                    {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : stepNum}
                  </div>
                  <span
                    className={cn(
                      'text-xs truncate',
                      isActive ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {label}
                  </span>
                </div>
                {i < stepLabels.length - 1 && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 mx-2 shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Step 1: Select Requirement ── */}
          {state.step === 1 && (
            <div className="space-y-4">
              {isManual ? (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Requirement Text
                  </label>
                  <textarea
                    value={state.manualRequirementText}
                    onChange={(e) => update({ manualRequirementText: e.target.value })}
                    placeholder="Paste or type the requirement description here..."
                    rows={8}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  />
                </div>
              ) : (
                <>
                  {/* Fetch by ID */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Fetch by ID / Number
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          value={state.fetchId}
                          onChange={(e) => update({ fetchId: e.target.value })}
                          onKeyDown={(e) => e.key === 'Enter' && handleFetchRequirement()}
                          placeholder="e.g. #302 or HRL2p8rTX4mQ9xMv"
                          className="pl-9"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={handleFetchRequirement}
                        disabled={state.fetching || !state.fetchId.trim()}
                      >
                        {state.fetching ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    {state.fetchError && (
                      <p className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {state.fetchError}
                      </p>
                    )}
                  </div>

                  {/* Saved requirements list */}
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      Saved Requirements
                    </label>
                    {state.loadingSaved ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : state.savedRequirements.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-lg border border-dashed border-border">
                        <FileText className="h-7 w-7 text-muted-foreground/30" />
                        <p className="text-xs text-muted-foreground">No saved requirements</p>
                        <p className="text-xs text-muted-foreground/60">Fetch one using the field above</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                        {state.savedRequirements.map((req) => (
                          <div
                            key={req.id}
                            onClick={() =>
                              update({
                                selectedRequirement:
                                  state.selectedRequirement?.id === req.id ? null : req,
                              })
                            }
                            className={cn(
                              'flex items-start gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition-all',
                              state.selectedRequirement?.id === req.id
                                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                : 'border-border hover:border-primary/40 hover:bg-accent/30'
                            )}
                          >
                            <div
                              className={cn(
                                'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                                state.selectedRequirement?.id === req.id
                                  ? 'border-primary bg-primary'
                                  : 'border-muted-foreground/40'
                              )}
                            >
                              {state.selectedRequirement?.id === req.id && (
                                <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{req.title}</p>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{req.id}</span>
                                <span className="text-xs text-muted-foreground/60">·</span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground/60">
                                  <Clock className="h-3 w-3" />
                                  {new Date(req.savedAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Confirm Workspace ── */}
          {state.step === 2 && (
            <div className="space-y-4">
              {boundPath ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      Workspace bound to pipeline
                    </span>
                  </div>
                  <p className="text-xs font-mono text-muted-foreground break-all">{boundPath}</p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    Select Workspace
                  </label>
                  <select
                    value={state.workspacePath}
                    onChange={(e) => update({ workspacePath: e.target.value })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Select a workspace --</option>
                    {savedWorkspaces.map((ws) => (
                      <option key={ws.id} value={ws.path}>{ws.name}</option>
                    ))}
                  </select>
                  {savedWorkspaces.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      No saved workspaces. Go to Workspace page to add one first.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Review & Start ── */}
          {state.step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border">
                {/* Requirement summary */}
                <div className="px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Requirement</p>
                  {isManual ? (
                    <p className="text-sm text-foreground line-clamp-3 whitespace-pre-wrap">
                      {state.manualRequirementText}
                    </p>
                  ) : state.selectedRequirement ? (
                    <div>
                      <p className="text-sm font-medium">{state.selectedRequirement.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{state.selectedRequirement.id}</p>
                    </div>
                  ) : null}
                </div>

                {/* Workspace summary */}
                <div className="px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Workspace</p>
                  <div className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-mono break-all">{state.workspacePath}</span>
                  </div>
                </div>

                {/* Pipeline summary */}
                <div className="px-4 py-3">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Pipeline</p>
                  <p className="text-sm font-medium">{pipeline.name}</p>
                  {pipeline.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{pipeline.description}</p>
                  )}
                </div>
              </div>

              {state.startError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {state.startError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/10">
          <Button
            variant="outline"
            size="sm"
            onClick={state.step === 1 ? onClose : handleBack}
          >
            {state.step === 1 ? (
              <>
                <X className="h-4 w-4 mr-1" />
                Cancel
              </>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </>
            )}
          </Button>

          {state.step < 3 ? (
            <Button
              size="sm"
              onClick={handleNext}
              disabled={state.step === 1 ? !canProceedStep1 : !canProceedStep2}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleStart} disabled={state.starting}>
              {state.starting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-1.5" />
                  Start Pipeline
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function getDefaultCommand(framework: string): string {
  const map: Record<string, string> = {
    'junit': 'mvn test',
    'junit-gradle': './gradlew test',
    'jest': 'npm test',
    'vitest': 'npx vitest run',
    'playwright': 'npx playwright test',
    'pytest': 'pytest',
  };
  return map[framework] || '';
}

const defaultSteps: PipelineStepConfig = {
  requirementSource: { type: 'ones' },
  workspace: {},
  planSkills: { mode: 'all', selectedSkills: [] },
  executionSkills: { mode: 'all', selectedSkills: [] },
  testSkills: { mode: 'all', selectedSkills: [] },
  mcpToolSet: { mode: 'all', selectedServers: [] },
  testStrategy: { mode: 'ai_generate', autoRunAfterExecution: true },
};

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selected, setSelected] = useState<Pipeline | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [wizardPipeline, setWizardPipeline] = useState<Pipeline | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formSteps, setFormSteps] = useState<PipelineStepConfig>(defaultSteps);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [savedWorkspaces, setSavedWorkspaces] = useState<{ id: string; name: string; path: string }[]>([]);

  // Load saved workspaces for dropdown
  useEffect(() => {
    apiGet<{ id: string; name: string; path: string }[]>('/workspace/saved')
      .then(setSavedWorkspaces)
      .catch(() => {});
  }, []);

  const fetchPipelines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<Pipeline[]>('/pipelines');
      setPipelines(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch pipelines';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDependencies = useCallback(async () => {
    try {
      const [servers, skillList] = await Promise.all([
        apiGet<MCPServerConfig[]>('/mcp-servers').catch(() => []),
        apiGet<Skill[]>('/skills').catch(() => []),
      ]);
      setMcpServers(servers);
      setSkills(skillList);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
    fetchDependencies();
  }, [fetchPipelines, fetchDependencies]);

  const startCreate = () => {
    setCreating(true);
    setEditing(false);
    setSelected(null);
    setFormName('');
    setFormDescription('');
    setFormSteps(defaultSteps);
  };

  const startEdit = (pipeline: Pipeline) => {
    setSelected(pipeline);
    setEditing(true);
    setCreating(false);
    setFormName(pipeline.name);
    setFormDescription(pipeline.description);
    setFormSteps(pipeline.steps || defaultSteps);
  };

  const cancelForm = () => {
    setCreating(false);
    setEditing(false);
  };

  const handleSave = async () => {
    const payload = {
      name: formName.trim(),
      description: formDescription.trim(),
      steps: formSteps,
    };

    try {
      if (creating) {
        await apiPost('/pipelines', payload);
      } else if (editing && selected) {
        await apiPut(`/pipelines/${selected.id}`, payload);
      }
      cancelForm();
      fetchPipelines();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save pipeline';
      setError(msg);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this pipeline?')) return;
    try {
      await apiDelete(`/pipelines/${id}`);
      if (selected?.id === id) { setSelected(null); setEditing(false); }
      fetchPipelines();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete pipeline';
      setError(msg);
    }
  };

  const setDefault = async (id: string) => {
    try {
      await apiPost(`/pipelines/${id}/set-default`);
      fetchPipelines();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to set default';
      setError(msg);
    }
  };

  const getMissingDeps = (steps: PipelineStepConfig) => {
    const missing: string[] = [];
    if (steps.requirementSource.mcpServerName) {
      const exists = mcpServers.some((s) => s.name === steps.requirementSource.mcpServerName);
      if (!exists) missing.push(steps.requirementSource.mcpServerName);
    }
    if (steps.mcpToolSet.mode === 'selected') {
      steps.mcpToolSet.selectedServers.forEach((name) => {
        if (!mcpServers.some((s) => s.name === name)) missing.push(name);
      });
    }
    return [...new Set(missing)];
  };

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Pipeline List */}
        <div className="w-72 flex flex-col flex-shrink-0">
          <Button onClick={startCreate} className="w-full mb-3" size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Pipeline
          </Button>
          <div className="flex-1 overflow-y-auto space-y-2">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && pipelines.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Workflow className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">No pipelines yet</p>
              </div>
            )}
            {pipelines.map((pipeline) => {
              const missing = getMissingDeps(pipeline.steps || defaultSteps);
              return (
                <Card
                  key={pipeline.id}
                  className={cn(
                    'cursor-pointer transition-all duration-150 hover:border-primary/50',
                    selected?.id === pipeline.id && 'border-primary ring-1 ring-primary/20'
                  )}
                  onClick={() => startEdit(pipeline)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium flex-1 truncate">{pipeline.name}</span>
                      {pipeline.isDefault && (
                        <Badge variant="default" className="text-[10px]">
                          <Star className="h-3 w-3 mr-0.5" />
                          Default
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{pipeline.description}</p>
                    {missing.length > 0 && (
                      <div className="flex items-center gap-1 mt-1.5">
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                        <span className="text-xs text-amber-500">Missing: {missing.join(', ')}</span>
                      </div>
                    )}
                    <div className="mt-2.5 flex gap-2 flex-wrap">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={(e) => { e.stopPropagation(); setWizardPipeline(pipeline); }}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Run
                      </Button>
                      {!pipeline.isDefault && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={(e) => { e.stopPropagation(); setDefault(pipeline.id); }}
                        >
                          <Star className="h-3 w-3 mr-1" />
                          Set Default
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); handleDelete(pipeline.id); }}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Form */}
        {(creating || editing) && (
          <Card className="flex-1 overflow-y-auto">
            <div className="p-4">
              <h3 className="text-sm font-medium mb-4">
                {creating ? 'Create Pipeline' : `Edit: ${selected?.name}`}
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
                  <Input value={formName} onChange={(e) => setFormName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">Description</label>
                  <Input value={formDescription} onChange={(e) => setFormDescription(e.target.value)} />
                </div>

                {/* Requirement Source */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-medium mb-2">Requirement Source</h4>
                  <select
                    value={formSteps.requirementSource.type}
                    onChange={(e) => setFormSteps({
                      ...formSteps,
                      requirementSource: { ...formSteps.requirementSource, type: e.target.value },
                    })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="ones">ONES</option>
                    <option value="jira">Jira</option>
                    <option value="gitlab">GitLab</option>
                    <option value="manual">Manual</option>
                  </select>
                  {formSteps.requirementSource.type !== 'manual' && (
                    <div className="mt-2">
                      <label className="block text-xs text-muted-foreground mb-1">MCP Server</label>
                      <select
                        value={formSteps.requirementSource.mcpServerName || ''}
                        onChange={(e) => setFormSteps({
                          ...formSteps,
                          requirementSource: { ...formSteps.requirementSource, mcpServerName: e.target.value || undefined },
                        })}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">-- Select --</option>
                        {mcpServers.map((s) => (
                          <option key={s.name} value={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* Workspace */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-medium mb-2">Workspace</h4>
                  <select
                    value={formSteps.workspace.boundPath || ''}
                    onChange={(e) => setFormSteps({
                      ...formSteps,
                      workspace: { boundPath: e.target.value || undefined },
                    })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">-- Not bound (select at runtime) --</option>
                    {savedWorkspaces.map((ws) => (
                      <option key={ws.id} value={ws.path}>{ws.name} ({ws.path})</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a saved workspace, or leave empty to choose at runtime
                  </p>
                </div>

                {/* Skill Sets - Per Phase */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-medium mb-3">Skills per Phase</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Configure which skills Claude uses in each phase. Skills contain instructions that guide Claude's behavior.
                  </p>

                  {/* Helper to render a skill selector for a phase */}
                  {(['plan', 'execution', 'test'] as const).map((phase) => {
                    const phaseKey = `${phase}Skills` as 'planSkills' | 'executionSkills' | 'testSkills';
                    const phaseConfig = formSteps[phaseKey] ?? { mode: 'all', selectedSkills: [] };
                    const phaseLabel = phase === 'plan' ? 'Plan Generation' : phase === 'execution' ? 'Code Execution' : 'Testing';
                    return (
                      <div key={phase} className="mb-4 rounded-md border border-border p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">{phaseLabel}</p>
                        <select
                          value={phaseConfig.mode}
                          onChange={(e) => setFormSteps({
                            ...formSteps,
                            [phaseKey]: { ...phaseConfig, mode: e.target.value },
                          })}
                          className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mb-2"
                        >
                          <option value="all">All Skills</option>
                          <option value="selected">Selected Skills</option>
                          <option value="none">No Skills</option>
                        </select>
                        {phaseConfig.mode === 'selected' && (
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {skills.length === 0 && (
                              <p className="text-xs text-muted-foreground">No skills available. Add skills in the Skills page.</p>
                            )}
                            {skills.map((skill) => (
                              <label key={skill.name} className="flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={phaseConfig.selectedSkills.includes(skill.name)}
                                  onChange={(e) => {
                                    const sel = e.target.checked
                                      ? [...phaseConfig.selectedSkills, skill.name]
                                      : phaseConfig.selectedSkills.filter((s) => s !== skill.name);
                                    setFormSteps({
                                      ...formSteps,
                                      [phaseKey]: { ...phaseConfig, selectedSkills: sel },
                                    });
                                  }}
                                  className="rounded border-input"
                                />
                                {skill.name}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* MCP Tool Set */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-medium mb-2">MCP Tools</h4>
                  <select
                    value={formSteps.mcpToolSet.mode}
                    onChange={(e) => setFormSteps({
                      ...formSteps,
                      mcpToolSet: { ...formSteps.mcpToolSet, mode: e.target.value },
                    })}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="all">All Servers</option>
                    <option value="selected">Selected Servers</option>
                  </select>
                  {formSteps.mcpToolSet.mode === 'selected' && (
                    <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                      {mcpServers.map((server) => (
                        <label key={server.name} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={formSteps.mcpToolSet.selectedServers.includes(server.name)}
                            onChange={(e) => {
                              const sel = e.target.checked
                                ? [...formSteps.mcpToolSet.selectedServers, server.name]
                                : formSteps.mcpToolSet.selectedServers.filter((s) => s !== server.name);
                              setFormSteps({
                                ...formSteps,
                                mcpToolSet: { ...formSteps.mcpToolSet, selectedServers: sel },
                              });
                            }}
                            className="rounded border-input"
                          />
                          {server.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Test Strategy */}
                <div className="border-t border-border pt-4">
                  <h4 className="text-xs font-medium mb-2">Test Strategy</h4>

                  {/* Mode selector */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {[
                      { value: 'ai_generate', label: '🤖 AI Writes Tests', desc: 'Claude writes and runs tests automatically' },
                      { value: 'run_existing', label: '▶ Run Existing Tests', desc: 'Run tests already in the project' },
                    ].map((opt) => (
                      <div
                        key={opt.value}
                        onClick={() => setFormSteps({
                          ...formSteps,
                          testStrategy: { ...formSteps.testStrategy, mode: opt.value as 'ai_generate' | 'run_existing' },
                        })}
                        className={`cursor-pointer rounded-md border p-3 transition-all ${
                          formSteps.testStrategy.mode === opt.value
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <p className="text-sm font-medium">{opt.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* AI mode: just show info */}
                  {formSteps.testStrategy.mode === 'ai_generate' && (
                    <div className="rounded-md bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
                      <p>Claude will automatically:</p>
                      <p>• Analyze the code written during execution</p>
                      <p>• Write appropriate unit/integration tests</p>
                      <p>• Execute the tests and report results</p>
                      <p className="text-primary mt-2">Configure test-related skills above to guide Claude's testing approach.</p>
                    </div>
                  )}

                  {/* Run existing mode: framework + command */}
                  {formSteps.testStrategy.mode === 'run_existing' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">Framework</label>
                        <select
                          value={formSteps.testStrategy.framework || ''}
                          onChange={(e) => setFormSteps({
                            ...formSteps,
                            testStrategy: { ...formSteps.testStrategy, framework: e.target.value },
                          })}
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          <option value="">-- Auto detect --</option>
                          <optgroup label="Java">
                            <option value="junit">JUnit (Maven: mvn test)</option>
                            <option value="junit-gradle">JUnit (Gradle: ./gradlew test)</option>
                          </optgroup>
                          <optgroup label="JavaScript / TypeScript">
                            <option value="jest">Jest (npm test)</option>
                            <option value="vitest">Vitest (npx vitest run)</option>
                            <option value="playwright">Playwright (npx playwright test)</option>
                          </optgroup>
                          <optgroup label="Python">
                            <option value="pytest">PyTest (pytest)</option>
                          </optgroup>
                          <optgroup label="Other">
                            <option value="custom">Custom command</option>
                          </optgroup>
                        </select>
                      </div>

                      {/* Auto-fill command based on framework */}
                      <div>
                        <label className="block text-xs text-muted-foreground mb-1">
                          Test Command
                          <span className="ml-1 text-muted-foreground/60">(auto-filled, can override)</span>
                        </label>
                        <Input
                          value={formSteps.testStrategy.command || getDefaultCommand(formSteps.testStrategy.framework || '')}
                          onChange={(e) => setFormSteps({
                            ...formSteps,
                            testStrategy: { ...formSteps.testStrategy, command: e.target.value },
                          })}
                          placeholder="e.g. mvn test, npm test, pytest"
                        />
                      </div>
                    </div>
                  )}

                  {/* Auto-run toggle */}
                  <label className="flex items-center gap-2 text-sm mt-3">
                    <input
                      type="checkbox"
                      checked={formSteps.testStrategy.autoRunAfterExecution}
                      onChange={(e) => setFormSteps({
                        ...formSteps,
                        testStrategy: { ...formSteps.testStrategy, autoRunAfterExecution: e.target.checked },
                      })}
                      className="rounded border-input"
                    />
                    Auto-run tests after execution completes
                  </label>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t border-border">
                  <Button onClick={handleSave} size="sm">
                    <Save className="h-4 w-4 mr-1" />
                    {creating ? 'Create' : 'Save'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        {!creating && !editing && (
          <Card className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <GitBranch className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select a pipeline to edit or create a new one</p>
            </div>
          </Card>
        )}
      </div>

      {/* Execution Wizard */}
      {wizardPipeline && (
        <ExecutionWizard
          pipeline={wizardPipeline}
          onClose={() => setWizardPipeline(null)}
          savedWorkspaces={savedWorkspaces}
        />
      )}
    </div>
  );
}
