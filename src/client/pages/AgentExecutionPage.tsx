/**
 * @file AgentExecutionPage.tsx
 * @description Agent自主执行页面 - 零配置，直接执行
 *
 * 核心功能：
 * - 左侧面板：Agent执行历史列表（按需求隔离，显示需求号+标题）
 * - 右侧面板：需求输入、Agent思考过程、子任务状态列表、对话日志、底部输入框
 * - Agent自主思考：实时显示需求分析、任务规划、决策过程
 * - 子任务状态：显示各子Agent的执行状态（pending/running/completed/failed）
 * - 实时交互：通过WebSocket推送Agent执行日志和状态更新
 * - 执行控制：开始、暂停、中止、继续
 */

import {useEffect, useRef, useState, useCallback, useMemo} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {apiGet, apiPost} from '../api';
import {useAppStore} from '../stores/app-store';
import {useWebSocket} from '../hooks/useWebSocket';
import type {ExecutionLogEntry} from '../stores/app-store';
import {cn, formatRelativeTime} from '../lib/utils';
import {
    Loader2,
    Send,
    MessageSquare,
    Clock,
    Terminal,
    Trash2,
    CheckCircle2,
    XCircle,
    AlertCircle,
    Play,
    Pause,
    Square,
    Sparkles,
    Brain,
    ListTodo,
    Bot,
    ChevronDown,
    ChevronUp,
    FolderOpen,
} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {StatusIcon} from '../components/StatusIcon';
import ContextIndicator from '../components/ContextIndicator';

// === 类型定义 ===

/**
 * Agent执行摘要（用于历史列表）
 */
interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementNumber?: string;
    requirementTitle?: string;
    workspacePath: string;
    status: 'analyzing' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    createdAt: string;
    updatedAt: string;
    subTasksCount?: number;
    completedSubTasks?: number;
}

/**
 * 子任务状态
 */
interface SubTask {
    id: string;
    title: string;
    description?: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    agent?: string;
    startedAt?: string;
    completedAt?: string;
    output?: string;
    error?: string;
    order: number;
}

/**
 * Agent思考过程
 */
interface AgentThought {
    type: 'analysis' | 'planning' | 'decision' | 'tool_selection' | 'error';
    content: string;
    timestamp: string;
    confidence?: number;
}

/**
 * 完整的Agent执行信息
 */
interface AgentExecutionDetail extends AgentExecutionSummary {
    requirementText?: string;
    thoughts: AgentThought[];
    subTasks: SubTask[];
    logs: string[];
    workspacePath: string;
    error?: string;
    paused?: boolean;
}

// === 辅助函数 ===

/**
 * 根据执行状态返回对应的图标组件
 */
function statusIcon(status: string) {
    return <StatusIcon status={status}/>;
}

/**
 * 子任务状态图标
 */
function subTaskStatusIcon(status: SubTask['status']) {
    switch (status) {
        case 'pending':
            return <Clock className="h-3.5 w-3.5 text-muted-foreground"/>;
        case 'running':
            return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin"/>;
        case 'completed':
            return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>;
        case 'failed':
            return <XCircle className="h-3.5 w-3.5 text-destructive"/>;
        case 'skipped':
            return <AlertCircle className="h-3.5 w-3.5 text-muted-foreground"/>;
        default:
            return <Clock className="h-3.5 w-3.5 text-muted-foreground"/>;
    }
}

// === 主组件 ===

