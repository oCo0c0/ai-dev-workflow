/**
 * @file PlanPage.tsx
 * @description 开发计划（Plan）页面组件
 *
 * 本页面是AI辅助开发流程的核心枢纽，负责：
 * - 展示和管理计划历史记录（左侧面板）
 * - 查看和编辑Claude生成的开发计划（右侧面板）
 * - 实时显示Claude的生成过程输出（流式日志）
 * - 支持与Claude对话式交互（回复功能），提供补充信息或回答Claude的提问
 * - 确认计划并启动执行流程（跳转到执行页面）
 *
 * 页面采用左右分栏布局：
 * - 左侧（w-64）：计划历史列表，支持查看和删除历史计划
 * - 右侧：当前计划详情，包含生成进度、计划内容、编辑器和回复输入框
 *
 * 计划的生成过程通过轮询机制（每2秒）跟踪状态变化，
 * 实时日志通过全局状态管理（WebSocket推送）展示。
 */
import {useState, useEffect, useRef, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {apiGet, apiPost, apiPut, apiDelete} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn, formatRelativeTime} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {
    Sparkles,
    Pencil,
    RefreshCw,
    Save,
    X,
    AlertTriangle,
    Loader2,
    Play,
    Send,
    MessageSquare,
    Clock,
    FolderOpen,
    FileText,
    Trash2,
    CheckCircle2,
    XCircle,
    Pause,
} from 'lucide-react';

/**
 * @interface PlanSummary
 * @description 计划摘要信息
 *
 * 用于计划历史列表的轻量级数据结构，
 * 不包含完整的计划输出内容，仅展示基本信息。
 */
interface PlanSummary {
    /** 计划唯一标识符 */
    id: string;
    /** 关联的需求ID */
    requirementId: string;
    /** 工作空间路径 */
    workspacePath: string;
    /** 计划状态：generating（生成中）、paused（已暂停）、ready（就绪）、failed（失败） */
    status: 'generating' | 'paused' | 'ready' | 'failed';
    /** 计划摘要文本（截取前段用于列表展示） */
    summary?: string;
    /** 创建时间（ISO 8601格式） */
    createdAt: string;
    /** 更新时间（ISO 8601格式） */
    updatedAt: string;
}

/**
 * @interface StoredPlan
 * @description 完整的存储计划信息
 *
 * 继承PlanSummary，增加了Claude的完整输出内容和错误信息，
 * 用于计划详情页面的完整展示。
 */
interface StoredPlan extends PlanSummary {
    /** Claude生成的原始输出文本（Markdown格式） */
    rawOutput?: string;
    /** 生成失败时的错误信息 */
    error?: string;
    /** Claude会话ID，用于对话上下文关联 */
    sessionId?: string;
}

/**
 * @function PlanPage
 * @description 开发计划页面主组件（默认导出）
 *
 * 本组件实现了计划管理的完整生命周期：
 * 1. **计划生成**：调用/plan/generate API启动Claude生成计划，通过轮询跟踪进度
 * 2. **计划查看**：展示Claude的生成过程和最终结果，支持Markdown格式渲染
 * 3. **计划编辑**：支持手动编辑计划内容并保存
 * 4. **对话交互**：通过/plan/:id/reply API与Claude对话，获取补充信息或回答问题
 * 5. **执行启动**：确认计划后调用/execution/start API启动执行，跳转到执行页面
 * 6. **历史管理**：加载和浏览历史计划记录，支持删除操作
 *
 * 状态管理要点：
 * - 全局状态（app-store）：taskId、planLogs、selectedRequirement、currentWorkspace
 * - 本地状态：planHistory、activePlanId、plan、generating、editing等
 * - 轮询机制：每2秒检查一次计划状态，直到ready或failed
 */
