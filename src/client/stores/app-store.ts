import { create } from 'zustand';

// === State Interfaces ===

interface Requirement {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  updatedAt: string;
}

interface RequirementDetail extends Requirement {
  description: string;
  acceptanceCriteria: string[];
  attachments: { name: string; url: string; type: string }[];
  relatedIssues: { id: string; title: string; status: string }[];
}

interface WorkspaceInfo {
  path: string;
  projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
  contextFiles: string[];
  hasClaudeMd: boolean;
  gitStatus: 'clean' | 'dirty' | 'not_git';
}

interface DevelopmentPlan {
  id: string;
  requirementId: string;
  workspacePath: string;
  summary: string;
  complexity: 'low' | 'medium' | 'high';
  risks: string[];
  steps: PlanStep[];
  createdAt: string;
  status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed';
}

interface PlanStep {
  index: number;
  title: string;
  description: string;
  targetFiles: string[];
  action: 'create' | 'modify' | 'delete';
  estimatedEffort: string;
}

interface ExecutionStatus {
  executionId: string;
  planId: string;
  currentStep: number;
  totalSteps: number;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  startedAt: string;
  completedAt?: string;
}

interface ExecutionLogEntry {
  timestamp: string;
  stepIndex: number;
  type: 'info' | 'output' | 'error' | 'warning';
  content: string;
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

interface TestSuite {
  name: string;
  tests: TestCase[];
}

interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  screenshot?: string;
}

interface WorkflowPipeline {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// === App State ===

interface AppState {
  // Requirements
  requirements: {
    list: Requirement[];
    selected: RequirementDetail | null;
    loading: boolean;
  };

  // Workspace
  workspace: {
    current: WorkspaceInfo | null;
    history: string[];
  };

  // Plan
  plan: {
    current: DevelopmentPlan | null;
    status: 'idle' | 'generating' | 'ready' | 'editing';
    taskId: string | null;
    logs: string[];  // streaming output during generation
  };

  // Execution
  execution: {
    status: ExecutionStatus | null;
    logs: ExecutionLogEntry[];
    executionId: string | null;
  };

  // Tests
  tests: {
    results: TestResults | null;
    running: boolean;
  };

  // Pipelines
  pipelines: {
    list: WorkflowPipeline[];
    active: WorkflowPipeline | null;
  };

  // WebSocket
  ws: {
    connected: boolean;
  };

  // UI
  ui: {
    theme: 'dark' | 'light';
    sidebarCollapsed: boolean;
  };

  // === Actions ===

  // Requirements actions
  setRequirements: (list: Requirement[]) => void;
  setSelectedRequirement: (req: RequirementDetail | null) => void;
  setRequirementsLoading: (loading: boolean) => void;

  // Workspace actions
  setCurrentWorkspace: (workspace: WorkspaceInfo | null) => void;
  setWorkspaceHistory: (history: string[]) => void;

  // Plan actions
  setCurrentPlan: (plan: DevelopmentPlan | null) => void;
  setPlanStatus: (status: 'idle' | 'generating' | 'ready' | 'editing') => void;
  setPlanTaskId: (taskId: string | null) => void;
  addPlanLog: (content: string) => void;
  clearPlanLogs: () => void;

  // Execution actions
  setExecutionStatus: (status: ExecutionStatus | null) => void;
  setExecutionId: (id: string | null) => void;
  addExecutionLog: (entry: ExecutionLogEntry) => void;
  clearExecutionLogs: () => void;

  // Test actions
  setTestResults: (results: TestResults | null) => void;
  setTestRunning: (running: boolean) => void;

  // Pipeline actions
  setPipelines: (list: WorkflowPipeline[]) => void;
  setActivePipeline: (pipeline: WorkflowPipeline | null) => void;

  // WebSocket actions
  setWsConnected: (connected: boolean) => void;

  // UI actions
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
}

// === Helper: Load theme from localStorage ===

function loadTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('ai-workbench-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function applyTheme(theme: 'dark' | 'light') {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  if (theme === 'dark') {
    html.classList.add('dark');
    html.classList.remove('light');
  } else {
    html.classList.add('light');
    html.classList.remove('dark');
  }
  localStorage.setItem('ai-workbench-theme', theme);
}

