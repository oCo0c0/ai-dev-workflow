/**
 * @file AgentExecutionPage.tsx
 * @description Agent自主执行页面 - 零配置，直接执行
 *
 * 核心功能：
 * - 左侧面板：Agent执行历史列表（按需求隔离，显示需求号+标题）
 * - 右侧面板：执行步骤进度线、思考过程、子任务状态、分组折叠日志、底部输入框
 * - 实时数据：bridge 透传 thinking/tool_use/tool_result → coordinator 解析写入 store
 * - WebSocket 推送：thought/subtask/status/log 事件实时更新
 */

import {useEffect, useRef, useState, useCallback, useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {apiGet, apiPost, apiDelete} from '../api';
import {useAppStore} from '../stores/app-store';
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
    Square,
    Sparkles,
    Brain,
    Wrench,
    ListTodo,
    ChevronDown,
    ChevronUp,
    ChevronRight,
    FolderOpen,
    FileText,
    Bot,
    Plus,
} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {StatusIcon} from '../components/StatusIcon';
import ContextIndicator from '../components/ContextIndicator';
import {LogViewer} from '../components/LogViewer';
import {MarkdownContent} from '../components/MarkdownContent';
import {ExpandableContent} from '../components/ExpandableContent';
import {ExpandableTextarea} from '../components/ExpandableTextarea';
import type {LogMessageData} from '../components/LogMessage';
import type {AgentExecutionSummary, AgentExecutionDetail, ExecutionStatus, AgentThought} from '../types/agent-types';

/** 已保存需求列表项（轻量，不需要完整 RequirementDetail） */
interface SavedRequirement {
    id: string;
    number?: string;
    title: string;
    description?: string;
}

/** 状态元数据映射 */
interface StatusMeta {
    label: string;
    icon: typeof CheckCircle2;
    colorClass: string;
}

const STATUS_META: Record<ExecutionStatus, StatusMeta> = {
    analyzing: {label: '分析中', icon: AlertCircle, colorClass: 'bg-amber-500/10 text-amber-500'},
    ready: {label: '就绪', icon: CheckCircle2, colorClass: 'bg-blue-500/10 text-blue-500'},
    running: {label: '执行中', icon: Loader2, colorClass: 'bg-blue-500/10 text-blue-500'},
    paused: {label: '已暂停', icon: Clock, colorClass: 'bg-amber-500/10 text-amber-500'},
    completed: {label: '已完成', icon: CheckCircle2, colorClass: 'bg-emerald-500/10 text-emerald-500'},
    failed: {label: '失败', icon: XCircle, colorClass: 'bg-destructive/10 text-destructive'},
    aborted: {label: '已中止', icon: XCircle, colorClass: 'bg-gray-500/10 text-gray-500'},
};

// === 辅助函数 ===

function statusIcon(status: string) {
    return <StatusIcon status={status}/>;
}

/** 统一时间格式化（HH:MM:SS） */
function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString();
}

/** 计算步骤耗时（秒），无 startedAt 或 completedAt 返回 null */
function calcDuration(startedAt?: string, completedAt?: string): number | null {
    if (!startedAt || !completedAt) return null;
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return Math.round(ms / 1000);
}

/** 格式化耗时显示 */
function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** 日志消息类型检测（normal 为 parseLog 内部哨兵，渲染时归为 output） */
type LogKind = 'thinking' | 'tool_use' | 'tool_result' | 'user' | 'error' | 'warning' | 'output' | 'normal';

function parseLog(log: string): { kind: LogKind; content: string } {
    try {
        const parsed = JSON.parse(log);
        // 新格式 JSON {type: '...', content: '...'}（优先级最高）。
        // 支持不同供应商/来源产生的结构化日志（user/thinking/tool_use/tool_result/error/warning/output）
        switch (parsed.type) {
            case 'user':
                return {kind: 'user', content: parsed.content || ''};
            case 'thinking':
                return {kind: 'thinking', content: parsed.content || ''};
            case 'tool_use':
                return {kind: 'tool_use', content: parsed.toolName || 'Tool'};
            case 'tool_result':
                return {kind: 'tool_result', content: parsed.content || ''};
            case 'error':
                return {kind: 'error', content: parsed.content || ''};
            case 'warning':
                return {kind: 'warning', content: parsed.content || ''};
            case 'output':
            case 'info':
            case 'system':
                return {kind: 'output', content: parsed.content || ''};
            default:
                break;
        }
        // 其他带 content 字符串字段的 JSON 对象统一归为输出，避免把结构化文本当普通文本整行展示
        if (typeof parsed.content === 'string') return {kind: 'output', content: parsed.content};
        return {kind: 'normal', content: log};
    } catch {
        // 旧格式兼容：以 **User:** 开头才是用户消息
        if (log.startsWith('**User:**')) return {kind: 'user', content: log};
        return {kind: 'normal', content: log};
    }
}

