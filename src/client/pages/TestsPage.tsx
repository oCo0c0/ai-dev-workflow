/**
 * @file TestsPage.tsx
 * @description 测试管理页面组件
 *
 * 该页面用于管理和查看项目测试的运行结果。
 * 支持手动执行测试和通过 Pipeline 执行测试两种模式，
 * 并提供测试框架自动检测、结果展示和历史记录管理功能。
 *
 * 核心功能：
 * 1. 自动检测工作区中的测试框架（如 Jest、Vitest、pytest 等）
 * 2. 手动触发测试运行，或关联 Pipeline 执行来运行测试
 * 3. 查看测试运行结果的详细报告（通过/失败/跳过统计、测试套件详情）
 * 4. 支持按状态过滤测试用例
 * 5. 查看原始测试输出（适用于 AI 生成测试模式）
 * 6. 管理测试运行历史记录
 *
 * 页面布局采用左右分栏结构：
 * - 左侧：测试运行历史列表
 * - 右侧：测试结果详情、操作按钮和关联执行上下文
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
} from 'lucide-react';

// ============================================================
// 类型定义
// ============================================================

/**
 * @interface TestFrameworkInfo
 * @description 测试框架检测信息接口
 * 表示一个被检测到的测试框架及其配置信息
 */
interface TestFrameworkInfo {
    /** 框架名称（如 jest、vitest、pytest 等） */
    name: string;
    /** 是否在当前工作区中检测到该框架 */
    detected: boolean;
    /** 框架配置文件路径（可选） */
    configFile?: string;
    /** 运行该框架测试的命令 */
    command: string;
}

/**
 * @interface TestCase
 * @description 单个测试用例的运行结果
 */
interface TestCase {
    /** 测试用例名称 */
    name: string;
    /** 测试状态：通过、失败或跳过 */
    status: 'passed' | 'failed' | 'skipped';
    /** 执行耗时（毫秒） */
    duration: number;
    /** 失败时的错误信息（可选） */
    error?: string;
}

/**
 * @interface TestSuite
 * @description 测试套件接口
 * 包含一组相关的测试用例
 */
interface TestSuite {
    /** 套件名称 */
    name: string;
    /** 套件中的测试用例列表 */
    tests: TestCase[];
}

/**
 * @interface TestResults
 * @description 测试运行结果详情
 * 包含汇总统计信息和所有测试套件
 */
interface TestResults {
    /** 测试框架名称 */
    framework: string;
    /** 总测试用例数 */
    totalTests: number;
    /** 通过的测试用例数 */
    passed: number;
    /** 失败的测试用例数 */
    failed: number;
    /** 跳过的测试用例数 */
    skipped: number;
    /** 总执行耗时（毫秒） */
    duration: number;
    /** 代码覆盖率百分比（可选） */
    coverage?: number;
    /** 测试套件列表 */
    suites: TestSuite[];
}

/**
 * @interface TestRunSummary
 * @description 测试运行摘要接口
 * 用于历史列表展示，不包含详细的测试结果
 */
interface TestRunSummary {
    /** 运行记录唯一标识 */
    id: string;
    /** 运行状态：运行中、已完成或失败 */
    status: 'running' | 'completed' | 'failed';
    /** 运行模式：手动执行、Pipeline 执行已有测试或 Pipeline AI 生成测试 */
    mode: 'manual' | 'pipeline_run_existing' | 'pipeline_ai_generate';
    /** 使用的测试框架名称（可选） */
    framework?: string;
    /** 工作区路径 */
    workspacePath: string;
    /** 开始时间（ISO 格式） */
    startedAt: string;
    /** 完成时间（ISO 格式，可选） */
    completedAt?: string;
    /** 关联的执行 ID（可选） */
    executionId?: string;
    /** 关联的 Pipeline ID（可选） */
    pipelineId?: string;
    /** 总测试数（可选，运行中时可能为空） */
    totalTests?: number;
    /** 通过数（可选） */
    passed?: number;
    /** 失败数（可选） */
    failed?: number;
    /** 跳过数（可选） */
    skipped?: number;
}

