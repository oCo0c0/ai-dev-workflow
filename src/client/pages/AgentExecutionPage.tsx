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

/** 日志消息类型检测 */
type LogKind = 'thinking' | 'tool_use' | 'tool_result' | 'user' | 'normal';

function parseLog(log: string): { kind: LogKind; content: string } {
    if (log.includes('**User:**')) return {kind: 'user', content: log};
    try {
        const parsed = JSON.parse(log);
        if (parsed.type === 'thinking') return {kind: 'thinking', content: parsed.content || ''};
        if (parsed.type === 'tool_use') return {kind: 'tool_use', content: parsed.toolName || 'Tool'};
        if (parsed.type === 'tool_result') return {kind: 'tool_result', content: parsed.content || ''};
        return {kind: 'normal', content: parsed.content || log};
    } catch {
        return {kind: 'normal', content: log};
    }
}

const MESSAGES_PER_GROUP = 10;

// === 日志分组折叠组件 ===

interface LogGroupProps {
    groupIndex: number;
    logs: string[];
    startIdx: number;
    endIdx: number;
    isExpanded: boolean;
    onToggle: () => void;
    theme: string;
}

function LogGroup({logs, startIdx, endIdx, isExpanded, onToggle, theme}: LogGroupProps) {
    return (
        <div className="mb-2">
            <button
                onClick={onToggle}
                className={cn(
                    'w-full py-1.5 px-3 rounded-md text-xs font-medium transition-all duration-200 flex items-center justify-between',
                    isExpanded
                        ? cn('border text-blue-300', theme !== 'light' ? 'bg-blue-500/15 border-blue-500/25' : 'bg-blue-50 border-blue-200')
                        : cn('border text-muted-foreground', theme !== 'light' ? 'bg-muted/30 border-border/50 hover:bg-muted/50' : 'bg-gray-50 border-gray-200 hover:bg-gray-100')
                )}
            >
                <span className="flex items-center gap-2">
                    {isExpanded ? <ChevronUp className="h-3 w-3"/> : <ChevronDown className="h-3 w-3"/>}
                    消息 {startIdx + 1}-{endIdx}
                </span>
                <span className="text-[10px] opacity-60">{logs.length} 条</span>
            </button>
            {isExpanded && (
                <div className="space-y-1.5 mt-1.5">
                    {logs.map((log, i) => {
                        const {kind, content} = parseLog(log);
                        const displayText = content.length > 3000 ? content.slice(0, 3000) + '...' : content;

                        return (
                            <LogEntry key={`${startIdx + i}-${i}`} kind={kind} content={displayText} theme={theme}/>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function LogEntry({kind, content, theme}: { kind: LogKind; content: string; theme: string }) {
    return (
        <div className={cn(
            'rounded-md text-xs font-mono transition-all duration-150',
            'animate-in fade-in slide-in-from-bottom-1 duration-200',
            kind === 'thinking' && cn(
                'pl-3 pr-3 py-2 border-l-2 border-purple-500',
                theme !== 'light' ? 'bg-purple-500/10 text-purple-200' : 'bg-purple-50 text-purple-800'
            ),
            kind === 'tool_use' && cn(
                'pl-3 pr-3 py-2 border-l-2 border-emerald-500',
                theme !== 'light' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-emerald-50 text-emerald-800'
            ),
            kind === 'tool_result' && cn(
                'pl-3 pr-3 py-2 border-l-2 border-gray-400',
                theme !== 'light' ? 'bg-gray-800/50 text-gray-300' : 'bg-gray-100 text-gray-600'
            ),
            kind === 'user' && cn(
                'ml-8 pl-3 pr-3 py-2 border-l-2 border-blue-500 shadow-sm',
                theme !== 'light' ? 'bg-blue-500/10 text-blue-200' : 'bg-blue-50 text-blue-800'
            ),
            kind === 'normal' && cn(
                'pl-3 pr-3 py-2 border border-border/40',
                theme !== 'light' ? 'bg-gray-800/40 text-gray-300' : 'bg-gray-50 text-gray-700'
            ),
        )}>
            <div className="flex items-start gap-2">
                {kind === 'thinking' && <Brain className="h-3 w-3 mt-0.5 text-purple-400 shrink-0"/>}
                {kind === 'tool_use' && <Wrench className="h-3 w-3 mt-0.5 text-emerald-400 shrink-0"/>}
                {kind === 'tool_result' && <Terminal className="h-3 w-3 mt-0.5 text-gray-400 shrink-0"/>}
                {kind === 'user' && <MessageSquare className="h-3 w-3 mt-0.5 text-blue-400 shrink-0"/>}
                <p className="break-words whitespace-pre-wrap flex-1 min-w-0">{content}</p>
            </div>
        </div>
    );
}

// === 主组件 ===

export default function AgentExecutionPage() {
    useTranslation();
    const theme = useAppStore((s) => s.ui.theme);

    const agentLogs = useAppStore((s) => s.agents.logs);
    const setAgentLogs = useAppStore((s) => s.setAgentLogs);
    const clearAgentLogs = useAppStore((s) => s.clearAgentLogs);

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
    const [expandedLogGroups, setExpandedLogGroups] = useState<Set<number>>(new Set());

    // 工具权限确认弹框（agent 执行中 canUseTool 触发）
    const [permConfirm, setPermConfirm] = useState<{
        open: boolean;
        permissionRequestId?: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        title?: string;
    }>({open: false});

    // DOM 引用
    const logEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // 派生状态（基于 STATUS_META，新增状态无需改 UI 代码）
    const execStatus = detail?.status ?? 'idle';
    const statusMeta = execStatus !== 'idle' ? STATUS_META[execStatus] : null;
    const isRunning = execStatus === 'running';
    const canStart = execStatus === 'ready';
    const canAbort = isRunning;

    // 切换执行时清空日志展开状态
    useEffect(() => {
        setExpandedLogGroups(new Set());
    }, [activeId]);

    // 日志自动滚动
    useEffect(() => {
        logEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [agentLogs.length]);

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
            // 用历史日志初始化 agentLogs，而非清空
            setAgentLogs(data.logs || []);
        } catch (err) {
            console.error('[AgentExec] loadDetail error:', err);
        }
    }, [setAgentLogs]);

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
            await apiPost(`/agent-execution/${activeId}/start`);
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
    const handleConfirmTool = async (decision: 'allow' | 'deny', remember = false) => {
        if (!activeId || !permConfirm.permissionRequestId) return;
        const permissionRequestId = permConfirm.permissionRequestId;
        setPermConfirm({open: false});
        try {
            await apiPost(`/agent-execution/${activeId}/confirm-tool`, {permissionRequestId, decision, remember});
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
            if (activeId === id) {
                setDetail(null);
                setActiveId(null);
                clearAgentLogs();
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
                            steps[stepIdx] = {
                                ...steps[stepIdx],
                                status: data.status as AgentExecutionDetail['steps'][0]['status']
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
        };
    }, []);

    // 自动展开最新日志组
    useEffect(() => {
        const total = agentLogs.length;
        if (total > 0) {
            const totalGroups = Math.ceil(total / MESSAGES_PER_GROUP);
            setExpandedLogGroups(prev => new Set([...prev, totalGroups - 1]));
        }
    }, [agentLogs.length]);

    // 分组日志
    const logGroups = useMemo(() => {
        const groups: Array<{ logs: string[]; groupIndex: number; startIdx: number; endIdx: number }> = [];
        for (let i = 0; i < agentLogs.length; i += MESSAGES_PER_GROUP) {
            groups.push({
                logs: agentLogs.slice(i, i + MESSAGES_PER_GROUP),
                groupIndex: groups.length,
                startIdx: i,
                endIdx: Math.min(i + MESSAGES_PER_GROUP, agentLogs.length),
            });
        }
        return groups;
    }, [agentLogs]);

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
                            <h1 className="text-lg font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">
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
                                                {(detail?.steps || []).map((step) => (
                                                    <div
                                                        key={step.id}
                                                        className={cn(
                                                            'flex items-center gap-3 px-3 py-2 rounded-lg border transition-all',
                                                            step.status === 'running' && 'border-blue-500/30 bg-blue-500/5',
                                                            step.status === 'completed' && 'border-emerald-500/20 bg-emerald-500/5',
                                                            step.status === 'failed' && 'border-destructive/30 bg-destructive/5',
                                                        )}
                                                    >
                                                        <div className="shrink-0">
                                                            {step.status === 'running' && <Loader2
                                                                className="h-4 w-4 text-blue-500 animate-spin"/>}
                                                            {step.status === 'completed' &&
                                                                <CheckCircle2 className="h-4 w-4 text-emerald-500"/>}
                                                            {step.status === 'failed' &&
                                                                <XCircle className="h-4 w-4 text-destructive"/>}
                                                            {step.status === 'pending' &&
                                                                <Clock className="h-4 w-4 text-muted-foreground/50"/>}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <Wrench className="h-3 w-3 text-muted-foreground"/>
                                                                <span
                                                                    className="text-xs font-medium truncate">{step.title}</span>
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-0.5">
                                                                {step.startedAt && (
                                                                    <span className="text-[10px] text-muted-foreground">
                                                                        {formatTime(step.startedAt)}
                                                                    </span>
                                                                )}
                                                                {step.status === 'running' && stepsStats.running > 0 && (
                                                                    <span className="relative flex h-1.5 w-1.5">
                                                                        <span
                                                                            className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"/>
                                                                        <span
                                                                            className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"/>
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
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
                                                <Brain className="h-4 w-4 text-purple-500"/>
                                                <span className="text-sm font-semibold">思考过程</span>
                                                <span className="text-xs text-muted-foreground font-normal">
                                                    {detail?.thoughts?.length} 条
                                                </span>
                                            </div>
                                            {thoughtsExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground"/> :
                                                <ChevronDown className="h-4 w-4 text-muted-foreground"/>}
                                        </button>

                                        {thoughtsExpanded && (
                                            <div className="space-y-2 max-h-72 overflow-y-auto">
                                                {(detail?.thoughts || []).map((thought, idx) => (
                                                    <ThoughtEntry key={idx} thought={thought} theme={theme}/>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* --- 实时日志面板（分组折叠 + 颜色标记） --- */}
                            <div className={cn(
                                'flex-1 min-h-[300px] rounded-lg border overflow-hidden flex flex-col shadow-sm',
                                theme !== 'light' ? 'bg-gray-900' : 'bg-white'
                            )}>
                                {/* 日志面板头部 */}
                                <div className={cn(
                                    'flex items-center gap-2 px-4 py-2 border-b',
                                    theme !== 'light' ? 'bg-gray-800/80 border-gray-700/50' : 'bg-gray-50 border-gray-200'
                                )}>
                                    <Terminal className="h-3.5 w-3.5 text-emerald-500"/>
                                    <span className="text-xs font-medium text-emerald-500 font-mono">执行日志</span>
                                    <span
                                        className="text-[10px] text-muted-foreground font-mono">{agentLogs.length} 条</span>
                                    <div className="ml-auto flex items-center gap-3">
                                        {/* 图例 */}
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2 h-2 rounded-full bg-purple-500"/>
                                            <span className="text-[10px] text-muted-foreground">思考</span>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500"/>
                                            <span className="text-[10px] text-muted-foreground">工具</span>
                                        </div>
                                        {isRunning && (
                                            <span className="flex items-center gap-1.5 text-xs text-emerald-500">
                                                <span className="relative flex h-2 w-2">
                                                    <span
                                                        className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
                                                    <span
                                                        className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
                                                </span>
                                                实时
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* 日志内容 */}
                                <div className="flex-1 overflow-y-auto p-3">
                                    {agentLogs.length === 0 ? (
                                        <div className="text-muted-foreground text-center py-8 text-xs">
                                            {isRunning ? 'Agent正在执行...' : '等待执行...'}
                                        </div>
                                    ) : (
                                        logGroups.map((group) => (
                                            <LogGroup
                                                key={group.groupIndex}
                                                groupIndex={group.groupIndex}
                                                logs={group.logs}
                                                startIdx={group.startIdx}
                                                endIdx={group.endIdx}
                                                isExpanded={expandedLogGroups.has(group.groupIndex)}
                                                onToggle={() => setExpandedLogGroups(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(group.groupIndex)) next.delete(group.groupIndex);
                                                    else next.add(group.groupIndex);
                                                    return next;
                                                })}
                                                theme={theme}
                                            />
                                        ))
                                    )}
                                    <div ref={logEndRef}/>
                                </div>
                            </div>

                            {/* --- 底部消息输入 --- */}
                            <Card className="border-primary/15">
                                <CardContent className="p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                            <MessageSquare className="h-4 w-4 text-primary"/>
                                            <span className="text-sm font-semibold">发送消息给 Agent</span>
                                        </div>
                                        <ContextIndicator
                                            logs={agentLogs}
                                            onSuggestNewSession={handleNewSession}
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <textarea
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
                            需求文档 <span className="text-muted-foreground/60">（可选，也可创建后手动输入）</span>
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
                            <textarea
                                value={manualRequirementText}
                                onChange={(e) => setManualRequirementText(e.target.value)}
                                placeholder="描述你的需求，Agent将自主分析并执行..."
                                rows={4}
                                className="w-full bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                            />
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
                <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/50">
                    <div className="bg-background rounded-lg border border-border shadow-xl p-6 max-w-lg w-full mx-4">
                        <h3 className="text-base font-semibold mb-1">工具权限确认</h3>
                        <p className="text-sm text-muted-foreground mb-3">
                            {permConfirm.title || 'Agent 请求使用工具'}
                        </p>
                        <div className="bg-muted/50 border border-border rounded-md p-3 mb-4">
                            <div className="text-xs text-muted-foreground mb-1">工具：{permConfirm.toolName}</div>
                            {permConfirm.toolInput && (
                                <pre className="text-xs font-mono whitespace-pre-wrap break-all text-foreground/90 max-h-40 overflow-y-auto">
                                    {permConfirm.toolInput.command
                                        ? String(permConfirm.toolInput.command)
                                        : JSON.stringify(permConfirm.toolInput, null, 2).slice(0, 500)}
                                </pre>
                            )}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleConfirmTool('deny')}>
                                拒绝
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleConfirmTool('allow', true)}>
                                允许并记住
                            </Button>
                            <Button size="sm" onClick={() => handleConfirmTool('allow')}>
                                允许
                            </Button>
                        </div>
                    </div>
                </div>
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
        analysis: {icon: Brain, color: 'text-purple-400'},
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
            theme !== 'light' ? 'bg-purple-500/5 border-purple-500/15' : 'bg-purple-50/50 border-purple-200/50'
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
            <p className="text-xs text-foreground whitespace-pre-wrap break-words">{display}</p>
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
