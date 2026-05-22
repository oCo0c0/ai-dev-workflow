/**
 * @file TestsPage.tsx
 * @description 测试管理页面组件
 *
 * 该页面提供三种测试模式的完整支持：
 * 1. Run Existing - 运行项目中已有的测试用例（Provider 架构，支持 Node/Java/Python）
 * 2. AI Generate - Claude 自动分析代码、编写测试、运行并报告结果
 * 3. AI E2E - 两阶段 E2E 测试：AI 生成 Playwright 文件 → Provider 结构化执行
 *
 * 页面布局采用左右分栏结构：
 * - 左侧：测试运行历史列表
 * - 右侧：模式选择器、操作按钮、测试结果详情、AI 实时输出
 */

import {useState, useEffect, useCallback, useRef} from 'react';
import {useSearchParams} from 'react-router-dom';
import {apiGet, apiPost, apiDelete} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn, formatRelativeTime} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {Badge} from '../components/ui/badge';
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
    GitCompare,
    RefreshCw,
    Layers,
    Globe,
    Wrench,
    Square,
} from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================

interface TestFrameworkInfo {
    name: string;
    detected: boolean;
    configFile?: string;
    command: string;
}

interface ProjectInfo {
    type: string;
    label: string;
    buildTool: string;
    testFrameworks: Array<{
        name: string;
        detected: boolean;
        configFile?: string;
        command: string;
        supportsJsonOutput: boolean;
    }>;
    rootPath: string;
}

interface TestTarget {
    filePath: string;
    sourceFile?: string;
    framework: string;
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
    mode: 'manual' | 'pipeline_run_existing' | 'pipeline_ai_generate'
        | 'manual_ai_generate' | 'manual_ai_generate_e2e';
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
    environment?: 'local' | 'sandbox';
    currentPhase?: 'writing' | 'sandbox_run' | 'fixing' | 'sandbox_rerun';
}

interface TestRunDetail extends TestRunSummary {
    results?: TestResults;
    rawOutput?: string;
    error?: string;
    sandboxId?: string;
    phases?: Array<{
        phase: 'writing' | 'sandbox_run' | 'fixing' | 'sandbox_rerun';
        label: string;
        startedAt: string;
        completedAt?: string;
        status: 'running' | 'completed' | 'failed' | 'skipped';
    }>;
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
            mode: 'ai_generate' | 'run_existing' | 'ai_generate_e2e';
            framework?: string;
            command?: string;
            autoRunAfterExecution: boolean;
            environment?: 'local' | 'sandbox';
            sandboxId?: string;
        };
        testSkills?: {
            mode: 'all' | 'selected';
            selectedSkills: string[];
        };
    };
}

interface SkillInfo {
    name: string;
    description: string;
}

/** 测试运行模式 */
type TestRunMode = 'run_existing' | 'ai_generate' | 'ai_generate_e2e';

// ============================================================
// 辅助函数
// ============================================================

function statusIcon(status: string) {
    switch (status) {
        case 'completed':
            return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>;
        case 'failed':
            return <XCircle className="h-3.5 w-3.5 text-destructive"/>;
        case 'running':
            return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin"/>;
        default:
            return <TestTube className="h-3.5 w-3.5 text-muted-foreground"/>;
    }
}

function modeLabel(mode: string) {
    switch (mode) {
        case 'pipeline_ai_generate':
        case 'manual_ai_generate':
            return 'AI Test';
        case 'pipeline_run_existing':
            return 'Pipeline';
        case 'manual_ai_generate_e2e':
            return 'AI E2E';
        case 'manual':
            return 'Manual';
        default:
            return mode;
    }
}

function modeBadgeVariant(mode: string): 'default' | 'secondary' | 'outline' {
    switch (mode) {
        case 'pipeline_ai_generate':
        case 'manual_ai_generate':
        case 'manual_ai_generate_e2e':
            return 'default';
        case 'pipeline_run_existing':
            return 'secondary';
        default:
            return 'outline';
    }
}

function testCaseStatusIcon(status: string) {
    switch (status) {
        case 'passed':
            return <CheckCircle2 className="h-4 w-4 text-emerald-500"/>;
        case 'failed':
            return <XCircle className="h-4 w-4 text-red-500"/>;
        case 'skipped':
            return <SkipForward className="h-4 w-4 text-amber-500"/>;
        default:
            return null;
    }
}

/**
 * 将前端模式值映射为后端持久化 mode 值
 */
function mapModeToDisplay(
    mode: TestRunMode,
    linkedExecution: ExecutionSummary | null
): TestRunDetail['mode'] {
    if (mode === 'ai_generate') return linkedExecution ? 'pipeline_ai_generate' : 'manual_ai_generate';
    if (mode === 'ai_generate_e2e') return linkedExecution ? 'pipeline_ai_generate' : 'manual_ai_generate_e2e';
    return linkedExecution ? 'pipeline_run_existing' : 'manual';
}

function logTypeColor(type: string) {
    switch (type) {
        case 'error':
            return 'text-red-400';
        case 'warning':
            return 'text-yellow-400';
        case 'info':
            return 'text-blue-400';
        default:
            return 'text-gray-300';
    }
}

// ============================================================
// 主组件
// ============================================================