export default function AgentExecutionPage() {
    const navigate = useNavigate();
    const {t} = useTranslation();
    const theme = useAppStore((s) => s.ui.theme);

    // Agent日志（WebSocket实时推送）
    const agentLogs = useAppStore((s) => s.agents.logs);
    const clearAgentLogs = useAppStore((s) => s.clearAgentLogs);

    // 历史列表相关状态
    const [history, setHistory] = useState<AgentExecutionSummary[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // 当前执行状态
    const [activeId, setActiveId] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentExecutionDetail | null>(null);
    const [requirementInput, setRequirementInput] = useState('');
    const [workspacePath, setWorkspacePath] = useState('');

    // 输入和回复
    const [replyText, setReplyText] = useState('');
    const [replying, setReplying] = useState(false);

    // UI折叠状态
    const [thoughtsExpanded, setThoughtsExpanded] = useState(true);
    const [subTasksExpanded, setSubTasksExpanded] = useState(true);

    // DOM引用
    const logEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const replyInputRef = useRef<HTMLTextAreaElement>(null);

    // 派生状态
    const execStatus = detail?.status ?? 'idle';
    const isAnalyzing = execStatus === 'analyzing';
    const isReady = execStatus === 'ready';
    const isRunning = execStatus === 'running';
    const isPaused = execStatus === 'paused';
    const isCompleted = execStatus === 'completed';
    const isFailed = execStatus === 'failed';
    const isDone = isCompleted || isFailed;
    const canStart = isReady && !isRunning;
    const canPause = isRunning;
    const canResume = isPaused;
    const canAbort = isRunning || isPaused || isAnalyzing;

    // 日志自动滚动
    useEffect(() => {
        logEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [detail?.logs]);

    /**
     * 加载执行历史列表
     */
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await apiGet<AgentExecutionSummary[]>('/agent-execution/list');
            setHistory(data);
        } catch {
            // 忽略错误
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    // 页面加载时获取历史
    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    /**
     * 加载执行详情
     */
    const loadDetail = useCallback(async (id: string) => {
        try {
            const data = await apiGet<AgentExecutionDetail>(`/agent-execution/${id}/detail`);
            setDetail(data);
            setActiveId(id);
            setWorkspacePath(data.workspacePath);
            clearAgentLogs(); // 切换执行时清空日志
        } catch {
            // 忽略错误
        }
    }, []);

    /**
     * 分析需求（Agent思考）
     */
    const handleAnalyze = async () => {
        if (!requirementInput.trim()) return;

        try {
            const res = await apiPost<{ executionId: string }>('/agent-execution/analyze', {
                requirementText: requirementInput.trim(),
                workspacePath: workspacePath || undefined,
            });

            const newExecutionId = res.executionId;
            setActiveId(newExecutionId);
            setDetail(null);
            clearAgentLogs(); // 清空之前的日志

            // 立即轮询新执行
            pollRef.current = setInterval(async () => {
                try {
                    const data = await apiGet<AgentExecutionDetail>(`/agent-execution/${newExecutionId}/detail`);
                    setDetail(data);

                    if (data.status === 'ready' || data.status === 'failed') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        loadHistory();
                    }
                } catch {
                    // 继续轮询
                }
            }, 1500);
        } catch (err) {
            console.error('分析失败:', err);
        }
    };

    /**
     * 开始执行
     */
    const handleStart = async () => {
        if (!activeId) return;

        try {
            await apiPost(`/agent-execution/${activeId}/start`);
            // 立即刷新
            loadDetail(activeId);
            loadHistory();
        } catch (err) {
            console.error('启动失败:', err);
        }
    };

    /**
     * 暂停执行
     */
    const handlePause = async () => {
        if (!activeId) return;

        try {
            await apiPost(`/agent-execution/${activeId}/pause`);
            loadDetail(activeId);
            loadHistory();
        } catch (err) {
            console.error('暂停失败:', err);
        }
    };

    /**
     * 继续执行
     */
    const handleResume = async () => {
        if (!activeId) return;

        try {
            await apiPost(`/agent-execution/${activeId}/resume`);
            loadDetail(activeId);
            loadHistory();
        } catch (err) {
            console.error('恢复失败:', err);
        }
    };

    /**
     * 中止执行
     */
    const handleAbort = async () => {
        if (!activeId) return;

        try {
            await apiPost(`/agent-execution/${activeId}/abort`);
            loadDetail(activeId);
            loadHistory();
        } catch (err) {
            console.error('中止失败:', err);
        }
    };

    /**
     * 发送回复
     */
    const handleReply = async () => {
        if (!activeId || !replyText.trim() || replying) return;

        setReplying(true);
        const message = replyText.trim();
        setReplyText('');

        try {
            await apiPost(`/agent-execution/${activeId}/reply`, {message});
            // 刷新详情
            loadDetail(activeId);
        } catch (err) {
            console.error('回复失败:', err);
        } finally {
            setReplying(false);
        }
    };

    /**
     * 删除执行记录
     */
    const handleDelete = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();

        try {
            await fetch(`/api/agent-execution/${id}`, {method: 'DELETE'});
            await loadHistory();

            if (activeId === id) {
                setDetail(null);
                setActiveId(null);
            }
        } catch {
            // 忽略错误
        }
    };

    /**
     * 新会话（清空上下文）
     */
    const handleNewSession = async () => {
        if (!activeId) return;

        try {
            await apiPost(`/agent-execution/${activeId}/new-session`, {});
        } catch (err) {
            console.error('新会话创建失败:', err);
        }
    };

    // 轮询当前执行状态
    useEffect(() => {
        if (!activeId) return;
        if (!isAnalyzing && !isRunning && !isPaused) return;

        const poll = async () => {
            try {
                const data = await apiGet<AgentExecutionDetail>(`/agent-execution/${activeId}/detail`);
                setDetail(data);

                if (['completed', 'failed', 'aborted', 'ready'].includes(data.status)) {
                    if (pollRef.current) clearInterval(pollRef.current);
                    loadHistory();
                }
            } catch {
                // 继续轮询
            }
        };

        poll();
        pollRef.current = setInterval(poll, 1500);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeId, isAnalyzing, isRunning, isPaused, loadHistory]);

    // 组件卸载时清理轮询
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // 思考类型图标和颜色
    const thoughtIcon = (type: AgentThought['type']) => {
        switch (type) {
            case 'analysis':
                return <Brain className="h-3.5 w-3.5 text-purple-400"/>;
            case 'planning':
                return <ListTodo className="h-3.5 w-3.5 text-blue-400"/>;
            case 'decision':
                return <Sparkles className="h-3.5 w-3.5 text-amber-400"/>;
            case 'tool_selection':
                return <Bot className="h-3.5 w-3.5 text-emerald-400"/>;
            case 'error':
                return <XCircle className="h-3.5 w-3.5 text-red-400"/>;
            default:
                return <Terminal className="h-3.5 w-3.5 text-gray-400"/>;
        }
    };

    const thoughtTypeLabel: Record<AgentThought['type'], string> = {
        analysis: '需求分析',
        planning: '任务规划',
        decision: '决策',
        tool_selection: '工具选择',
        error: '错误',
    };

    return (
        <div className="flex h-full">
            {/* 左侧面板：执行历史列表 */}
            <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        执行历史
                    </span>
                    {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {history.length === 0 && !loadingHistory && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
                            <Terminal className="h-7 w-7 text-muted-foreground/30"/>
                            <p className="text-xs text-muted-foreground">暂无执行记录</p>
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
                                    {exec.requirementNumber ? `${exec.requirementNumber} ` : ''}{exec.requirementTitle || '未命名需求'}
                                </p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <Clock className="h-3 w-3 text-muted-foreground/50"/>
                                    <span className="text-xs text-muted-foreground/60">
                                        {formatRelativeTime(exec.createdAt)}
                                    </span>
                                </div>
                                {exec.workspacePath && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                        <FolderOpen className="h-3 w-3 text-muted-foreground/40"/>
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
                                <Trash2 className="h-3.5 w-3.5"/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* 右侧面板：执行详情 */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 页面头部 */}
                <div className="border-b border-border px-6 py-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">
                                Agent执行
                            </h1>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                零配置，Agent自主执行
                            </p>
                        </div>
                        {activeId && (
                            <div className={cn(
                                'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium',
                                isAnalyzing && 'bg-purple-500/10 text-purple-500',
                                isReady && 'bg-blue-500/10 text-blue-500',
                                isRunning && 'bg-blue-500/10 text-blue-500',
                                isPaused && 'bg-yellow-500/10 text-yellow-500',
                                isCompleted && 'bg-emerald-500/10 text-emerald-500',
                                isFailed && 'bg-destructive/10 text-destructive'
                            )}>
                                {isAnalyzing && <Loader2 className="h-3.5 w-3.5 animate-spin"/>}
                                {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin"/>}
                                {isCompleted && <CheckCircle2 className="h-3.5 w-3.5"/>}
                                {isFailed && <XCircle className="h-3.5 w-3.5"/>}
                                {isPaused && <AlertCircle className="h-3.5 w-3.5"/>}
                                {isAnalyzing && '分析中'}
                                {isReady && '就绪'}
                                {isRunning && '执行中'}
                                {isPaused && '已暂停'}
                                {isCompleted && '已完成'}
                                {isFailed && '失败'}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 overflow-y-auto">
                    {/* 未选择执行时显示输入区域 */}
                    {!activeId && (
                        <Card>
                            <CardContent className="p-6 space-y-4">
                                <div>
                                    <label className="text-sm font-medium mb-2 block">需求描述</label>
                                    <textarea
                                        value={requirementInput}
                                        onChange={(e) => setRequirementInput(e.target.value)}
                                        placeholder="描述你的需求，Agent将自主分析并执行..."
                                        rows={6}
                                        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium mb-2 block">工作空间（可选）</label>
                                    <input
                                        type="text"
                                        value={workspacePath}
                                        onChange={(e) => setWorkspacePath(e.target.value)}
                                        placeholder="/path/to/workspace"
                                        className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                                    />
                                </div>
                                <Button
                                    onClick={handleAnalyze}
                                    disabled={!requirementInput.trim()}
                                    className="w-full"
                                >
                                    <Sparkles className="h-4 w-4 mr-2"/>
                                    Agent分析需求
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    {/* Agent思考过程 */}
                    {activeId && detail && detail.thoughts.length > 0 && (
                        <Card>
                            <CardContent className="p-4">
                                <button
                                    onClick={() => setThoughtsExpanded(!thoughtsExpanded)}
                                    className="w-full flex items-center justify-between mb-3"
                                >
                                    <div className="flex items-center gap-2">
                                        <Brain className="h-4 w-4 text-purple-500"/>
                                        <span className="text-sm font-semibold">Agent思考过程</span>
                                    </div>
                                    {thoughtsExpanded ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground"/>
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground"/>
                                    )}
                                </button>

                                {thoughtsExpanded && (
                                    <div className="space-y-2">
                                        {detail.thoughts.map((thought, idx) => (
                                            <div
                                                key={idx}
                                                className={cn(
                                                    'rounded-lg p-3 border',
                                                    theme === 'dark' ? 'bg-purple-500/5 border-purple-500/20' : 'bg-purple-50 border-purple-200'
                                                )}
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    {thoughtIcon(thought.type)}
                                                    <span className="text-xs font-medium text-muted-foreground">
                                                        {thoughtTypeLabel[thought.type]}
                                                    </span>
                                                    {thought.confidence !== undefined && (
                                                        <span className="text-xs text-muted-foreground">
                                                            置信度: {Math.round(thought.confidence * 100)}%
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-foreground">{thought.content}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 子任务状态列表 */}
                    {activeId && detail && detail.subTasks.length > 0 && (
                        <Card>
                            <CardContent className="p-4">
                                <button
                                    onClick={() => setSubTasksExpanded(!subTasksExpanded)}
                                    className="w-full flex items-center justify-between mb-3"
                                >
                                    <div className="flex items-center gap-2">
                                        <ListTodo className="h-4 w-4 text-blue-500"/>
                                        <span className="text-sm font-semibold">
                                            子任务 ({detail.completedSubTasks || 0}/{detail.subTasks.length})
                                        </span>
                                    </div>
                                    {subTasksExpanded ? (
                                        <ChevronUp className="h-4 w-4 text-muted-foreground"/>
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-muted-foreground"/>
                                    )}
                                </button>

                                {subTasksExpanded && (
                                    <div className="space-y-2">
                                        {detail.subTasks.map((subTask) => (
                                            <div
                                                key={subTask.id}
                                                className={cn(
                                                    'rounded-lg p-3 border transition-all',
                                                    subTask.status === 'running' && 'border-blue-500/30 bg-blue-500/5',
                                                    subTask.status === 'completed' && 'border-emerald-500/30 bg-emerald-500/5',
                                                    subTask.status === 'failed' && 'border-destructive/30 bg-destructive/5',
                                                    subTask.status === 'pending' && 'border-border/50 bg-muted/30'
                                                )}
                                            >
                                                <div className="flex items-start gap-2">
                                                    <div className="mt-0.5 shrink-0">
                                                        {subTaskStatusIcon(subTask.status)}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <span className="text-xs font-medium text-foreground">
                                                                {subTask.order}. {subTask.title}
                                                            </span>
                                                            {subTask.agent && (
                                                                <span
                                                                    className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                                                                    {subTask.agent}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {subTask.description && (
                                                            <p className="text-xs text-muted-foreground mb-1">{subTask.description}</p>
                                                        )}
                                                        {subTask.error && (
                                                            <p className="text-xs text-destructive">{subTask.error}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 执行控制按钮 */}
                    {activeId && (
                        <div className="flex items-center gap-2">
                            {canStart && (
                                <Button onClick={handleStart} size="sm">
                                    <Play className="h-4 w-4 mr-1.5"/>
                                    开始执行
                                </Button>
                            )}
                            {canPause && (
                                <Button onClick={handlePause} variant="outline" size="sm">
                                    <Pause className="h-4 w-4 mr-1.5"/>
                                    暂停
                                </Button>
                            )}
                            {canResume && (
                                <Button onClick={handleResume} variant="outline" size="sm">
                                    <Play className="h-4 w-4 mr-1.5"/>
                                    继续
                                </Button>
                            )}
                            {canAbort && (
                                <Button onClick={handleAbort} variant="outline" size="sm" className="text-destructive">
                                    <Square className="h-4 w-4 mr-1.5"/>
                                    中止
                                </Button>
                            )}
                        </div>
                    )}

                    {/* 对话/日志区 */}
                    {activeId && detail && (
                        <div
                            className={cn(
                                'flex-1 min-h-0 rounded-lg border border-border/50 overflow-hidden flex flex-col shadow-lg',
                                theme === 'dark' ? 'bg-gradient-to-br from-gray-900 to-gray-950' : 'bg-gradient-to-br from-gray-50 to-gray-100'
                            )}
                        >
                            <div className={cn(
                                'flex items-center gap-2 px-4 py-2.5 border-b border-border/50 backdrop-blur-sm',
                                theme === 'dark' ? 'bg-gradient-to-r from-gray-800/80 to-gray-700/80' : 'bg-gradient-to-r from-gray-100/80 to-gray-50/80'
                            )}>
                                <Terminal className="h-3.5 w-3.5 text-emerald-400"/>
                                <span className="text-xs text-emerald-400 font-mono font-medium">执行日志</span>
                                {isRunning && (
                                    <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                                        <span className="relative flex h-2 w-2">
                                            <span
                                                className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span
                                                className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                                        </span>
                                        实时
                                    </span>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto p-4 space-y-2">
                                {agentLogs.length === 0 ? (
                                    <div className="text-muted-foreground text-center py-8">
                                        {isAnalyzing ? 'Agent正在思考...' : '等待执行...'}
                                    </div>
                                ) : (
                                    agentLogs.map((log, idx) => {
                                        const logStr = typeof log === 'string' ? log : JSON.stringify(log);
                                        const isUserMessage = logStr.includes('**User:**');
                                        return (
                                            <div
                                                key={idx}
                                                className={cn(
                                                    'rounded-lg p-3',
                                                    isUserMessage
                                                        ? cn('ml-10 border-l-2 border-blue-500', theme === 'dark' ? 'bg-blue-500/10' : 'bg-blue-50')
                                                        : cn('border border-gray-700/50', theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-50')
                                                )}
                                            >
                                                <p className="text-xs font-mono text-foreground break-words">
                                                    {logStr}
                                                </p>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={logEndRef}/>
                            </div>
                        </div>
                    )}

                    {/* 底部输入框 */}
                    {activeId && (
                        <Card className="border-primary/20 bg-primary/5">
                            <CardContent className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4 text-primary"/>
                                        <span className="text-sm font-semibold">发送消息给Agent</span>
                                    </div>
                                    <ContextIndicator
                                        logs={agentLogs.map(l => typeof l === 'string' ? l : JSON.stringify(l))}
                                        onSuggestNewSession={handleNewSession}
                                    />
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
                                        placeholder="输入回复或补充信息... (Ctrl+Enter发送)"
                                        rows={2}
                                        disabled={isRunning}
                                        className="flex-1 bg-background border border-input rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                                    />
                                    <Button
                                        onClick={handleReply}
                                        disabled={!replyText.trim() || replying || isRunning}
                                        className="self-end"
                                        size="sm"
                                    >
                                        {replying ? (
                                            <Loader2 className="h-4 w-4 animate-spin"/>
                                        ) : (
                                            <Send className="h-4 w-4"/>
                                        )}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
}