/** 将 store 原始日志行转为统一 LogMessageData[]（供 LogViewer 渲染；折叠/自动滚动由 LogViewer 内部处理） */
function toLogMessages(logs: string[]): LogMessageData[] {
    return logs.map((log) => {
        const {kind, content} = parseLog(log);
        return {kind: kind === 'normal' ? 'output' : kind, content};
    });
}

// === 主组件 ===

export default function AgentExecutionPage() {
    useTranslation();
    const theme = useAppStore((s) => s.ui.theme);

    const logsByExecution = useAppStore((s) => s.agents.logsByExecution);
    const setAgentExecutionLogs = useAppStore((s) => s.setAgentExecutionLogs);
    const removeAgentExecutionLogs = useAppStore((s) => s.removeAgentExecutionLogs);
    const setActiveAgentExecution = useAppStore((s) => s.setActiveAgentExecution);

    // 历史列表
    const [history, setHistory] = useState<AgentExecutionSummary[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);

    // 当前执行
    const [activeId, setActiveId] = useState<string | null>(null);
    const [detail, setDetail] = useState<AgentExecutionDetail | null>(null);

    // 需求选择
    const [reqMode, setReqMode] = useState<'saved' | 'manual'>('saved');
    const [savedRequirements, setSavedRequirements] = useState<SavedRequirement[]>([]);
    const [selectedRequirement, setSelectedRequirement] = useState<SavedRequirement | null>(null);
    const [manualRequirementText, setManualRequirementText] = useState('');
    const [workspacePath, setWorkspacePath] = useState('');
    const [workspaceHistory, setWorkspaceHistory] = useState<string[]>([]);

    // 回复
    const [replyText, setReplyText] = useState('');
    const [replying, setReplying] = useState(false);

    // 创建弹窗
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const dialogRef = useRef<HTMLDialogElement>(null);

    // UI 折叠
    const [thoughtsExpanded, setThoughtsExpanded] = useState(true);
    const [stepsExpanded, setStepsExpanded] = useState(true);
    const [expandedStepLogs, setExpandedStepLogs] = useState<Set<string>>(new Set());

    // 工具权限确认弹框（agent 执行中 canUseTool 触发）
    const [permConfirm, setPermConfirm] = useState<{
        open: boolean;
        permissionRequestId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        title?: string;
    }>({open: false});

    // AskUserQuestion 答案收集
    const [askUserAnswers, setAskUserAnswers] = useState<Record<string, string>>({});

    // DOM 引用
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // 派生状态（基于 STATUS_META，新增状态无需改 UI 代码）
    const execStatus = detail?.status ?? 'idle';
    const statusMeta = execStatus !== 'idle' ? STATUS_META[execStatus] : null;
    const isRunning = execStatus === 'running';
    const canStart = execStatus === 'ready';
    const canAbort = isRunning;

    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await apiGet<AgentExecutionSummary[]>('/agent-execution/list');
            setHistory(data);
        } catch (err) {
            console.error('[AgentExec] loadHistory error:', err);
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
        loadSavedRequirements();
        loadWorkspaceHistory();
    }, []);

    const loadWorkspaceHistory = useCallback(async () => {
        try {
            const data = await apiGet<string[]>('/workspace/history');
            setWorkspaceHistory(data);
        } catch (err) {
            console.error('[AgentExec] loadWorkspaceHistory error:', err);
        }
    }, []);

    const loadSavedRequirements = useCallback(async () => {
        try {
            const data = await apiGet<SavedRequirement[]>('/requirements/saved');
            setSavedRequirements(data);
        } catch (err) {
            console.error('[AgentExec] loadSavedRequirements error:', err);
        }
    }, []);

    const loadDetail = useCallback(async (id: string) => {
        try {
            const data = await apiGet<AgentExecutionDetail>(`/agent-execution/${id}/detail`);
            setDetail(data);
            setActiveId(id);
            setWorkspacePath(data.workspacePath);
            // 用历史日志初始化该执行的分桶（多 Agent 隔离：每个任务只读自己的桶）
            setAgentExecutionLogs(id, data.logs || []);
            // 记录当前活跃执行
            setActiveAgentExecution(id);
        } catch (err) {
            console.error('[AgentExec] loadDetail error:', err);
        }
    }, [setAgentExecutionLogs, setActiveAgentExecution]);

    const openCreateDialog = () => {
        setSelectedRequirement(null);
        setManualRequirementText('');
        setReqMode('saved');
        setShowCreateDialog(true);
        // 延迟调用 showModal，确保 DOM 已渲染
        requestAnimationFrame(() => dialogRef.current?.showModal());
    };

    const closeCreateDialog = () => {
        dialogRef.current?.close();
        setShowCreateDialog(false);
    };

    const handleCreate = async () => {
        if (!workspacePath) return;

        let requirementText = '';
        let requirementId = '';
        let requirementNumber = '';
        let requirementTitle = '';

        if (reqMode === 'saved' && selectedRequirement) {
            requirementText = selectedRequirement.description || '';
            requirementId = selectedRequirement.id;
            requirementNumber = selectedRequirement.number || '';
            requirementTitle = selectedRequirement.title || '';
        } else if (reqMode === 'manual') {
            requirementText = manualRequirementText;
        }
        // 需求可选：无需求时用占位文本，用户后续通过回复补充

        try {
            const res = await apiPost<{ executionId: string }>('/agent-execution/create', {
                requirementText: requirementText || '（待补充需求）',
                requirementId: requirementId || undefined,
                requirementNumber: requirementNumber || undefined,
                requirementTitle: requirementTitle || undefined,
                workspacePath,
            });
            closeCreateDialog();
            await loadDetail(res.executionId);
            loadHistory();
        } catch (err) {
            console.error('创建失败:', err);
        }
    };

    const handleStart = async () => {
        if (!activeId) return;
        try {
            // 将回复框中的详细内容一并发送（用户可能输入了细节但未点「发送」）
            const message = replyText.trim() || undefined;
            setReplyText('');
            await apiPost(`/agent-execution/${activeId}/start`, {message});
            loadDetail(activeId);
            loadHistory();
        } catch (err) {
            console.error('[AgentExec] 启动失败:', err);
        }
    };

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

    const handleReply = async () => {
        if (!activeId || !replyText.trim() || replying) return;
        setReplying(true);
        const message = replyText.trim();
        setReplyText('');
        try {
            await apiPost(`/agent-execution/${activeId}/reply`, {message});
            loadDetail(activeId);
        } catch (err) {
            console.error('回复失败:', err);
        } finally {
            setReplying(false);
        }
    };

    // 确认工具权限：decision=allow/deny，remember 仅 allow 时生效（本次执行内同类工具自动放行）
    const handleConfirmTool = async (decision: 'allow' | 'deny', remember = false, modifiedInput?: Record<string, unknown>) => {
        if (!activeId || !permConfirm.permissionRequestId) return;
        const permissionRequestId = permConfirm.permissionRequestId;
        setPermConfirm({open: false});
        setAskUserAnswers({});
        try {
            await apiPost(`/agent-execution/${activeId}/confirm-tool`, {
                permissionRequestId,
                decision,
                remember,
                ...(modifiedInput ? {modifiedInput} : {}),
            });
        } catch (err) {
            console.error('工具确认失败:', err);
        }
    };

    const handleDelete = async (id: string, status: ExecutionStatus, e: React.MouseEvent) => {
        e.stopPropagation();

        // 运行中的执行不允许直接删除
        if (status === 'running') return;

        if (!confirm('确定删除此执行记录？删除后不可恢复。')) return;

        try {
            await apiDelete(`/agent-execution/${id}`);
            await loadHistory();
            // 清理该执行的分桶日志，避免内存残留
            removeAgentExecutionLogs(id);
            if (activeId === id) {
                setDetail(null);
                setActiveId(null);
                setActiveAgentExecution(null);
            }
        } catch (err) {
            console.error('[AgentExec] delete error:', err);
        }
    };

    const handleNewSession = async () => {
        if (!activeId) return;
        try {
            await apiPost(`/agent-execution/${activeId}/new-session`, {});
            // 刷新详情以反映新会话状态
            await loadDetail(activeId);
        } catch (err) {
            console.error('新会话创建失败:', err);
        }
    };

    // 监听 WebSocket CustomEvent，实时更新 detail 状态（不依赖轮询）
    useEffect(() => {
        if (!activeId) return;

        const handler = (e: Event) => {
            const {type, executionId, ...data} = (e as CustomEvent).detail;
            if (executionId !== activeId) return;

            // 工具权限请求：单独弹确认框，不写入 detail
            if (type === 'permission_request') {
                setPermConfirm({
                    open: true,
                    permissionRequestId: data.permissionRequestId as string,
                    toolName: data.toolName as string,
                    toolInput: data.toolInput as Record<string, unknown>,
                    title: (data.title as string) || (data.displayName as string) || '',
                });
                setAskUserAnswers({});
                return;
            }

            setDetail(prev => {
                if (!prev) return prev;
                switch (type) {
                    case 'status':
                        return {...prev, status: data.status as AgentExecutionDetail['status']};
                    case 'log':
                        return {...prev, logs: [...prev.logs, data.log as string]};
                    case 'thought':
                        return {...prev, thoughts: [...prev.thoughts, data.thought as AgentThought]};
                    case 'subtask': {
                        const subTaskId = data.subTaskId as string;
                        const stepIdx = prev.steps.findIndex(s => s.id === subTaskId);
                        if (stepIdx >= 0) {
                            const steps = [...prev.steps];
                            const newStatus = data.status as AgentExecutionDetail['steps'][0]['status'];
                            steps[stepIdx] = {
                                ...steps[stepIdx],
                                status: newStatus,
                                // 完成或失败时记录结束时间
                                ...(newStatus === 'completed' || newStatus === 'failed'
                                    ? {completedAt: new Date().toISOString()}
                                    : {}),
                            };
                            return {...prev, steps};
                        }
                        // 新 step（running 状态）
                        if (data.status === 'running') {
                            return {
                                ...prev, steps: [...prev.steps, {
                                    id: subTaskId,
                                    title: (data.title as string) || 'Tool',
                                    status: 'running' as const,
                                    startedAt: new Date().toISOString(),
                                    logs: [],
                                }]
                            };
                        }
                        return prev;
                    }
                    case 'stepLog': {
                        // 步骤级日志：追加到对应步骤的 logs 数组
                        const stepId = data.stepId as string;
                        const logText = data.log as string;
                        if (!stepId || !logText) return prev;
                        const stepIdx = prev.steps.findIndex(s => s.id === stepId);
                        if (stepIdx < 0) return prev;
                        const steps = [...prev.steps];
                        steps[stepIdx] = {
                            ...steps[stepIdx],
                            logs: [...steps[stepIdx].logs, logText],
                        };
                        return {...prev, steps};
                    }
                    default:
                        return prev;
                }
            });
        };

        window.addEventListener('agent-execution:update', handler);
        return () => window.removeEventListener('agent-execution:update', handler);
    }, [activeId]);

    // 轮询当前执行状态（不再被 isRunning 阻断，避免 ready→running 竞态）
    useEffect(() => {
        if (!activeId) return;

        let cancelled = false;

        const poll = async () => {
            try {
                const data = await apiGet<AgentExecutionDetail>(`/agent-execution/${activeId}/detail`);
                if (cancelled) return;
                setDetail(data);
                if (['completed', 'failed', 'aborted'].includes(data.status)) {
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
            cancelled = true;
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeId, loadHistory]);

    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            // 离开页面时清除活跃执行标记，避免后台事件继续写入全局日志缓冲
            setActiveAgentExecution(null);
        };
    }, [setActiveAgentExecution]);

    // 日志消息（当前执行分桶 → LogMessageData[]，供 LogViewer 渲染；多 Agent 并行互不混入）
    const currentLogs = activeId ? (logsByExecution[activeId] || []) : [];
    const logMessages = useMemo<LogMessageData[]>(() => toLogMessages(currentLogs), [currentLogs]);

    // 步骤统计（单次遍历）
    const stepsStats = useMemo(() => {
        const steps = detail?.steps || [];
        const stats = {total: steps.length, completed: 0, failed: 0, running: 0};
        for (const s of steps) {
            if (s.status === 'completed') stats.completed++;
            else if (s.status === 'failed') stats.failed++;
            else if (s.status === 'running') stats.running++;
        }
        return stats;
    }, [detail?.steps]);

    return (
        <div className="flex h-full">
            {/* ====== 左侧面板：执行历史列表 ====== */}
            <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        执行历史
                    </span>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={openCreateDialog}
                            className="p-1 rounded-md hover:bg-accent/50 text-muted-foreground hover:text-foreground transition-colors"
                            title="新建执行"
                        >
                            <Plus className="h-4 w-4"/>
                        </button>
                        {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
                    </div>
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
                            {exec.status !== 'running' && (
                                <button
                                    onClick={(e) => handleDelete(exec.id, exec.status, e)}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                                    title="删除"
                                >
                                    <Trash2 className="h-3.5 w-3.5"/>
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* ====== 右侧面板 ====== */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 页面头部 */}
                <div className="border-b border-border px-6 py-3 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-lg font-semibold brand-gradient-text">
                                Agent 执行
                            </h1>
                            <p className="text-xs text-muted-foreground mt-0.5">选择需求，Agent自主完成开发</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {activeId && statusMeta && (
                                <div className={cn(
                                    'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors',
                                    statusMeta.colorClass,
                                )}>
                                    {isRunning && <Loader2 className="h-3 w-3 animate-spin"/>}
                                    {!isRunning && <statusMeta.icon className="h-3 w-3"/>}
                                    {statusMeta.label}
                                </div>
                            )}
                            {canStart && (
                                <Button onClick={handleStart} size="sm">
                                    <Play className="h-3.5 w-3.5 mr-1.5"/>
                                    开始
                                </Button>
                            )}
                            {canAbort && (
                                <Button onClick={handleAbort} variant="outline" size="sm" className="text-destructive">
                                    <Square className="h-3.5 w-3.5 mr-1.5"/>
                                    中止
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* 右侧内容区（未选择 / 已选择） */}
                <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4">

                    {/* ====== 未选择执行：空状态提示 ====== */}
                    {!activeId && (
                        <div className="flex items-center justify-center h-full">
                            <div className="flex flex-col items-center gap-3">
                                <Terminal className="h-10 w-10 text-muted-foreground/30"/>
                                <p className="text-sm text-muted-foreground">点击左上角 + 新建执行</p>
                            </div>
                        </div>
                    )}

                    {/* ====== 已选择执行：详情面板 ====== */}
                    {activeId && detail && (
                        <>

                            {/* --- 执行步骤进度线 --- */}
                            {stepsStats.total > 0 && (
                                <Card className="border-primary/15">
                                    <CardContent className="p-4">
                                        <button
                                            onClick={() => setStepsExpanded(!stepsExpanded)}
                                            className="w-full flex items-center justify-between mb-3"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Bot className="h-4 w-4 text-primary"/>
                                                <span className="text-sm font-semibold">执行步骤</span>
                                                <span className="text-xs text-muted-foreground font-normal">
                                                    {stepsStats.completed}/{stepsStats.total} 完成
                                                </span>
                                                {stepsStats.failed > 0 && (
                                                    <span className="text-xs text-destructive font-normal">
                                                        {stepsStats.failed} 失败
                                                    </span>
                                                )}
                                            </div>
                                            {stepsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground"/> :
                                                <ChevronDown className="h-4 w-4 text-muted-foreground"/>}
                                        </button>

                                        {stepsExpanded && (
                                            <div className="space-y-1.5">
                                                {(detail?.steps || []).map((step) => {
                                                    const duration = calcDuration(step.startedAt, step.completedAt);
                                                    const hasLogs = step.logs && step.logs.length > 0;
                                                    const showLogs = expandedStepLogs.has(step.id);
                                                    return (
                                                        <div
                                                            key={step.id}
                                                            className={cn(
                                                                'rounded-lg border transition-all',
                                                                step.status === 'running' && 'border-blue-500/30 bg-blue-500/5',
                                                                step.status === 'completed' && 'border-emerald-500/20 bg-emerald-500/5',
                                                                step.status === 'failed' && 'border-destructive/30 bg-destructive/5',
                                                            )}
                                                        >
                                                            {/* 步骤标题行 */}
                                                            <div className="flex items-center gap-3 px-3 py-2">
                                                                <div className="shrink-0">
                                                                    {step.status === 'running' && <Loader2
                                                                        className="h-4 w-4 text-blue-500 animate-spin"/>}
                                                                    {step.status === 'completed' && <CheckCircle2
                                                                        className="h-4 w-4 text-emerald-500"/>}
                                                                    {step.status === 'failed' &&
                                                                        <XCircle className="h-4 w-4 text-destructive"/>}
                                                                    {step.status === 'pending' && <Clock
                                                                        className="h-4 w-4 text-muted-foreground/50"/>}
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <Wrench
                                                                            className="h-3 w-3 shrink-0 text-muted-foreground"/>
                                                                        <span
                                                                            className="text-xs font-medium truncate">{step.title}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 mt-0.5">
                                                                        {step.startedAt && (
                                                                            <span
                                                                                className="text-[10px] text-muted-foreground">
                                                                                {formatTime(step.startedAt)}
                                                                            </span>
                                                                        )}
                                                                        {step.status === 'running' && (
                                                                            <span className="relative flex h-1.5 w-1.5">
                                                                                <span
                                                                                    className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"/>
                                                                                <span
                                                                                    className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"/>
                                                                            </span>
                                                                        )}
                                                                        {(step.status === 'completed' || step.status === 'failed') && step.completedAt && (
                                                                            <>
                                                                                <span
                                                                                    className="text-[10px] text-muted-foreground">→ {formatTime(step.completedAt)}</span>
                                                                                {duration != null && (
                                                                                    <span className={cn(
                                                                                        'text-[10px] font-mono',
                                                                                        step.status === 'failed' ? 'text-destructive/70' : 'text-emerald-400',
                                                                                    )}>
                                                                                        耗时 {formatDuration(duration)}
                                                                                    </span>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                        {hasLogs && (
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    setExpandedStepLogs(prev => {
                                                                                        const next = new Set(prev);
                                                                                        if (next.has(step.id)) next.delete(step.id);
                                                                                        else next.add(step.id);
                                                                                        return next;
                                                                                    });
                                                                                }}
                                                                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
                                                                            >
                                                                                {showLogs ? '收起详情 ▲' : `查看详情 (${step.logs.length}) ▼`}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* 步骤日志展开区（可放大查看完整日志） */}
                                                            {showLogs && hasLogs && (
                                                                <ExpandableContent title={step.title || '步骤日志'}>
                                                                    <div
                                                                        className="border-t border-border/30 px-3 py-2 space-y-1 max-h-48 overflow-y-auto bg-black/10 rounded-b-lg">
                                                                        {step.logs.map((logLine, li) => (
                                                                            <div key={li}
                                                                                 className="text-[10px] text-muted-foreground font-mono leading-relaxed break-all">
                                                                                {logLine}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </ExpandableContent>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* 紧凑进度条（折叠时） */}
                                        {!stepsExpanded && stepsStats.total > 0 && (
                                            <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
                                                {(detail?.steps || []).map((step) => (
                                                    <div
                                                        key={step.id}
                                                        className={cn(
                                                            'transition-all duration-500',
                                                            step.status === 'completed' && 'bg-emerald-500',
                                                            step.status === 'running' && 'bg-blue-500 animate-pulse',
                                                            step.status === 'failed' && 'bg-destructive',
                                                            step.status === 'pending' && 'bg-muted-foreground/20',
                                                        )}
                                                        style={{flex: '1'}}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* --- 思考过程面板 --- */}
                            {detail?.thoughts?.length > 0 && (
                                <Card>
                                    <CardContent className="p-4">
                                        <button
                                            onClick={() => setThoughtsExpanded(!thoughtsExpanded)}
                                            className="w-full flex items-center justify-between mb-3"
                                        >
                                            <div className="flex items-center gap-2">
                                                <Brain className="h-4 w-4 text-red-500"/>
                                                <span className="text-sm font-semibold">思考过程</span>
                                                <span className="text-xs text-muted-foreground font-normal">
                                                    {detail?.thoughts?.length} 条
                                                </span>
                                            </div>
                                            {thoughtsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground"/> :
                                                <ChevronDown className="h-4 w-4 text-muted-foreground"/>}
                                        </button>

                                        {thoughtsExpanded && (
                                            <ExpandableContent title="思考过程">
                                                <div className="space-y-2 max-h-72 overflow-y-auto">
                                                    {(detail?.thoughts || []).map((thought, idx) => (
                                                        <ThoughtEntry key={idx} thought={thought} theme={theme}/>
                                                    ))}
                                                </div>
                                            </ExpandableContent>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* --- 实时日志面板（统一 LogViewer：分组折叠 / 工具栏 / Markdown / 自动滚动） --- */}
                            <LogViewer
                                key={activeId}
                                className="min-h-[300px]"
                                messages={logMessages}
                                title="执行日志"
                                isStreaming={isRunning}
                                emptyText={isRunning ? 'Agent正在执行...' : '等待执行...'}
                                onClear={() => activeId && setAgentExecutionLogs(activeId, [])}
                            />

                            {/* --- 底部消息输入 --- */}
                            <Card className="border-primary/15">
                                <CardContent className="p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4 text-primary"/>
                                            <span className="text-sm font-semibold">发送消息给 Agent</span>
                                        </div>
                                        <ContextIndicator
                                            logs={currentLogs}
                                            onSuggestNewSession={handleNewSession}
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <ExpandableTextarea
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
                                            title="发送消息给 Agent"
                                            optimizable
                                            optimizePurpose="reply"
                                            wrapperClassName="flex-1"
                                            className="bg-background border border-input rounded-md px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-50"
                                        />
                                        <Button
                                            onClick={handleReply}
                                            disabled={!replyText.trim() || replying || isRunning}
                                            className="self-end"
                                            size="sm"
                                        >
                                            {replying ? <Loader2 className="h-4 w-4 animate-spin"/> :
                                                <Send className="h-4 w-4"/>}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </>
                    )}
                </div>
            </div>

            {/* ====== 新建执行弹窗 ====== */}
            <dialog
                ref={dialogRef}
                onClose={() => setShowCreateDialog(false)}
                className="backdrop:bg-black/50 bg-transparent p-0 m-auto"
            >
                <div className="bg-background border border-border rounded-lg shadow-xl w-[480px] p-6 space-y-4">
                    <h2 className="text-sm font-semibold">新建 Agent 执行</h2>

                    {/* 工作空间（必选） */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            工作空间 <span className="text-destructive">*</span>
                        </label>
                        <select
                            value={workspacePath}
                            onChange={(e) => setWorkspacePath(e.target.value)}
                            className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                            <option value="">选择工作空间...</option>
                            {workspaceHistory.map((p) => (
                                <option key={p} value={p}>{p}</option>
                            ))}
                        </select>
                    </div>

                    {/* 需求（可选） */}
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                            需求文档 <span
                            className="text-muted-foreground/60">（可选，也可创建后在下方消息框补充详细信息）</span>
                        </label>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                            <button
                                onClick={() => setReqMode('saved')}
                                className={cn(
                                    'flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                                    reqMode === 'saved'
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:bg-accent/30'
                                )}
                            >
                                <FolderOpen className="h-3 w-3"/>
                                已保存需求
                            </button>
                            <button
                                onClick={() => setReqMode('manual')}
                                className={cn(
                                    'flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                                    reqMode === 'manual'
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-border text-muted-foreground hover:bg-accent/30'
                                )}
                            >
                                <FileText className="h-3 w-3"/>
                                手动输入
                            </button>
                        </div>

                        {reqMode === 'saved' && (
                            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
                                {savedRequirements.length === 0 ? (
                                    <p className="text-xs text-muted-foreground p-3 text-center">暂无已保存的需求</p>
                                ) : (
                                    savedRequirements.map((req) => (
                                        <div
                                            key={req.id}
                                            onClick={() => setSelectedRequirement(req)}
                                            className={cn(
                                                'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors border-b border-border/50 last:border-0',
                                                selectedRequirement?.id === req.id ? 'bg-primary/5' : 'hover:bg-accent/30'
                                            )}
                                        >
                                            <div className={cn(
                                                'w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center',
                                                selectedRequirement?.id === req.id
                                                    ? 'border-primary bg-primary'
                                                    : 'border-muted-foreground/40'
                                            )}>
                                                {selectedRequirement?.id === req.id &&
                                                    <div className="w-1 h-1 rounded-full bg-primary-foreground"/>}
                                            </div>
                                            <p className="text-xs truncate">{req.number ? `${req.number} ` : ''}{req.title}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {reqMode === 'manual' && (
                            <div>
                                <input
                                    type="text"
                                    value={manualRequirementText}
                                    onChange={(e) => setManualRequirementText(e.target.value)}
                                    placeholder="输入任务标题，创建后在下方消息框补充详细需求..."
                                    className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                    💡 提示：创建后在下方输入框中描述具体任务详情，点击「开始」时将自动发送并开始执行
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex justify-end gap-2 pt-1">
                        <Button variant="outline" size="sm" onClick={closeCreateDialog}>取消</Button>
                        <Button
                            size="sm"
                            onClick={handleCreate}
                            disabled={!workspacePath}
                        >
                            <Sparkles className="h-3.5 w-3.5 mr-1.5"/>
                            创建
                        </Button>
                    </div>
                </div>
            </dialog>

            {/* 工具权限确认弹框（agent 执行中 canUseTool 触发） */}
            {permConfirm.open && permConfirm.permissionRequestId && (
                <PermissionDialog
                    permConfirm={permConfirm}
                    askUserAnswers={askUserAnswers}
                    setAskUserAnswers={setAskUserAnswers}
                    onConfirm={handleConfirmTool}
                    onClose={() => {
                        setPermConfirm({open: false});
                        setAskUserAnswers({});
                    }}
                />
            )}
        </div>
    );
}

// === 子组件 ===

/** 思考条目：支持长内容折叠 */
function ThoughtEntry({thought, theme}: { thought: AgentThought; theme: string }) {
    const [expanded, setExpanded] = useState(false);
    const isLong = thought.content.length > 300;
    const display = isLong && !expanded ? thought.content.slice(0, 300) + '...' : thought.content;

    const iconMap: Record<AgentThought['type'], { icon: typeof Brain; color: string }> = {
        analysis: {icon: Brain, color: 'text-red-400'},
        planning: {icon: ListTodo, color: 'text-blue-400'},
        decision: {icon: Sparkles, color: 'text-amber-400'},
        tool_selection: {icon: Wrench, color: 'text-emerald-400'},
        error: {icon: XCircle, color: 'text-red-400'},
    };

    const labelMap: Record<AgentThought['type'], string> = {
        analysis: '分析',
        planning: '规划',
        decision: '决策',
        tool_selection: '工具选择',
        error: '错误',
    };

    const {icon: Icon, color} = iconMap[thought.type] || iconMap.analysis;

    return (
        <div className={cn(
            'rounded-lg p-3 border transition-all',
            theme !== 'light' ? 'bg-red-500/5 border-red-500/15' : 'bg-red-50/50 border-red-200/50'
        )}>
            <div className="flex items-center gap-2 mb-1">
                <Icon className={cn('h-3 w-3', color)}/>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                    {labelMap[thought.type]}
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                    {formatTime(thought.timestamp)}
                </span>
            </div>
            <div className="log-message">
                <MarkdownContent content={display}/>
            </div>
            {isLong && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                    {expanded ? <ChevronUp className="h-3 w-3"/> : <ChevronRight className="h-3 w-3"/>}
                    {expanded ? '收起' : '展开'}
                </button>
            )}
        </div>
    );
}

// === 工具权限确认弹框组件 ===

interface AskUserQuestionDef {
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect?: boolean;
}

interface PermissionDialogProps {
    permConfirm: {
        open: boolean;
        permissionRequestId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        title?: string;
    };
    askUserAnswers: Record<string, string>;
    setAskUserAnswers: (v: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
    onConfirm: (decision: 'allow' | 'deny', remember?: boolean, modifiedInput?: Record<string, unknown>) => void;
    onClose: () => void;
}

function PermissionDialog({permConfirm, askUserAnswers, setAskUserAnswers, onConfirm, onClose}: PermissionDialogProps) {
    // 结构性检测 AskUserQuestion（支持 MCP 前缀如 mcp__server__AskUserQuestion）
    const isAskUser = useMemo(() => {
        if (!permConfirm.toolInput) return false;
        // Case 1: 有 questions 数组，且首项含 question + options
        const qs = permConfirm.toolInput.questions;
        if (Array.isArray(qs) && qs.length > 0) {
            const first = qs[0] as Record<string, unknown>;
            if (typeof first.question === 'string' && Array.isArray(first.options)) return true;
        }
        // Case 2: 顶层 options 数组（简化 AskUser 模式）
        const opts = permConfirm.toolInput.options;
        if (Array.isArray(opts) && opts.length > 0
            && typeof (opts[0] as Record<string, unknown>)?.label === 'string') {
            return true;
        }
        return false;
    }, [permConfirm.toolInput]);

    const questions: AskUserQuestionDef[] = useMemo(() => {
        if (!isAskUser || !permConfirm.toolInput) return [];
        // Case 1: 标准 questions 数组
        const raw = permConfirm.toolInput.questions;
        if (Array.isArray(raw)) return raw as AskUserQuestionDef[];
        // Case 2: 顶层 options → 合成单个问题
        const topOpts = permConfirm.toolInput.options;
        if (Array.isArray(topOpts)) {
            return [{
                question: (permConfirm.toolInput.question as string) || '请选择',
                header: (permConfirm.toolInput.header as string) || '选项',
                options: topOpts as Array<{ label: string; description: string }>,
                multiSelect: (permConfirm.toolInput.multiSelect as boolean) || false,
            }];
        }
        return [];
    }, [isAskUser, permConfirm.toolInput]);

    const allAnswered = useMemo(() => {
        if (questions.length === 0) return true;
        return questions.every(q => askUserAnswers[q.question] != null && askUserAnswers[q.question] !== '');
    }, [questions, askUserAnswers]);

    const selectOption = (questionText: string, optionLabel: string, multiSelect: boolean | undefined) => {
        setAskUserAnswers(prev => {
            if (multiSelect) {
                // 多选：逗号分隔追加/移除
                const current = (prev[questionText] || '').split(',').filter(Boolean);
                const idx = current.indexOf(optionLabel);
                if (idx >= 0) current.splice(idx, 1);
                else current.push(optionLabel);
                return {...prev, [questionText]: current.join(',')};
            }
            // 单选
            return {...prev, [questionText]: optionLabel};
        });
    };

    // 非 AskUserQuestion：展示标准权限确认 + JSON 输入预览
    if (!isAskUser || questions.length === 0) {
        return (
            <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="glass-panel rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
                    <h3 className="text-base font-semibold mb-1">工具权限确认</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                        {permConfirm.title || 'Agent 请求使用工具'}
                    </p>
                    <div className="bg-muted/50 border border-border rounded-md p-3 mb-4">
                        <div className="text-xs text-muted-foreground mb-1">工具：{permConfirm.toolName}</div>
                        {permConfirm.toolInput && (
                            <pre
                                className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto">
                                {permConfirm.toolInput.command
                                    ? String(permConfirm.toolInput.command)
                                    : JSON.stringify(permConfirm.toolInput, null, 2)}
                            </pre>
                        )}
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => onConfirm('deny')}>
                            拒绝
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onConfirm('allow', true)}>
                            允许并记住
                        </Button>
                        <Button size="sm" onClick={() => onConfirm('allow')}>
                            允许
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // AskUserQuestion：渲染问题与选项
    return (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="glass-panel rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto">
                <h3 className="text-base font-semibold mb-1">
                    {permConfirm.title || 'Agent 向您提问'}
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                    请回答以下问题，帮助 Agent 更好地完成任务
                </p>

                <div className="space-y-4 mb-4">
                    {questions.map((q, qi) => (
                        <div key={qi} className="bg-muted/30 border border-border rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <span
                                    className="text-[10px] font-medium text-muted-foreground uppercase bg-muted-foreground/10 px-1.5 py-0.5 rounded">
                                    {q.header || `问题 ${qi + 1}`}
                                </span>
                            </div>
                            <p className="text-sm font-medium mb-2">{q.question}</p>
                            <div className="space-y-1">
                                {q.options.map((opt, oi) => {
                                    const isSelected = q.multiSelect
                                        ? (askUserAnswers[q.question] || '').split(',').includes(opt.label)
                                        : askUserAnswers[q.question] === opt.label;
                                    return (
                                        <button
                                            key={oi}
                                            onClick={() => selectOption(q.question, opt.label, q.multiSelect)}
                                            className={cn(
                                                'w-full text-left rounded-md border px-3 py-2 text-xs transition-all',
                                                isSelected
                                                    ? 'border-primary bg-primary/10 text-primary'
                                                    : 'border-border hover:bg-accent/30 text-foreground/80',
                                            )}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    'w-3.5 h-3.5 rounded border-2 shrink-0 flex items-center justify-center transition-colors',
                                                    q.multiSelect ? 'rounded' : 'rounded-full',
                                                    isSelected
                                                        ? 'border-primary bg-primary'
                                                        : 'border-muted-foreground/40',
                                                )}>
                                                    {isSelected && (
                                                        <CheckCircle2 className="h-2.5 w-2.5 text-primary-foreground"/>
                                                    )}
                                                </span>
                                                <span className="font-medium">{opt.label}</span>
                                            </div>
                                            {opt.description && (
                                                <p className="text-[10px] text-muted-foreground mt-1 ml-5.5">
                                                    {opt.description}
                                                </p>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onConfirm('deny')}>
                        拒绝
                    </Button>
                    <Button
                        size="sm"
                        disabled={!allAnswered}
                        onClick={() => {
                            // 将答案编码后传给 bridge（SDK 的 PermissionResult 认 updatedInput 字段）
                            const answersMap: Record<string, string> = {};
                            questions.forEach(q => {
                                answersMap[q.question] = askUserAnswers[q.question] || '';
                            });
                            // updatedInput 会替换工具输入，需同时带上原始 questions 和用户 answers
                            onConfirm('allow', false, {
                                ...(permConfirm.toolInput?.questions ? {questions: permConfirm.toolInput.questions} : {}),
                                answers: answersMap,
                            });
                        }}
                    >
                        <Send className="h-3.5 w-3.5 mr-1.5"/>
                        提交回答
                    </Button>
                </div>
            </div>
        </div>
    );
}