export default function PlanPage() {
    const navigate = useNavigate();

    // ─── 从全局状态（Zustand store）获取数据和更新方法 ───
    const taskId = useAppStore((s) => s.plan.taskId);                         // 当前计划任务ID（从流水线执行或localStorage恢复）
    const planLogs = useAppStore((s) => s.plan.logs);                         // Claude实时输出日志（WebSocket推送）
    const selectedRequirement = useAppStore((s) => s.requirements.selected);   // 当前选中的需求
    const currentWorkspace = useAppStore((s) => s.workspace.current);          // 当前工作空间
    const setPlanStatus = useAppStore((s) => s.setPlanStatus);                // 设置计划状态
    const planPhase = useAppStore((s) => s.plan.status);                      // 当前计划阶段状态
    const setPlanTaskId = useAppStore((s) => s.setPlanTaskId);                // 设置计划任务ID
    const setExecutionId = useAppStore((s) => s.setExecutionId);              // 设置执行ID（用于执行页面）
    const clearExecutionLogs = useAppStore((s) => s.clearExecutionLogs);      // 清除执行日志
    const clearPlanLogs = useAppStore((s) => s.clearPlanLogs);                // 清除计划日志

    // ─── 历史列表状态 ───
    const [planHistory, setPlanHistory] = useState<PlanSummary[]>([]);   // 计划历史列表
    const [loadingHistory, setLoadingHistory] = useState(false);          // 历史列表加载状态

    // ─── 当前计划状态 ───
    const [activePlanId, setActivePlanId] = useState<string | null>(taskId);  // 当前查看的计划ID
    const [plan, setPlan] = useState<StoredPlan | null>(null);                // 当前计划的完整数据
    const [generating, setGenerating] = useState(false);                      // 是否正在生成中
    const [generatingElapsed, setGeneratingElapsed] = useState(0);            // 生成已耗时（秒）
    const [editing, setEditing] = useState(false);                            // 是否处于编辑模式
    const [editedSummary, setEditedSummary] = useState('');                   // 编辑中的计划内容
    const [error, setError] = useState<string | null>(null);                  // 错误信息
    const [executing, setExecuting] = useState(false);                        // 是否正在启动执行
    const [replyText, setReplyText] = useState('');                           // 回复输入框文本
    const [replying, setReplying] = useState(false);                          // 是否正在发送回复

    // ─── 引用 ───
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);      // 轮询定时器引用
    const logEndRef = useRef<HTMLDivElement>(null);                            // 日志区域底部锚点（用于自动滚动）
    const replyInputRef = useRef<HTMLTextAreaElement>(null);                   // 回复输入框引用（用于焦点恢复）

    // 计算是否可以生成计划：需要已选择需求、已设置工作空间、且当前未在生成中
    const canGenerate = selectedRequirement && currentWorkspace && !generating;

    // 当计划日志更新时，自动滚动到底部以显示最新内容
    useEffect(() => {
        logEndRef.current?.scrollIntoView({behavior: 'smooth'});
    }, [planLogs]);

    /**
     * 加载计划历史列表
     * 从后端获取所有计划的摘要信息，用于左侧历史面板展示
     */
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const data = await apiGet<PlanSummary[]>('/plan/list');
            setPlanHistory(data);
        } catch {
            // 加载失败时静默处理，不阻塞页面
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    // 页面初始化时加载计划历史
    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    /**
     * 加载指定计划的完整数据
     * 根据计划状态设置生成中标志
     *
     * @param id - 计划ID
     */
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
            // 加载失败时静默处理
        }
    }, []);

    /**
     * 当taskId变化时自动加载对应计划
     *
     * taskId可能来自：
     * - 流水线执行向导跳转（通过全局状态传递）
     * - localStorage持久化恢复（页面刷新后）
     *
     * 加载后根据计划状态决定是否启动轮询
     */
    useEffect(() => {
        if (!taskId) return;
        setActivePlanId(taskId);
        setError(null);
        clearPlanLogs();
        // 尝试立即加载计划数据；只有当计划确实还在生成中时才设置generating标志
        apiGet<StoredPlan>(`/plan/${taskId}`).then((data) => {
            setPlan(data);
            if (data.status === 'generating') {
                setGenerating(true);
            } else {
                setGenerating(false);
            }
        }).catch(() => {
            // 计划不存在或请求失败——忽略，轮询机制会处理后续状态
        });
    }, [taskId, clearPlanLogs]);

    /**
     * 轮询活跃计划的状态
     *
     * 当存在活跃计划ID时，每2秒请求一次最新状态：
     * - ready：更新计划数据，停止生成状态，刷新历史列表
     * - failed：显示错误信息，停止生成状态
     * - generating：持续更新计划数据以显示最新内容
     *
     * 组件卸载或activePlanId变化时清理轮询定时器
     */
    useEffect(() => {
        if (!activePlanId) return;

        const poll = async () => {
            try {
                const result = await apiGet<StoredPlan>(`/plan/${activePlanId}`);
                if (result.status === 'ready') {
                    setPlan(result);
                    setGenerating(false);
                    setPlanStatus('ready');
                    loadHistory();
                    if (pollRef.current) clearInterval(pollRef.current);
                } else if (result.status === 'failed') {
                    setPlan(result);
                    setError(result.error || 'Plan generation failed');
                    setGenerating(false);
                    setPlanStatus('idle');
                    if (pollRef.current) clearInterval(pollRef.current);
                } else if (result.status === 'paused') {
                    setPlan(result);
                    setGenerating(false);
                    setPlanStatus('paused');
                    if (pollRef.current) clearInterval(pollRef.current);
                } else {
                    setPlan(result);
                }
            } catch {
                // 请求失败时继续轮询，不中断
            }
        };

        // 立即执行一次轮询，然后设置定时器
        poll();
        pollRef.current = setInterval(poll, 2000);

        // 清理函数：组件卸载或依赖变化时清除定时器
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activePlanId, setPlanStatus, loadHistory]);

    // ─── 生成超时计时器 ───
    useEffect(() => {
        if (!generating) {
            setGeneratingElapsed(0);
            return;
        }
        const timer = setInterval(() => {
            setGeneratingElapsed((s) => s + 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [generating]);

    /**
     * 生成新的开发计划
     *
     * 调用/plan/generate API启动Claude计划生成流程，
     * 成功后将taskId存入全局状态，轮询机制会自动跟踪进度。
     */
    const generatePlan = async () => {
        if (!selectedRequirement || !currentWorkspace) return;
        setGenerating(true);
        setError(null);
        setPlan(null);
        clearPlanLogs();
        try {
            const {taskId: newTaskId} = await apiPost<{ taskId: string }>('/plan/generate', {
                requirementId: selectedRequirement.id,
                workspacePath: currentWorkspace.path,
            });
            // 将新任务ID存入全局状态，触发轮询effect
            setPlanTaskId(newTaskId);
            setActivePlanId(newTaskId);
            setPlanStatus('generating');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to generate plan');
            setGenerating(false);
        }
    };

    /**
     * 保存编辑后的计划内容
     * 调用PUT API更新计划的summary和rawOutput字段
     */
    const savePlan = async () => {
        if (!plan || !activePlanId) return;
        try {
            const updated = await apiPut<StoredPlan>(`/plan/${activePlanId}`, {
                summary: editedSummary,
                rawOutput: editedSummary,
            });
            setPlan(updated);
            setEditing(false);
            loadHistory(); // 保存后刷新历史列表
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save plan');
        }
    };

    /**
     * 删除指定计划
     *
     * 调用DELETE API删除计划，更新本地历史列表。
     * 如果删除的是当前正在查看的计划，则清空当前计划状态。
     *
     * @param id - 要删除的计划ID
     * @param e - 点击事件对象（用于阻止事件冒泡）
     */
    const deletePlan = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // 阻止冒泡到父级的点击事件（避免触发loadPlan）
        try {
            await apiDelete(`/plan/${id}`);
            setPlanHistory(prev => prev.filter(p => p.id !== id));
            // 如果删除的是当前查看的计划，清空相关状态
            if (activePlanId === id) {
                setPlan(null);
                setActivePlanId(null);
                setPlanTaskId(null);
            }
        } catch {
            // 删除失败时静默处理
        }
    };

    /**
     * 向Claude发送回复消息
     *
     * 在计划生成完成或生成过程中，用户可以回复Claude的提问或提供额外信息。
     * 发送后会重启轮询机制（因为activePlanId不变，需要手动重启），
     * 等待Claude处理回复并更新计划。
     *
     * 流程：
     * 1. 验证输入非空且不在发送中
     * 2. 调用/plan/:id/reply API发送消息
     * 3. 清除旧轮询，启动新轮询跟踪Claude的回复处理
     * 4. 回复完成后自动恢复焦点到输入框
     */
    const handleReply = async () => {
        if (!replyText.trim() || !activePlanId || replying) return;
        const message = replyText.trim();
        setReplying(true);
        setGenerating(true);
        clearPlanLogs();
        setReplyText('');

        try {
            // 发送回复消息到Claude
            await apiPost(`/plan/${activePlanId}/reply`, {message});

            // 由于activePlanId未改变，需要手动重启轮询机制
            if (pollRef.current) clearInterval(pollRef.current);
            const poll = async () => {
                try {
                    const result = await apiGet<StoredPlan>(`/plan/${activePlanId}`);
                    if (result.status === 'ready') {
                        // Claude回复处理完成
                        setPlan(result);
                        setGenerating(false);
                        setPlanStatus('ready');
                        loadHistory();
                        if (pollRef.current) clearInterval(pollRef.current);
                        // 恢复焦点到回复输入框，方便用户继续对话
                        setTimeout(() => replyInputRef.current?.focus(), 100);
                    } else if (result.status === 'failed') {
                        // Claude回复处理失败
                        setPlan(result);
                        setError(result.error || 'Reply failed');
                        setGenerating(false);
                        setPlanStatus('idle');
                        if (pollRef.current) clearInterval(pollRef.current);
                    } else {
                        // 仍在处理中——仅在有新输出时更新计划数据
                        if (result.rawOutput) setPlan(result);
                    }
                } catch {
                    // 请求失败时继续轮询
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

    /**
     * 确认计划并启动执行
     *
     * 调用/execution/start API启动执行流程，
     * 成功后将executionId存入全局状态并跳转到执行页面。
     * 执行前会清除旧的执行日志，确保页面干净。
     */
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

    // 组件卸载时清理轮询定时器，防止内存泄漏
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    /**
     * 根据计划状态返回对应的状态图标
     * 用于历史列表中的状态可视化标识
     *
     * @param status - 计划状态字符串
     * @returns 对应的React图标元素
     */
    const statusIcon = (status: string) => {
        switch (status) {
            case 'ready':
                return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>;
            case 'failed':
                return <XCircle className="h-3.5 w-3.5 text-destructive"/>;
            case 'generating':
                return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin"/>;
            default:
                return <FileText className="h-3.5 w-3.5 text-muted-foreground"/>;
        }
    };

    return (
        <div className="flex h-full">
            {/* ─── 左侧面板：计划历史列表 ─── */}
            <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
                {/* 列表头部：标题和加载指示器 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Plan History
          </span>
                    {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
                </div>

                {/* 历史列表区域 */}
                <div className="flex-1 overflow-y-auto">
                    {/* 空列表状态 */}
                    {planHistory.length === 0 && !loadingHistory && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
                            <FileText className="h-7 w-7 text-muted-foreground/30"/>
                            <p className="text-xs text-muted-foreground">No plans yet</p>
                        </div>
                    )}

                    {/* 计划历史卡片列表 */}
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
                            {/* 状态图标 */}
                            <div className="mt-0.5 shrink-0">{statusIcon(p.status)}</div>
                            {/* 计划摘要信息 */}
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate text-foreground">
                                    {p.summary?.substring(0, 50) || p.requirementId || 'Plan'}
                                </p>
                                {/* 更新时间 */}
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    <Clock className="h-3 w-3 text-muted-foreground/50"/>
                                    <span className="text-xs text-muted-foreground/60">
                    {formatRelativeTime(p.updatedAt)}
                  </span>
                                </div>
                                {/* 工作空间名称（从路径中提取最后一段） */}
                                <div className="flex items-center gap-1 mt-0.5">
                                    <FolderOpen className="h-3 w-3 text-muted-foreground/40"/>
                                    <span className="text-xs text-muted-foreground/40 truncate font-mono">
                    {p.workspacePath.split(/[/\\]/).pop()}
                  </span>
                                </div>
                            </div>
                            {/* 删除按钮（悬停时显示） */}
                            <button
                                onClick={(e) => deletePlan(p.id, e)}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                            >
                                <Trash2 className="h-3.5 w-3.5"/>
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* ─── 右侧面板：计划内容区域 ─── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* 页面头部：标题、状态描述和操作按钮 */}
                <div className="border-b border-border px-6 py-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl font-semibold">Development Plan</h1>
                            {/* 根据当前状态显示不同的描述文本 */}
                            <p className="mt-0.5 text-sm text-muted-foreground">
                                {generating ? 'Claude is generating a plan...' :
                                    plan ? 'Review and confirm the plan before execution' :
                                        'Select a plan from history or generate a new one'}
                            </p>
                        </div>

                        {/* 操作按钮组：根据状态动态显示 */}
                        <div className="flex items-center gap-2">
                            {/* 无计划且未生成时：显示"生成计划"按钮 */}
                            {!plan && !generating && (
                                <Button onClick={generatePlan} disabled={!canGenerate}>
                                    <Sparkles className="h-4 w-4 mr-2"/>
                                    Generate Plan
                                </Button>
                            )}
                            {/* 有计划且未编辑且未生成时：显示编辑、重新生成、确认执行按钮 */}
                            {plan && !editing && !generating && (
                                <>
                                    {/* 编辑按钮 */}
                                    <Button variant="outline" size="sm" onClick={() => {
                                        setEditing(true);
                                        setEditedSummary(plan.rawOutput || plan.summary || '');
                                    }}>
                                        <Pencil className="h-4 w-4 mr-1.5"/>
                                        Edit
                                    </Button>
                                    {/* 重新生成按钮 */}
                                    <Button variant="outline" size="sm" onClick={generatePlan} disabled={generating}>
                                        <RefreshCw className="h-4 w-4 mr-1.5"/>
                                        New Plan
                                    </Button>
                                    {/* 确认并执行按钮（仅计划就绪时可用） */}
                                    <Button
                                        size="sm"
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                                        onClick={handleConfirmAndExecute}
                                        disabled={executing || plan.status !== 'ready'}
                                    >
                                        {executing ? (
                                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                        ) : (
                                            <Play className="h-4 w-4 mr-1.5"/>
                                        )}
                                        {executing ? 'Starting...' : 'Confirm & Execute'}
                                    </Button>
                                </>
                            )}
                            {/* 编辑模式下：显示保存和取消按钮 */}
                            {editing && (
                                <>
                                    <Button size="sm" onClick={savePlan}>
                                        <Save className="h-4 w-4 mr-1.5"/>
                                        Save
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                                        <X className="h-4 w-4 mr-1.5"/>
                                        Cancel
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* 主内容区域：根据状态条件渲染不同的内容区块 */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* 空状态：无计划选中时显示提示信息 */}
                    {!activePlanId && !generating && (
                        <Card>
                            <CardContent className="p-6 flex flex-col items-center gap-3 text-center">
                                <FileText className="h-10 w-10 text-muted-foreground/30"/>
                                <p className="text-sm text-muted-foreground">
                                    {planHistory.length > 0
                                        ? 'Select a plan from the history, or generate a new one'
                                        : 'No plans yet. Run a Pipeline or click Generate Plan to start.'}
                                </p>
                                {/* 未选择需求时显示提示 */}
                                {!canGenerate && !selectedRequirement && (
                                    <p className="text-xs text-muted-foreground/60">
                                        Select a requirement first (go to Requirements page)
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 生成中指示器：显示进度条和Claude实时输出 */}
                    {generating && (
                        <Card className="mb-4">
                            <CardContent className="p-5">
                                {/* 生成状态标题和加载动画 */}
                                <div className="flex items-center gap-3 mb-3">
                                    <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0"/>
                                    <span
                                        className="text-sm font-medium">Claude is analyzing and generating a plan...</span>
                                </div>
                                {/* 进度条（脉冲动画模拟进度） */}
                                <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3">
                                    <div className="h-full bg-primary rounded-full animate-pulse w-2/3"/>
                                </div>

                                {/* Claude实时输出日志面板 */}
                                {planLogs.length > 0 && (
                                    <div className="rounded-md bg-gray-950 border border-border overflow-hidden">
                                        {/* 日志面板标题栏 */}
                                        <div
                                            className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-gray-900/50">
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                                            <span
                                                className="text-xs text-muted-foreground font-mono">Claude output</span>
                                        </div>
                                        {/* 日志内容区域（等宽字体，自动滚动到底部） */}
                                        <div
                                            className="max-h-64 overflow-y-auto p-3 font-mono text-xs text-gray-300 leading-relaxed">
                                            {planLogs.map((log, i) => (
                                                <span key={i}>{log}</span>
                                            ))}
                                            <div ref={logEndRef}/>
                                        </div>
                                    </div>
                                )}

                                {/* 生成控制区域：等待/Paused/Pause/Cancel/Resume */}
                                {generating && (
                                    <div className="space-y-2">
                                        {planLogs.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">
                                                Waiting for Claude to start... This may take 30–60 seconds.
                                            </p>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">
                                                Claude is generating...
                                                ({Math.floor(generatingElapsed / 60)}m {generatingElapsed % 60}s)
                                            </p>
                                        )}
                                        {generatingElapsed > 120 && planLogs.length === 0 && (
                                            <p className="text-xs text-amber-500">
                                                Taking longer than expected. The process may be stuck.
                                            </p>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-xs"
                                                onClick={async () => {
                                                    if (!activePlanId) return;
                                                    try {
                                                        await apiPost(`/plan/${activePlanId}/pause`, {});
                                                        setGenerating(false);
                                                        setPlanStatus('paused');
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : 'Failed to pause');
                                                    }
                                                }}
                                            >
                                                <Pause className="h-3 w-3 mr-1"/>
                                                Pause
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-xs text-destructive hover:text-destructive"
                                                onClick={async () => {
                                                    if (!activePlanId) return;
                                                    try {
                                                        await apiPost(`/plan/${activePlanId}/abort`, {});
                                                        setGenerating(false);
                                                        setPlanStatus('idle');
                                                        setError('Plan generation cancelled');
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : 'Failed to abort');
                                                    }
                                                }}
                                            >
                                                <XCircle className="h-3 w-3 mr-1"/>
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                {/* Paused 状态控制 */}
                                {planPhase === 'paused' && (
                                    <div className="space-y-2">
                                        <div
                                            className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                                            <Pause className="h-3.5 w-3.5 text-amber-500"/>
                                            <span className="text-xs text-amber-500 font-medium">
                                                Generation paused. Click Resume to continue.
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="default"
                                                size="sm"
                                                className="text-xs"
                                                onClick={async () => {
                                                    if (!activePlanId) return;
                                                    try {
                                                        await apiPost(`/plan/${activePlanId}/resume`, {});
                                                        setGenerating(true);
                                                        setGeneratingElapsed(0);
                                                        setPlanStatus('generating');
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : 'Failed to resume');
                                                    }
                                                }}
                                            >
                                                <Play className="h-3 w-3 mr-1"/>
                                                Resume
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="text-xs text-destructive hover:text-destructive"
                                                onClick={async () => {
                                                    if (!activePlanId) return;
                                                    try {
                                                        await apiPost(`/plan/${activePlanId}/abort`, {});
                                                        setPlanStatus('idle');
                                                        setError('Plan generation cancelled');
                                                    } catch (err) {
                                                        setError(err instanceof Error ? err.message : 'Failed to abort');
                                                    }
                                                }}
                                            >
                                                <XCircle className="h-3 w-3 mr-1"/>
                                                Cancel
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* 错误信息提示条 */}
                    {error && (
                        <div
                            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
                            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0"/>
                            <div>
                                <p className="text-sm font-medium text-destructive">Error</p>
                                <p className="text-sm text-muted-foreground mt-1">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* 计划详情内容：仅在计划数据加载后显示 */}
                    {plan && (
                        <div className="space-y-4">
                            {/* 上下文信息卡片：关联的需求、工作空间和创建时间 */}
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

                            {/* Claude继续处理中的流式输出面板（当有计划数据且仍在生成时显示） */}
                            {generating && planLogs.length > 0 && (
                                <Card>
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0"/>
                                            <span
                                                className="text-sm font-medium text-primary">Claude is continuing...</span>
                                        </div>
                                        <div className="rounded-md bg-gray-950 border border-border overflow-hidden">
                                            <div
                                                className="max-h-48 overflow-y-auto p-3 font-mono text-xs text-gray-300 leading-relaxed">
                                                {planLogs.map((log, i) => (
                                                    <span key={i}>{log}</span>
                                                ))}
                                                <div ref={logEndRef}/>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {/* 计划输出内容卡片：编辑模式显示textarea，查看模式显示格式化文本 */}
                            <Card>
                                <CardContent className="p-4">
                                    <h3 className="text-sm font-semibold mb-3">Generated Plan</h3>
                                    {editing ? (
                                        /* 编辑模式：可编辑的文本区域 */
                                        <textarea
                                            value={editedSummary}
                                            onChange={(e) => setEditedSummary(e.target.value)}
                                            className="w-full min-h-[400px] bg-muted/30 border border-input rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                                        />
                                    ) : (
                                        /* 查看模式：格式化的Markdown预渲染文本 */
                                        <pre
                                            className="text-sm text-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/20 rounded-md p-4 overflow-x-auto">
                      {plan.rawOutput || plan.summary || (generating && planLogs.length > 0 ? planLogs.join('') : 'No plan content available.')}
                    </pre>
                                    )}
                                </CardContent>
                            </Card>

                            {/* 回复输入区域：与Claude对话交互 */}
                            {!editing && (
                                <Card className="border-primary/20 bg-primary/5">
                                    <CardContent className="p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <MessageSquare className="h-4 w-4 text-primary"/>
                                            <h3 className="text-sm font-semibold">Reply to Claude</h3>
                                            <span className="text-xs text-muted-foreground">
                        Answer Claude's questions or provide more context
                      </span>
                                        </div>
                                        <div className="flex gap-2">
                                            {/* 回复输入框：支持Ctrl+Enter快捷发送 */}
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
                                            {/* 发送按钮 */}
                                            <Button
                                                onClick={handleReply}
                                                disabled={!replyText.trim() || replying || generating}
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
                                        {/* 生成中时显示等待提示 */}
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