export default function TestsPage() {
    const [searchParams] = useSearchParams();
    const currentWorkspace = useAppStore((s) => s.workspace.current);

    // === 历史记录相关状态 ===
    const [history, setHistory] = useState<TestRunSummary[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // === 当前测试运行相关状态 ===
    const [activeId, setActiveId] = useState<string | null>(null);
    const [detail, setDetail] = useState<TestRunDetail | null>(null);
    const [frameworks, setFrameworks] = useState<TestFrameworkInfo[]>([]);
    const [detecting, setDetecting] = useState(false);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'skipped'>('all');
    const [showRawOutput, setShowRawOutput] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // === 执行上下文关联状态 ===
    const [linkedExecution, setLinkedExecution] = useState<ExecutionSummary | null>(null);
    const [pipelineInfo, setPipelineInfo] = useState<PipelineInfo | null>(null);
    const [executionList, setExecutionList] = useState<ExecutionSummary[]>([]);
    const [showExecSelector, setShowExecSelector] = useState(false);

    // === 项目信息状态（Provider 架构） ===
    const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
    const [changedTargets, setChangedTargets] = useState<TestTarget[]>([]);
    const [detectingTargets, setDetectingTargets] = useState(false);

    // === 实时日志（来自 WebSocket，复用 execution store） ===
    const storeLogs = useAppStore((s) => s.execution.logs);
    const testPhase = useAppStore((s) => s.tests.phase);
    const testPhaseLabel = useAppStore((s) => s.tests.phaseLabel);
    const testRunning = useAppStore((s) => s.tests.running);
    const logEndRef = useRef<HTMLDivElement>(null);
    // 记录 AI 模式开始时已有日志数量，只展示此后新增的
    const [aiLogStartIndex, setAiLogStartIndex] = useState(0);

    // === 模式选择相关状态 ===
    const [selectedMode, setSelectedMode] = useState<TestRunMode>('run_existing');
    const [activeTab, setActiveTab] = useState<'local' | 'sandbox'>('local');
    const [sandboxIdInput, setSandboxIdInput] = useState('');
    // 切换到沙箱 Tab 时自动选中 AI Generate 模式
    useEffect(() => {
        if (activeTab === 'sandbox' && selectedMode !== 'ai_generate') {
            setSelectedMode('ai_generate');
        }
    }, [activeTab]);
    const [cliAvailable, setCliAvailable] = useState(true);
    const [availableSkills, setAvailableSkills] = useState<SkillInfo[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
    const [showSkillSelector, setShowSkillSelector] = useState(false);
    const [customPrompt, setCustomPrompt] = useState('');
    const rawOutputRef = useRef<HTMLDivElement>(null);

    const effectiveWorkspace = linkedExecution?.workspacePath || currentWorkspace?.path || '';
    const isAiMode = selectedMode === 'ai_generate' || selectedMode === 'ai_generate_e2e';

    // === 初始化 ===

    useEffect(() => {
        const execId = searchParams.get('executionId');
        if (!execId) return;

        apiGet<ExecutionSummary>(`/execution/${execId}/status`)
            .then((exec) => {
                if (exec.status === 'completed') {
                    setLinkedExecution(exec);
                    apiGet<{ pipelineId?: string }>(`/plan/${exec.planId}`)
                        .then((plan) => {
                            if (plan.pipelineId) {
                                return apiGet<PipelineInfo[]>('/pipelines').then((list) => {
                                    const found = list.find(p => p.id === plan.pipelineId);
                                    if (found) setPipelineInfo(found);
                                    return null;
                                });
                            }
                            return null;
                        })
                        .catch(() => {
                        });

                    if (exec.workspacePath) {
                        apiGet<TestFrameworkInfo[]>(
                            `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
                        ).then(setFrameworks).catch(() => {
                        });
                    }
                }
            })
            .catch(() => {
            });
    }, [searchParams]);

    // 检查 CLI 可用性和加载 skills 列表
    // 默认 cliAvailable=true，避免异步检查期间 UI 不可用
    useEffect(() => {
        apiGet<{ available: boolean }>('/tests/cli-available')
            .then(info => setCliAvailable(info.available))
            .catch(() => {
            });  // 检查失败不关闭，运行时再报错

        apiGet<SkillInfo[]>('/tests/skills')
            .then(setAvailableSkills)
            .catch(() => {
            });
    }, []);

    // Pipeline 跳转时，根据 pipelineInfo.steps 同步模式、沙箱配置和 skills
    useEffect(() => {
        if (!pipelineInfo?.steps) return;

        // 同步模式
        const strategy = pipelineInfo.steps.testStrategy;
        if (strategy?.mode) {
            if (strategy.mode === 'ai_generate') setSelectedMode('ai_generate');
            else if (strategy.mode === 'ai_generate_e2e') setSelectedMode('ai_generate_e2e');
            else setSelectedMode('run_existing');
        }

        // 同步沙箱环境配置：从流水线配置读取 environment 和 sandboxId
        if (strategy?.environment === 'sandbox' && strategy.sandboxId) {
            setActiveTab('sandbox');
            setSandboxIdInput(strategy.sandboxId);
        } else if (strategy?.environment === 'local') {
            setActiveTab('local');
        }

        // 同步 skills
        const skillConfig = pipelineInfo.steps.testSkills;
        if (skillConfig?.mode === 'all') {
            // all 模式：选中所有可用 skills
            setSelectedSkills(availableSkills.map(s => s.name));
        } else if (skillConfig?.selectedSkills?.length) {
            setSelectedSkills(skillConfig.selectedSkills);
        }
    }, [pipelineInfo, availableSkills]);

    const loadExecutions = useCallback(async () => {
        try {
            const data = await apiGet<ExecutionSummary[]>('/execution/list');
            setExecutionList(data.filter(e => e.status === 'completed'));
        } catch {
        }
    }, []);

    useEffect(() => {
        loadExecutions();
    }, [loadExecutions]);

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await apiGet<TestRunSummary[]>('/tests/list');
            setHistory(data);
        } catch {
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    const loadDetail = useCallback(async (id: string) => {
        try {
            const data = await apiGet<TestRunDetail>(`/tests/results/${id}`);
            setDetail(data);
            setActiveId(id);
            setError(null);
            // 根据记录的执行环境自动切换 Tab 并恢复 sandboxId
            if (data.environment === 'sandbox') {
                setActiveTab('sandbox');
                if (data.sandboxId && !sandboxIdInput) {
                    setSandboxIdInput(data.sandboxId);
                }
            } else if (data.environment === 'local' && activeTab !== 'local') {
                setActiveTab('local');
            }
            // 恢复执行上下文关联
            if (data.executionId && (!linkedExecution || linkedExecution.id !== data.executionId)) {
                try {
                    const exec = await apiGet<ExecutionSummary>(`/execution/${data.executionId}/status`);
                    setLinkedExecution(exec);
                    if (data.pipelineId && (!pipelineInfo || pipelineInfo.id !== data.pipelineId)) {
                        try {
                            const list = await apiGet<PipelineInfo[]>('/pipelines');
                            const found = list.find(p => p.id === data.pipelineId);
                            if (found) setPipelineInfo(found);
                        } catch { /* ignore */
                        }
                    }
                    if (exec.workspacePath) {
                        try {
                            const fw = await apiGet<TestFrameworkInfo[]>(
                                `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
                            );
                            setFrameworks(fw);
                        } catch { /* ignore */
                        }
                    }
                } catch { /* ignore */
                }
            }
        } catch {
        }
    }, [activeTab, sandboxIdInput, linkedExecution, pipelineInfo]);

    useEffect(() => {
        // 从 Execution 跳转时（URL 带 executionId），不自动选中历史记录，避免覆盖跳转上下文
        const execId = searchParams.get('executionId');
        if (execId) return;
        if (!activeId && history.length > 0) {
            loadDetail(history[0].id);
        }
    }, [activeId, history, loadDetail, searchParams]);

    // 轮询正在运行的测试任务
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
            }
        };

        pollRef.current = setInterval(poll, 2000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeId, history, loadHistory]);

    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // WebSocket test:complete 通知后立即刷新 detail（避免 2s 轮询延迟）
    useEffect(() => {
        if (!testRunning && activeId && detail?.status === 'running') {
            loadDetail(activeId);
            loadHistory();
        }
    }, [testRunning]);

    // AI 模式 rawOutput 自动滚动
    useEffect(() => {
        if (rawOutputRef.current && detail?.status === 'running' && detail?.mode?.includes('ai_generate')) {
            rawOutputRef.current.scrollTop = rawOutputRef.current.scrollHeight;
        }
    }, [detail?.rawOutput, detail?.status, detail?.mode]);

    // 实时日志（WebSocket）自动滚动
    useEffect(() => {
        logEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [storeLogs]);

    // === 操作方法 ===

    const detectProject = async () => {
        if (!effectiveWorkspace) return;
        setDetecting(true);
        setError(null);
        try {
            const [projInfo, fwData] = await Promise.all([
                apiGet<ProjectInfo>(`/tests/detect-project?workspacePath=${encodeURIComponent(effectiveWorkspace)}`),
                apiGet<TestFrameworkInfo[]>(`/tests/detect?workspacePath=${encodeURIComponent(effectiveWorkspace)}`),
            ]);
            setProjectInfo(projInfo);
            setFrameworks(fwData);
            if (fwData.every((f) => !f.detected)) {
                setError('No test framework detected in this workspace.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to detect project');
        } finally {
            setDetecting(false);
        }
    };

    const detectChangedTargets = async () => {
        if (!effectiveWorkspace) return;
        setDetectingTargets(true);
        setError(null);
        try {
            const gitStatus = await apiGet<{
                isGit: boolean;
                changes: Array<{ path: string; status: string }>;
            }>(`/workspace/git/status?workspacePath=${encodeURIComponent(effectiveWorkspace)}`);

            if (!gitStatus.isGit || !gitStatus.changes?.length) {
                setError('No changed files detected. The workspace may not be a git repository or has no uncommitted changes.');
                return;
            }

            const changedFiles = gitStatus.changes.map(c => c.path);
            const targets = await apiGet<TestTarget[]>(
                `/tests/targets?workspacePath=${encodeURIComponent(effectiveWorkspace)}&changedFiles=${encodeURIComponent(changedFiles.join(','))}`
            );
            setChangedTargets(targets);

            if (targets.length === 0) {
                setError(
                    `${changedFiles.length} changed files found, but no matching test files exist.\n` +
                    'The changed source files do not have corresponding test files (e.g. foo.ts → foo.test.ts).\n' +
                    'Click "Run All" to run the full test suite instead.'
                );
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to detect changed targets');
        } finally {
            setDetectingTargets(false);
        }
    };

    const runChangedTests = async () => {
        if (!effectiveWorkspace || changedTargets.length === 0) return;
        setRunning(true);
        setError(null);
        try {
            const changedFiles = [...new Set(changedTargets.map(t => t.sourceFile).filter(Boolean))] as string[];
            const body: Record<string, string | string[]> = {
                workspacePath: effectiveWorkspace,
                mode: 'run_existing',
                changedFiles,
            };
            const {taskId} = await apiPost<{ taskId: string }>('/tests/run', body);
            setActiveId(taskId);
            setDetail({
                id: taskId,
                status: 'running',
                mode: linkedExecution ? 'pipeline_run_existing' : 'manual',
                workspacePath: effectiveWorkspace,
                executionId: linkedExecution?.id,
                pipelineId: pipelineInfo?.id,
                startedAt: new Date().toISOString(),
            });
            loadHistory();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to run changed tests');
        } finally {
            setRunning(false);
        }
    };

    /**
     * 核心运行方法：根据 selectedMode 分流到后端三种模式
     */
    const runTests = async (framework?: string) => {
        if (!effectiveWorkspace) return;
        setRunning(true);
        setError(null);
        try {
            const body: Record<string, unknown> = {
                workspacePath: effectiveWorkspace,
                mode: selectedMode,
            };
            if (framework) body.framework = framework;
            // AI 模式传入已检测到的变更文件，帮助 AI 聚焦测试
            if (isAiMode && changedTargets.length > 0) {
                body.changedFiles = [...new Set(changedTargets.map(t => t.sourceFile).filter(Boolean))];
            }
            if (isAiMode) {
                if (selectedSkills.length > 0) body.skills = selectedSkills;
                if (customPrompt.trim()) body.customPrompt = customPrompt.trim();
            }
            if (linkedExecution) body.executionId = linkedExecution.id;
            if (pipelineInfo) body.pipelineId = pipelineInfo.id;
            // 沙箱模式：传入执行环境和沙箱 ID
            if (isAiMode && activeTab === 'sandbox' && sandboxIdInput.trim()) {
                body.environment = 'sandbox';
                body.sandboxId = sandboxIdInput.trim();
            }

            const {taskId} = await apiPost<{ taskId: string }>('/tests/run', body);
            // AI 模式记录当前 store logs 长度，后续只展示新增日志
            if (isAiMode) {
                const currentLogs = useAppStore.getState().execution.logs;
                setAiLogStartIndex(currentLogs.length);
            }
            setActiveId(taskId);
            setDetail({
                id: taskId,
                status: 'running',
                mode: mapModeToDisplay(selectedMode, linkedExecution),
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

    const cancelTest = async () => {
        if (!activeId) return;
        try {
            await apiPost<{ ok: boolean }>(`/tests/${activeId}/cancel`, {});
            setDetail(prev => prev ? {...prev, status: 'failed' as const, error: 'Cancelled by user'} : null);
            setRunning(false);
            loadHistory();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to cancel test');
        }
    };

    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await apiDelete(`/tests/${id}`);
            setHistory(prev => prev.filter(h => h.id !== id));
            if (activeId === id) {
                setDetail(null);
                setActiveId(null);
            }
        } catch {
        }
    };

    const filteredSuites = detail?.results?.suites.map((suite) => ({
        ...suite,
        tests: suite.tests.filter((t) => filter === 'all' || t.status === filter),
    })).filter((suite) => suite.tests.length > 0);

    // 模式选择器配置
    const modeOptions: Array<{
        value: TestRunMode;
        label: string;
        desc: string;
        icon: React.ReactNode;
        disabled?: boolean;
    }> = [
        {
            value: 'run_existing',
            label: 'Run Existing',
            desc: 'Run tests already in the project',
            icon: <Play className="h-4 w-4"/>,
        },
        {
            value: 'ai_generate',
            label: 'AI Writes Tests',
            desc: 'Claude writes and runs tests automatically',
            icon: <Sparkles className="h-4 w-4"/>,
            disabled: !cliAvailable,
        },
        {
            value: 'ai_generate_e2e',
            label: 'AI E2E Tests',
            desc: 'Generate Playwright files, then run',
            icon: <Globe className="h-4 w-4"/>,
            disabled: !cliAvailable,
        },
    ];

    return (
        <div className="flex h-full">
            {/* === 左侧：测试运行历史列表 === */}
            <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Test History
                    </span>
                    {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {history.length === 0 && !loadingHistory && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
                            <TestTube className="h-7 w-7 text-muted-foreground/30"/>
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
                                        {run.environment === 'sandbox' && (
                                            <span className="text-[10px] px-1.5 py-0 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">sandbox</span>
                                        )}
                                        {run.framework && (
                                            <span
                                                className="text-xs text-muted-foreground truncate">{run.framework}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Clock className="h-3 w-3 text-muted-foreground/50"/>
                                        <span className="text-xs text-muted-foreground/60">
                                        {formatRelativeTime(run.startedAt)}
                                    </span>
                                    </div>
                                    {run.workspacePath && (
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <FolderOpen className="h-3 w-3 text-muted-foreground/40"/>
                                            <span className="text-xs text-muted-foreground/40 truncate font-mono">
                                            {run.workspacePath.split(/[/\\]/).pop()}
                                        </span>
                                        </div>
                                    )}
                                    {run.status === 'completed' && run.totalTests !== undefined && (
                                        <div className="flex items-center gap-2 mt-1 text-xs">
                                            <span className="text-emerald-500">{run.passed} pass</span>
                                            {(run.failed ?? 0) > 0 &&
                                                <span className="text-red-500">{run.failed} fail</span>}
                                            {(run.skipped ?? 0) > 0 &&
                                                <span className="text-amber-500">{run.skipped} skip</span>}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={(e) => handleDelete(run.id, e)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                                >
                                    <Trash2 className="h-3.5 w-3.5"/>
                                </button>
                            </div>
                        ))}
                </div>
            </div>

            {/* === 右侧：模式选择、操作和结果 === */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 顶部操作栏 */}
                <div className="border-b border-border px-6 py-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-semibold">Tests</h1>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                {detail?.status === 'running' ? 'Tests are running...' :
                                    detail ? 'Test results' :
                                        'Select a test mode and run'}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={detectProject}
                                disabled={!effectiveWorkspace || detecting}
                            >
                                {detecting ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                ) : (
                                    <Scan className="h-4 w-4 mr-1.5"/>
                                )}
                                Detect
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => runTests()}
                                disabled={!effectiveWorkspace || running || (activeTab === 'sandbox' && !sandboxIdInput.trim())}
                            >
                                {running ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                ) : (
                                    <Play className="h-4 w-4 mr-1.5"/>
                                )}
                                Run
                            </Button>
                            {detail?.status === 'running' && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={cancelTest}
                                >
                                    <Square className="h-4 w-4 mr-1.5"/>
                                    Cancel
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={changedTargets.length > 0 ? runChangedTests : detectChangedTargets}
                                disabled={!effectiveWorkspace || running || detectingTargets}
                            >
                                {detectingTargets ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                ) : (
                                    <GitCompare className="h-4 w-4 mr-1.5"/>
                                )}
                                {changedTargets.length > 0 ? `Changed (${changedTargets.length})` : 'Changed Tests'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowExecSelector(!showExecSelector)}
                            >
                                <Link className="h-4 w-4 mr-1.5"/>
                                Link Execution
                            </Button>
                            {!effectiveWorkspace && (
                                <span
                                    className="text-xs text-muted-foreground">Select a workspace or link an execution</span>
                            )}
                        </div>
                    </div>

                    {/* 测试环境 Tab bar */}
                    <div className="mt-3 flex items-center gap-1 p-1 bg-secondary rounded-lg w-fit">
                        <button
                            className={cn(
                                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                                activeTab === 'local'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setActiveTab('local')}
                        >
                            <span className="flex items-center gap-1.5">
                                <TestTube className="h-3.5 w-3.5"/>
                                Local Tests
                            </span>
                        </button>
                        <button
                            className={cn(
                                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                                activeTab === 'sandbox'
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setActiveTab('sandbox')}
                        >
                            <span className="flex items-center gap-1.5">
                                <Globe className="h-3.5 w-3.5"/>
                                Sandbox Tests
                            </span>
                        </button>
                    </div>

                    {/* 沙箱配置（仅 Sandbox Tab 可见） */}
                    {activeTab === 'sandbox' && (
                        <div className="mt-3 flex items-center gap-3">
                            <label className="text-xs text-muted-foreground">Sandbox ID:</label>
                            <input
                                type="text"
                                placeholder="Enter pre-created Sandbox ID"
                                value={sandboxIdInput}
                                onChange={(e) => setSandboxIdInput(e.target.value)}
                                className="flex-1 max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-xs"
                            />
                            {!sandboxIdInput.trim() && (
                                <span className="text-xs text-amber-500">Required for sandbox execution</span>
                            )}
                        </div>
                    )}

                    {/* 已关联的执行上下文信息栏 */}
                    {linkedExecution && (
                        <div
                            className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20">
                            <Link className="h-4 w-4 text-primary shrink-0"/>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium">Linked Execution</p>
                                <p className="text-xs text-muted-foreground font-mono truncate">
                                    {linkedExecution.workspacePath || linkedExecution.id}
                                </p>
                            </div>
                            {pipelineInfo?.steps?.testStrategy && (
                                <Badge variant="secondary" className="text-[10px]">
                                    <Zap className="h-3 w-3 mr-0.5"/>
                                    {pipelineInfo.steps.testStrategy.mode === 'ai_generate' ? 'AI Generate'
                                        : pipelineInfo.steps.testStrategy.mode === 'ai_generate_e2e' ? 'AI E2E'
                                            : 'Run Existing'}
                                </Badge>
                            )}
                            <button
                                onClick={() => {
                                    setLinkedExecution(null);
                                    setPipelineInfo(null);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                Unlink
                            </button>
                        </div>
                    )}

                    {/* 执行选择器下拉面板 */}
                    {showExecSelector && (
                        <div className="mt-3 border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                            <div className="px-3 py-2 bg-muted/30 border-b border-border">
                                <p className="text-xs font-medium text-muted-foreground">Select a completed
                                    execution</p>
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
                                            if (exec.workspacePath) {
                                                try {
                                                    const fw = await apiGet<TestFrameworkInfo[]>(
                                                        `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
                                                    );
                                                    setFrameworks(fw);
                                                } catch {
                                                }
                                            }
                                        }}
                                        className={cn(
                                            'px-3 py-2 cursor-pointer border-b border-border/50 hover:bg-accent/50 transition-colors',
                                            linkedExecution?.id === exec.id && 'bg-primary/5'
                                        )}
                                    >
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0"/>
                                            <span
                                                className="text-xs font-mono text-muted-foreground">{exec.id.substring(0, 8)}...</span>
                                            <Clock className="h-3 w-3 text-muted-foreground/50 ml-auto"/>
                                            <span
                                                className="text-xs text-muted-foreground/60">{formatRelativeTime(exec.startedAt)}</span>
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

                    {/* === 模式选择器（三列卡片，沙箱 Tab 下隐藏） === */}
                    {activeTab === 'local' && (
                        <div className="mt-3 grid grid-cols-3 gap-2">
                            {modeOptions.map((opt) => (
                                <div
                                    key={opt.value}
                                    onClick={() => !opt.disabled && setSelectedMode(opt.value)}
                                    className={cn(
                                        'cursor-pointer rounded-md border p-3 transition-all',
                                        opt.disabled && 'opacity-50 cursor-not-allowed',
                                        selectedMode === opt.value
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border hover:border-primary/40'
                                    )}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {opt.icon}
                                        <p className="text-sm font-medium">{opt.label}</p>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                                    {opt.disabled && (
                                        <p className="text-[10px] text-destructive mt-1">Claude CLI not available</p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* 沙箱模式说明 */}
                    {activeTab === 'sandbox' && (
                        <div
                            className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-primary/5 border border-primary/20">
                            <Globe className="h-4 w-4 text-primary shrink-0"/>
                            <span className="text-xs text-muted-foreground">
                                Sandbox mode: AI writes tests locally, then executes them in the Daytona sandbox. Three phases: Write → Run → Fix.
                            </span>
                        </div>
                    )}

                    {/* === AI 模式配置面板 === */}
                    {isAiMode && (
                        <div className="mt-3 space-y-2">
                            {/* Skills 选择器 */}
                            {availableSkills.length > 0 && (
                                <div>
                                    <button
                                        onClick={() => setShowSkillSelector(!showSkillSelector)}
                                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                        <Wrench className="h-3.5 w-3.5"/>
                                        Skills {selectedSkills.length > 0 && `(${selectedSkills.length} selected)`}
                                        {showSkillSelector ? <ChevronUp className="h-3 w-3"/> :
                                            <ChevronDown className="h-3 w-3"/>}
                                    </button>
                                    {showSkillSelector && (
                                        <div
                                            className="mt-1 border border-border rounded-md p-2 max-h-32 overflow-y-auto">
                                            {availableSkills.map(skill => (
                                                <label key={skill.name}
                                                       className="flex items-center gap-2 py-0.5 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedSkills.includes(skill.name)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) setSelectedSkills(prev => [...prev, skill.name]);
                                                            else setSelectedSkills(prev => prev.filter(s => s !== skill.name));
                                                        }}
                                                        className="rounded border-input"
                                                    />
                                                    <span className="text-xs">{skill.name}</span>
                                                    <span
                                                        className="text-[10px] text-muted-foreground ml-auto truncate max-w-40">
                                                        {skill.description}
                                                    </span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Custom Prompt */}
                            <div>
                                <label className="block text-xs text-muted-foreground mb-1">Custom Prompt
                                    (optional)</label>
                                <textarea
                                    value={customPrompt}
                                    onChange={(e) => setCustomPrompt(e.target.value)}
                                    placeholder="Leave empty for default prompt..."
                                    rows={2}
                                    className="flex w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                                />
                            </div>

                            {/* E2E 模式说明 */}
                            {selectedMode === 'ai_generate_e2e' && (
                                <div
                                    className="rounded-md bg-blue-500/5 border border-blue-500/20 p-3 text-xs text-muted-foreground space-y-1">
                                    <p className="text-blue-500 font-medium">Two-phase E2E testing:</p>
                                    <p><strong>Phase 1:</strong> Claude generates .spec.ts files and saves to project
                                    </p>
                                    <p><strong>Phase 2:</strong> Playwright Provider runs the generated files with
                                        structured results</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 项目信息展示（Provider 架构） */}
                    {projectInfo && (
                        <div
                            className="mt-3 flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50 border border-border">
                            <Layers className="h-4 w-4 text-primary shrink-0"/>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold">{projectInfo.label}</span>
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                        {projectInfo.buildTool}
                                    </Badge>
                                    {projectInfo.testFrameworks.filter(f => f.detected).map(f => (
                                        <Badge key={f.name} variant="outline" className="text-[10px] px-1.5 py-0">
                                            {f.name}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    setProjectInfo(null);
                                    setChangedTargets([]);
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                            >
                                <RefreshCw className="h-3 w-3"/>
                            </button>
                        </div>
                    )}

                    {/* 变更文件测试目标展示 */}
                    {changedTargets.length > 0 && (
                        <div className="mt-3 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                            <div className="flex items-center gap-2 mb-1.5">
                                <GitCompare className="h-3.5 w-3.5 text-amber-500"/>
                                <span className="text-xs font-medium">Changed File Targets</span>
                                <span className="text-xs text-muted-foreground">({changedTargets.length} tests)</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {changedTargets.slice(0, 10).map((t, i) => (
                                    <span key={i} className="text-[10px] font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                                        {t.filePath.split('/').pop()}
                                    </span>
                                ))}
                                {changedTargets.length > 10 && (
                                    <span className="text-[10px] text-muted-foreground">
                                        +{changedTargets.length - 10} more
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 检测到的测试框架标签列表 */}
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
                                        <CheckCircle2 className="h-3 w-3 mr-1"/>
                                    ) : (
                                        <XCircle className="h-3 w-3 mr-1"/>
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
                    {/* 全局错误提示 */}
                    {error && (
                        <div
                            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                            <p className="text-sm text-destructive whitespace-pre-line">{error}</p>
                        </div>
                    )}

                    {/* AI 模式运行中：实时日志终端（参考 ExecutionPage） */}
                    {detail?.status === 'running' && detail?.mode?.includes('ai_generate') && (() => {
                        const aiLogs = storeLogs.slice(aiLogStartIndex);
                        // Fallback: WebSocket logs 为空但轮询 rawOutput 有内容时，展示 rawOutput
                        const rawText = detail.rawOutput || '';
                        const hasContent = aiLogs.length > 0 || rawText.length > 0;
                        const isSandbox = detail?.environment === 'sandbox' || !!testPhase;
                        const phaseLabel = testPhaseLabel || (detail?.currentPhase === 'writing' ? 'AI 编写测试文件'
                            : detail?.currentPhase === 'sandbox_run' ? '在沙箱中执行测试'
                                : detail?.currentPhase === 'fixing' ? 'AI 修复失败用例'
                                    : detail?.currentPhase === 'sandbox_rerun' ? '在沙箱中重新执行测试'
                                        : null);
                        const phaseOrder: Array<{ key: string; label: string }> = [
                            {key: 'writing', label: 'Writing'},
                            {key: 'sandbox_run', label: 'Running'},
                            {key: 'fixing', label: 'Fixing'},
                            {key: 'sandbox_rerun', label: 'Re-running'},
                        ];
                        const currentPhaseKey = testPhase || detail?.currentPhase || '';
                        return (
                            <div className="mb-4 rounded-lg border border-border bg-gray-950 overflow-hidden">
                                <div
                                    className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-gray-900/50">
                                    <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse"/>
                                    <span className="text-xs text-muted-foreground font-mono">
                                        {phaseLabel || (detail.mode === 'manual_ai_generate_e2e'
                                            ? 'AI E2E Test Generation'
                                            : 'AI Test Generation')}
                                    </span>
                                    {/* 沙箱阶段进度条 */}
                                    {isSandbox && (
                                        <div className="ml-3 flex items-center gap-1">
                                            {phaseOrder.map((p, i) => {
                                                const phaseIndex = phaseOrder.findIndex(x => x.key === currentPhaseKey);
                                                const isDone = i < phaseIndex;
                                                const isCurrent = p.key === currentPhaseKey;
                                                return (
                                                    <div key={p.key} className="flex items-center gap-1">
                                                        {i > 0 && <span className="text-gray-600 text-xs">→</span>}
                                                        <span className={cn(
                                                            'text-[10px] px-1.5 py-0.5 rounded',
                                                            isDone ? 'bg-emerald-900/40 text-emerald-400' :
                                                                isCurrent ? 'bg-primary/20 text-primary animate-pulse' :
                                                                    'bg-gray-800 text-gray-600'
                                                        )}>
                                                            {p.label}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                    <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                                        Live
                                    </span>
                                </div>
                                <div ref={rawOutputRef} className="max-h-96 overflow-y-auto p-4 font-mono text-xs">
                                    {!hasContent ? (
                                        <div className="text-gray-500 text-center py-6">
                                            <Loader2 className="h-4 w-4 animate-spin inline-block mr-2"/>
                                            Waiting for AI output...
                                        </div>
                                    ) : aiLogs.length > 0 ? (
                                        aiLogs.map((entry, i) => {
                                            const isObj = typeof entry === 'object' && 'content' in entry;
                                            const content = isObj ? (entry as {
                                                content: string
                                            }).content : String(entry);
                                            const type = isObj ? (entry as { type: string }).type : 'output';
                                            const timestamp = isObj ? (entry as { timestamp: string }).timestamp : '';

                                            return (
                                                <div key={i}
                                                     className={cn('py-0.5 leading-relaxed', logTypeColor(type))}>
                                                    {timestamp && (
                                                        <span className="text-gray-600 mr-2 select-none">
                                                            {new Date(timestamp).toLocaleTimeString()}
                                                        </span>
                                                    )}
                                                    <span className="whitespace-pre-wrap">{content}</span>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        // Fallback: rawOutput from polling
                                        <pre
                                            className="text-gray-300 whitespace-pre-wrap leading-relaxed">{rawText}</pre>
                                    )}
                                    <div ref={logEndRef}/>
                                </div>
                            </div>
                        );
                    })()}

                    {/* 非 AI 模式运行中：进度 + 实时输出 */}
                    {detail?.status === 'running' && !detail?.mode?.includes('ai_generate') && (
                        <Card className="mb-4">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3 mb-3">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0"/>
                                    <span className="text-sm font-medium">Tests are running...</span>
                                </div>
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                                    <div className="h-full bg-primary rounded-full animate-pulse w-2/3"/>
                                </div>
                                {detail.rawOutput && (
                                    <div className="rounded-md bg-gray-950 border border-border overflow-hidden">
                                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-gray-900/50">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                                            <span className="text-xs text-muted-foreground font-mono">Output</span>
                                        </div>
                                        <pre className="max-h-64 overflow-y-auto p-3 text-xs text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                                            {detail.rawOutput.slice(-3000)}
                                        </pre>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 详情级别的错误提示 */}
                    {detail?.status === 'failed' && (
                        <div
                            className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-destructive font-medium">
                                        {detail.error || 'Test run failed'}
                                    </p>
                                    {detail.rawOutput && (
                                        <pre
                                            className="mt-2 text-xs text-destructive/80 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                                            {detail.rawOutput.slice(-2000)}
                                        </pre>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 非 failed 的 error */}
                    {detail?.error && detail.status !== 'failed' && (
                        <div
                            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                            <p className="text-sm text-destructive">{detail.error}</p>
                        </div>
                    )}

                    {/* Phases 时间线（完成后/失败后也展示） */}
                    {detail?.phases && detail.phases.length > 0 && (
                        <Card className="mb-4">
                            <CardContent className="p-4">
                                <h3 className="text-sm font-semibold mb-3">Execution Phases</h3>
                                <div className="space-y-2">
                                    {detail.phases.map((phase, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <div className={cn(
                                                'h-6 w-6 rounded-full flex items-center justify-center shrink-0 text-[10px]',
                                                phase.status === 'completed' ? 'bg-emerald-500/20 text-emerald-500' :
                                                phase.status === 'failed' ? 'bg-red-500/20 text-red-500' :
                                                phase.status === 'running' ? 'bg-primary/20 text-primary animate-pulse' :
                                                'bg-muted text-muted-foreground'
                                            )}>
                                                {phase.status === 'completed' ? '✓' :
                                                 phase.status === 'failed' ? '✗' :
                                                 phase.status === 'running' ? '...' : '–'}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium">{phase.label}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {new Date(phase.startedAt).toLocaleTimeString()}
                                                    {phase.completedAt && ` → ${new Date(phase.completedAt).toLocaleTimeString()}`}
                                                </p>
                                            </div>
                                            <span className={cn(
                                                'text-[10px] px-1.5 py-0.5 rounded',
                                                phase.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                                                phase.status === 'failed' ? 'bg-red-500/10 text-red-600' :
                                                phase.status === 'running' ? 'bg-primary/10 text-primary' :
                                                'bg-muted text-muted-foreground'
                                            )}>
                                                {phase.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 执行输出日志（所有模式统一显示） */}
                    {detail?.rawOutput && (
                        <Card className="mb-4">
                            <CardContent className="p-0 overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 bg-gray-900/50">
                                    <div className="flex items-center gap-2">
                                        <Terminal className="h-3.5 w-3.5 text-muted-foreground"/>
                                        <span className="text-xs text-muted-foreground font-mono">Execution Output</span>
                                    </div>
                                    {/* 结果摘要（如果有） */}
                                    {detail.results && (
                                        <div className="flex items-center gap-3 text-xs">
                                            <span className="text-emerald-500">{detail.results.passed} pass</span>
                                            {detail.results.failed > 0 && <span className="text-red-500">{detail.results.failed} fail</span>}
                                            {detail.results.skipped > 0 && <span className="text-amber-500">{detail.results.skipped} skip</span>}
                                            <span className="text-muted-foreground">{(detail.results.duration / 1000).toFixed(1)}s</span>
                                        </div>
                                    )}
                                </div>
                                <div className="bg-gray-950 max-h-[500px] overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                                    {detail.rawOutput}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 失败用例详情（有结构化结果时展示） */}
                    {detail?.results && filteredSuites?.some(s => s.tests.some(t => t.status === 'failed')) && (
                        <Card className="mb-4">
                            <CardContent className="p-4">
                                <h3 className="text-sm font-semibold mb-3 text-red-500">Failed Tests</h3>
                                <div className="space-y-2">
                                    {filteredSuites.filter(s => s.tests.some(t => t.status === 'failed')).map((suite) => (
                                        <div key={suite.name}>
                                            <p className="text-xs font-medium text-muted-foreground mb-1">{suite.name}</p>
                                            {suite.tests.filter(t => t.status === 'failed').map((test, i) => (
                                                <div key={i} className="ml-2 mb-2">
                                                    <div className="flex items-center gap-2">
                                                        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0"/>
                                                        <span className="text-sm">{test.name}</span>
                                                    </div>
                                                    {test.error && (
                                                        <pre className="mt-1 ml-5 text-xs text-red-400 bg-red-500/5 border border-red-500/10 rounded-md p-2 overflow-x-auto font-mono whitespace-pre-wrap">
                                                            {test.error}
                                                        </pre>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 无测试结果时的空状态提示 */}
                    {!detail && !error && (
                        <Card>
                            <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                                <TestTube className="h-10 w-10 text-muted-foreground/30"/>
                                <p className="text-sm text-muted-foreground">No test results yet</p>
                                <p className="text-xs text-muted-foreground/60">
                                    Select a test mode above and click Run to get started
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