/**
 * @interface TestRunDetail
 * @extends TestRunSummary
 * @description 测试运行详情接口
 * 在摘要基础上包含完整的测试结果和原始输出
 */
interface TestRunDetail extends TestRunSummary {
    /** 详细的测试结果（可选，运行中时为空） */
    results?: TestResults;
    /** 原始测试输出文本（可选） */
    rawOutput?: string;
    /** 运行错误信息（可选） */
    error?: string;
}

/**
 * @interface ExecutionSummary
 * @description Pipeline 执行摘要接口
 * 用于关联测试运行与 Pipeline 执行上下文
 */
interface ExecutionSummary {
    /** 执行唯一标识 */
    id: string;
    /** 关联的计划 ID */
    planId: string;
    /** 执行状态 */
    status: 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    /** 开始时间（ISO 格式） */
    startedAt: string;
    /** 完成时间（ISO 格式，可选） */
    completedAt?: string;
    /** 关联的工作区路径（可选） */
    workspacePath?: string;
}

/**
 * @interface PipelineInfo
 * @description Pipeline 信息接口
 * 包含 Pipeline 的测试策略配置
 */
interface PipelineInfo {
    /** Pipeline 唯一标识 */
    id: string;
    /** Pipeline 名称 */
    name: string;
    /** Pipeline 步骤配置（可选） */
    steps?: {
        /** 测试策略配置 */
        testStrategy?: {
            /** 测试模式：AI 生成测试或执行已有测试 */
            mode: 'ai_generate' | 'run_existing';
            /** 指定的测试框架（可选） */
            framework?: string;
            /** 自定义测试命令（可选） */
            command?: string;
            /** 是否在执行完成后自动运行测试 */
            autoRunAfterExecution: boolean;
        };
    };
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据测试运行状态返回对应的状态图标组件
 * @param status - 运行状态字符串
 * @returns 对应的 React 图标元素
 */
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

/**
 * 根据运行模式返回可读的标签文本
 * @param mode - 运行模式字符串
 * @returns 模式的中文标签
 */
function modeLabel(mode: string) {
    switch (mode) {
        case 'pipeline_ai_generate':
            return 'AI Test';
        case 'pipeline_run_existing':
            return 'Pipeline';
        case 'manual':
            return 'Manual';
        default:
            return mode;
    }
}

/**
 * 根据运行模式返回 Badge 组件的变体样式
 * @param mode - 运行模式字符串
 * @returns Badge 的 variant 属性值
 */
function modeBadgeVariant(mode: string): 'default' | 'secondary' | 'outline' {
    switch (mode) {
        case 'pipeline_ai_generate':
            return 'default';
        case 'pipeline_run_existing':
            return 'secondary';
        default:
            return 'outline';
    }
}

/**
 * 根据测试用例状态返回对应的状态图标组件
 * @param status - 测试用例状态
 * @returns 对应的 React 图标元素（未知状态返回 null）
 */
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

// ============================================================
// 主组件
// ============================================================

/**
 * @function TestsPage
 * @description 测试管理页面主组件
 *
 * 提供测试框架检测、手动/自动测试执行、结果展示和历史管理功能。
 * 支持从 Execution 页面通过 URL 参数传入执行上下文，实现测试与 Pipeline 的联动。
 *
 * @returns {JSX.Element} 测试管理页面的 React 组件
 */
export default function TestsPage() {
    /** URL 查询参数，用于接收从 Execution 页面传入的 executionId */
    const [searchParams] = useSearchParams();
    /** 从全局状态获取当前工作区信息 */
    const currentWorkspace = useAppStore((s) => s.workspace.current);

    // === 历史记录相关状态 ===
    /** 测试运行历史列表 */
    const [history, setHistory] = useState<TestRunSummary[]>([]);
    /** 是否正在加载历史记录 */
    const [loadingHistory, setLoadingHistory] = useState(false);

    // === 当前测试运行相关状态 ===
    /** 当前激活（查看中）的测试运行 ID */
    const [activeId, setActiveId] = useState<string | null>(null);
    /** 当前查看的测试运行详情 */
    const [detail, setDetail] = useState<TestRunDetail | null>(null);
    /** 检测到的测试框架列表 */
    const [frameworks, setFrameworks] = useState<TestFrameworkInfo[]>([]);
    /** 是否正在检测框架 */
    const [detecting, setDetecting] = useState(false);
    /** 是否正在运行测试 */
    const [running, setRunning] = useState(false);
    /** 错误信息 */
    const [error, setError] = useState<string | null>(null);
    /** 测试用例过滤条件 */
    const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'skipped'>('all');
    /** 是否展开原始输出面板 */
    const [showRawOutput, setShowRawOutput] = useState(false);
    /** 轮询定时器引用 */
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // === 执行上下文关联状态 ===
    /** 关联的执行摘要（从 Execution 页面或手动选择） */
    const [linkedExecution, setLinkedExecution] = useState<ExecutionSummary | null>(null);
    /** 关联的 Pipeline 信息（包含测试策略配置） */
    const [pipelineInfo, setPipelineInfo] = useState<PipelineInfo | null>(null);
    /** 可选的执行列表（用于执行选择器） */
    const [executionList, setExecutionList] = useState<ExecutionSummary[]>([]);
    /** 是否显示执行选择器下拉面板 */
    const [showExecSelector, setShowExecSelector] = useState(false);

    /**
     * 计算有效的工作区路径
     * 优先使用关联执行的工作区路径，其次使用全局状态中的工作区路径
     */
    const effectiveWorkspace = linkedExecution?.workspacePath || currentWorkspace?.path || '';

    /**
     * 组件挂载时：从 URL 参数加载执行上下文
     * 如果 URL 中包含 executionId，自动加载该执行信息并关联到测试页面
     */
    useEffect(() => {
        const execId = searchParams.get('executionId');
        if (!execId) return;

        apiGet<ExecutionSummary>(`/execution/${execId}/status`)
            .then((exec) => {
                if (exec.status === 'completed') {
                    setLinkedExecution(exec);
                    // 尝试加载关联的 Pipeline 信息以获取测试策略配置
                    apiGet<{ pipelineId?: string }>(`/plan/${exec.planId}`)
                        .then((plan) => {
                            if (plan.pipelineId) {
                                // 通过列表接口查找对应的 Pipeline（因无单独 GET /:id 端点）
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

                    // 为关联的工作区自动检测测试框架
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

    /**
     * 加载可关联的执行列表
     * 仅加载已完成的执行记录供用户选择
     */
    const loadExecutions = useCallback(async () => {
        try {
            const data = await apiGet<ExecutionSummary[]>('/execution/list');
            setExecutionList(data.filter(e => e.status === 'completed'));
        } catch {
            // 静默处理加载失败
        }
    }, []);

    useEffect(() => {
        loadExecutions();
    }, [loadExecutions]);

    /**
     * 加载测试运行历史列表
     */
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await apiGet<TestRunSummary[]>('/tests/list');
            setHistory(data);
        } catch {
            // 静默处理
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    /**
     * 加载指定测试运行的详细结果
     */
    const loadDetail = useCallback(async (id: string) => {
        try {
            const data = await apiGet<TestRunDetail>(`/tests/results/${id}`);
            setDetail(data);
            setActiveId(id);
            setError(null);
        } catch {
            // 静默处理
        }
    }, []);

    /**
     * 自动选中历史列表中的第一条记录
     * 仅在尚未选中任何记录且有历史数据时触发
     */
    useEffect(() => {
        if (!activeId && history.length > 0) {
            loadDetail(history[0].id);
        }
    }, [activeId, history, loadDetail]);

    /**
     * 轮询正在运行的测试任务
     * 每 2 秒请求一次最新状态，直到测试完成或失败后停止轮询
     * 测试完成后自动刷新历史列表
     */
    useEffect(() => {
        if (!activeId) return;
        const current = history.find(h => h.id === activeId);
        if (current?.status !== 'running') return;

        const poll = async () => {
            try {
                const data = await apiGet<TestRunDetail>(`/tests/results/${activeId}`);
                setDetail(data);
                // 测试结束后停止轮询并刷新历史
                if (['completed', 'failed'].includes(data.status)) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    loadHistory();
                }
            } catch {
                // 请求失败时保持轮询，等待服务恢复
            }
        };

        pollRef.current = setInterval(poll, 2000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeId, history, loadHistory]);

    // 组件卸载时清理轮询定时器
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // === 操作方法 ===

    /**
     * 自动检测当前工作区中的测试框架
     * 扫描项目配置文件（如 package.json、jest.config 等）来识别可用框架
     */
    const detectFrameworks = async () => {
        if (!effectiveWorkspace) return;
        setDetecting(true);
        setError(null);
        try {
            const data = await apiGet<TestFrameworkInfo[]>(
                `/tests/detect?workspacePath=${encodeURIComponent(effectiveWorkspace)}`
            );
            setFrameworks(data);
            // 所有框架都未检测到时显示提示
            if (data.every((f) => !f.detected)) {
                setError('No test framework detected in this workspace.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to detect frameworks');
        } finally {
            setDetecting(false);
        }
    };

    /**
     * 运行测试
     * 根据是否关联执行上下文决定运行模式：
     * - 有关联：使用 pipeline_run_existing 模式
     * - 无关联：使用 manual 模式
     * 运行启动后立即开始轮询状态
     */
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
            const {taskId} = await apiPost<{ taskId: string }>('/tests/run', body);
            // 创建临时的运行记录用于立即展示
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

    /**
     * 删除测试运行记录
     * 如果删除的是当前查看的记录，同时清空详情视图
     */
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
            // 静默处理
        }
    };

    /**
     * 根据过滤条件过滤测试套件和用例
     * 空套件（过滤后无用例）会被移除
     */
    const filteredSuites = detail?.results?.suites.map((suite) => ({
        ...suite,
        tests: suite.tests.filter((t) => filter === 'all' || t.status === filter),
    })).filter((suite) => suite.tests.length > 0);

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
                    {/* 历史为空时的提示 */}
                    {history.length === 0 && !loadingHistory && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
                            <TestTube className="h-7 w-7 text-muted-foreground/30"/>
                            <p className="text-xs text-muted-foreground">No test runs yet</p>
                        </div>
                    )}

                    {/* 历史记录列表项 */}
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
                                {/* 运行模式和框架信息 */}
                                <div className="flex items-center gap-1.5">
                                    <Badge variant={modeBadgeVariant(run.mode)} className="text-[10px] px-1.5 py-0">
                                        {modeLabel(run.mode)}
                                    </Badge>
                                    {run.framework && (
                                        <span className="text-xs text-muted-foreground truncate">{run.framework}</span>
                                    )}
                                </div>
                                {/* 相对时间显示 */}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <Clock className="h-3 w-3 text-muted-foreground/50"/>
                                    <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                                </div>
                                {/* 工作区路径（仅显示最后一级目录名） */}
                                {run.workspacePath && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <FolderOpen className="h-3 w-3 text-muted-foreground/40"/>
                                        <span className="text-xs text-muted-foreground/40 truncate font-mono">
                      {run.workspacePath.split(/[/\\]/).pop()}
                    </span>
                                    </div>
                                )}
                                {/* 已完成运行的结果统计 */}
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
                            {/* 删除按钮：鼠标悬停时显示 */}
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

            {/* === 右侧：测试详情、操作和结果 === */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 顶部操作栏 */}
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
                        {/* 操作按钮组 */}
                        <div className="flex items-center gap-2">
                            {/* 检测测试框架按钮 */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={detectFrameworks}
                                disabled={!effectiveWorkspace || detecting}
                            >
                                {detecting ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                ) : (
                                    <Scan className="h-4 w-4 mr-1.5"/>
                                )}
                                Detect
                            </Button>
                            {/* 运行测试按钮 */}
                            <Button
                                size="sm"
                                onClick={() => runTests()}
                                disabled={!effectiveWorkspace || running}
                            >
                                {running ? (
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                ) : (
                                    <Play className="h-4 w-4 mr-1.5"/>
                                )}
                                Run Tests
                            </Button>
                            {/* 关联执行按钮：打开执行选择器 */}
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setShowExecSelector(!showExecSelector)}
                            >
                                <Link className="h-4 w-4 mr-1.5"/>
                                Link Execution
                            </Button>
                            {/* 未选择工作区时的提示 */}
                            {!effectiveWorkspace && (
                                <span
                                    className="text-xs text-muted-foreground">Select a workspace or link an execution</span>
                            )}
                        </div>
                    </div>

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
                            {/* 显示 Pipeline 的测试策略模式 */}
                            {pipelineInfo?.steps?.testStrategy && (
                                <Badge variant="secondary" className="text-[10px]">
                                    <Zap className="h-3 w-3 mr-0.5"/>
                                    {pipelineInfo.steps.testStrategy.mode === 'ai_generate' ? 'AI Generate' : 'Run Existing'}
                                </Badge>
                            )}
                            {/* 取消关联按钮 */}
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
                                            // 选中执行后自动检测其工作区的测试框架
                                            if (exec.workspacePath) {
                                                try {
                                                    const fw = await apiGet<TestFrameworkInfo[]>(
                                                        `/tests/detect?workspacePath=${encodeURIComponent(exec.workspacePath)}`
                                                    );
                                                    setFrameworks(fw);
                                                } catch { /* ignore */
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

                    {/* 检测到的测试框架标签列表 */}
                    {/* 已检测到的框架可直接点击运行 */}
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
                    {/* 错误提示 */}
                    {error && (
                        <div
                            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                            <p className="text-sm text-destructive">{error}</p>
                        </div>
                    )}

                    {/* 测试运行中的进度指示器 */}
                    {detail?.status === 'running' && (
                        <Card className="mb-4">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0"/>
                                    <span className="text-sm font-medium">
                    {detail.mode === 'pipeline_ai_generate' ? 'AI is generating and running tests...' : 'Tests are running...'}
                  </span>
                                </div>
                                {/* 动画进度条（视觉反馈，非真实进度） */}
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-primary rounded-full animate-pulse w-2/3"/>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* 详情级别的错误提示 */}
                    {detail?.error && (
                        <div
                            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                            <p className="text-sm text-destructive">{detail.error}</p>
                        </div>
                    )}

                    {/* 测试结果详情 */}
                    {detail?.results && (
                        <div className="space-y-4">
                            {/* 结果汇总卡片：总数、通过、失败、跳过、框架信息和耗时 */}
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

                            {/* 按状态过滤的标签页 */}
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

                            {/* 测试套件列表：按套件分组展示测试用例 */}
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
                                                    {/* 失败用例的错误堆栈信息 */}
                                                    {test.error && (
                                                        <pre
                                                            className="mt-2 text-xs text-red-400 bg-red-500/5 border border-red-500/10 rounded-md p-2 overflow-x-auto font-mono">
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

                    {/* 原始测试输出面板（可折叠） */}
                    {/* 适用于 AI 生成测试模式或其他需要查看原始输出的场景 */}
                    {detail?.rawOutput && (
                        <div className="mt-4">
                            <button
                                onClick={() => setShowRawOutput(!showRawOutput)}
                                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {showRawOutput ? <ChevronUp className="h-3.5 w-3.5"/> :
                                    <ChevronDown className="h-3.5 w-3.5"/>}
                                Raw Output
                                {/* AI 模式时显示特殊图标标识 */}
                                {detail.mode === 'pipeline_ai_generate' && (
                                    <Sparkles className="h-3 w-3 text-primary"/>
                                )}
                            </button>
                            {showRawOutput && (
                                <div className="mt-2 rounded-lg border border-border bg-gray-950 overflow-hidden">
                                    <div
                                        className="flex items-center gap-2 px-4 py-2 border-b border-border/50 bg-gray-900/50">
                                        <Terminal className="h-3.5 w-3.5 text-muted-foreground"/>
                                        <span className="text-xs text-muted-foreground font-mono">Output</span>
                                    </div>
                                    <div
                                        className="max-h-96 overflow-y-auto p-4 font-mono text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                                        {detail.rawOutput}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 无测试结果时的空状态提示 */}
                    {!detail && !error && (
                        <Card>
                            <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                                <TestTube className="h-10 w-10 text-muted-foreground/30"/>
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