// === Store ===

export const useAppStore = create<AppState>((set) => {
  const initialTheme = loadTheme();
  // Apply theme on store creation
  applyTheme(initialTheme);

  return {
    // Initial state
    requirements: { list: [], selected: null, loading: false },
    workspace: { current: null, history: [] },
    plan: {
      current: null,
      status: 'idle',
      taskId: typeof window !== 'undefined' ? localStorage.getItem('ai-workbench-plan-taskid') : null,
      logs: [],
    },
    execution: { status: null, logs: [], executionId: null },
    tests: { results: null, running: false },
    pipelines: { list: [], active: null },
    ws: { connected: false },
    ui: { theme: initialTheme, sidebarCollapsed: false },

    // Requirements actions
    setRequirements: (list) =>
      set((state) => ({ requirements: { ...state.requirements, list } })),
    setSelectedRequirement: (selected) =>
      set((state) => ({ requirements: { ...state.requirements, selected } })),
    setRequirementsLoading: (loading) =>
      set((state) => ({ requirements: { ...state.requirements, loading } })),

    // Workspace actions
    setCurrentWorkspace: (current) =>
      set((state) => ({ workspace: { ...state.workspace, current } })),
    setWorkspaceHistory: (history) =>
      set((state) => ({ workspace: { ...state.workspace, history } })),

    // Plan actions
    setCurrentPlan: (current) =>
      set((state) => ({ plan: { ...state.plan, current } })),
    setPlanStatus: (status) =>
      set((state) => ({ plan: { ...state.plan, status } })),
    setPlanTaskId: (taskId) => {
      // Persist taskId to localStorage so it survives page refresh
      if (taskId) {
        localStorage.setItem('ai-workbench-plan-taskid', taskId);
      } else {
        localStorage.removeItem('ai-workbench-plan-taskid');
      }
      return set((state) => ({ plan: { ...state.plan, taskId } }));
    },
    addPlanLog: (content) =>
      set((state) => ({ plan: { ...state.plan, logs: [...state.plan.logs, content] } })),
    clearPlanLogs: () =>
      set((state) => ({ plan: { ...state.plan, logs: [] } })),

    // Execution actions
    setExecutionStatus: (status) =>
      set((state) => ({ execution: { ...state.execution, status } })),
    setExecutionId: (executionId) =>
      set((state) => ({ execution: { ...state.execution, executionId } })),
    addExecutionLog: (entry) =>
      set((state) => ({
        execution: { ...state.execution, logs: [...state.execution.logs, entry] },
      })),
    clearExecutionLogs: () =>
      set((state) => ({ execution: { ...state.execution, logs: [] } })),

    // Test actions
    setTestResults: (results) =>
      set((state) => ({ tests: { ...state.tests, results } })),
    setTestRunning: (running) =>
      set((state) => ({ tests: { ...state.tests, running } })),

    // Pipeline actions
    setPipelines: (list) =>
      set((state) => ({ pipelines: { ...state.pipelines, list } })),
    setActivePipeline: (active) =>
      set((state) => ({ pipelines: { ...state.pipelines, active } })),

    // WebSocket actions
    setWsConnected: (connected) => set({ ws: { connected } }),

    // UI actions
    toggleTheme: () =>
      set((state) => {
        const newTheme = state.ui.theme === 'dark' ? 'light' : 'dark';
        applyTheme(newTheme);
        return { ui: { ...state.ui, theme: newTheme } };
      }),
    toggleSidebar: () =>
      set((state) => ({
        ui: { ...state.ui, sidebarCollapsed: !state.ui.sidebarCollapsed },
      })),
    setSidebarCollapsed: (collapsed) =>
      set((state) => ({
        ui: { ...state.ui, sidebarCollapsed: collapsed },
      })),
    setTheme: (theme) => {
      applyTheme(theme);
      return set((state) => ({ ui: { ...state.ui, theme } }));
    },
  };
});
