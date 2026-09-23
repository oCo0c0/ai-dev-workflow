/**
 * @file PipelineRunPage.tsx
 * @description 流水线执行合页：开发计划 + 代码执行 合并为一个页面
 *
 * - 顶部两个 tab（开发计划 / 代码执行），计划确认后自动切到执行 tab
 * - 左侧统一历史列表：计划 + 执行记录合并后按项目空间（workspacePath）分组，
 *   不提供新建入口（任务均由流水线提交产生）
 * - 右侧工作区预览侧边栏（WorkspacePanel），跟随当前选中计划/执行的工作空间，宽度可拖拽
 */
import {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {apiGet, apiDelete} from '../api';
import {cn, formatRelativeTime} from '../lib/utils';
import {
    Loader2,
    Clock,
    FileText,
    Trash2,
    CheckCircle2,
    XCircle,
    Terminal,
    ChevronRight,
    FolderOpen,
    FileCode,
    Play,
    PanelRightOpen,
} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {ChatInputBox} from '../components/ChatInputBox';
import ContextIndicator from '../components/ContextIndicator';
import PlanPanel from '../components/PlanPanel';
import ExecutionPanel from '../components/ExecutionPanel';
import WorkspacePanel from '../components/WorkspacePanel';
import {FloatingSidePanel} from '../components/FloatingSidePanel';
import type {PanelHandle, PanelInputState} from '../components/PanelInput';
import {MessageSquare} from 'lucide-react';

/** 计划摘要（与后端 /plan/list 对齐） */
interface PlanSummary {
    id: string;
    requirementId: string;
    requirementTitle?: string;
    requirementNumber?: string;
    workspacePath: string;
    status: 'generating' | 'paused' | 'ready' | 'failed' | 'waiting_input' | 'waiting_skill_confirm';
    createdAt: string;
    updatedAt: string;
}

/** 执行摘要（与后端 /execution/list 对齐） */
interface ExecSummary {
    id: string;
    planId: string;
    requirementTitle?: string;
    requirementNumber?: string;
    status: string;
    startedAt: string;
    workspacePath?: string;
}

/** 已保存工作区（用于分组命名） */
interface SavedWorkspaceLite {
    id: string;
    path: string;
    name: string;
}

/** 统一历史条目：同一任务（planId）的计划与执行归并为一条 */
interface HistoryItem {
    key: string;
    planId?: string;
    execId?: string;
    title: string;
    /** 展示状态：优先执行状态，无执行时用计划状态 */
    status: string;
    time: string;
    workspacePath?: string;
}

/** 状态图标 */
function itemIcon(status: string) {
    if (status === 'ready' || status === 'completed') {
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>;
    }
    if (status === 'failed' || status === 'aborted') {
        return <XCircle className="h-3.5 w-3.5 text-destructive"/>;
    }
    if (status === 'running' || status === 'generating') {
        return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin"/>;
    }
    return <FileText className="h-3.5 w-3.5 text-muted-foreground"/>;
}

export default function PipelineRunPage() {
    const {t} = useTranslation();

    // ─── Tab 状态 ───
    const [activeTab, setActiveTab] = useState<'plan' | 'execution'>('plan');
    // 面板外部加载请求：{id, seq}，点击历史条目时递增 seq
    const [planLoadTarget, setPlanLoadTarget] = useState<{ id: string; seq: number } | null>(null);
    const [execLoadTarget, setExecLoadTarget] = useState<{ id: string; seq: number } | null>(null);
    const loadSeqRef = useRef(0);

    // ─── 历史数据 ───
    const [plans, setPlans] = useState<PlanSummary[]>([]);
    const [execs, setExecs] = useState<ExecSummary[]>([]);
    const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspaceLite[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    // ─── 工作区预览侧边栏 ───
    const [showWsPanel, setShowWsPanel] = useState(false);
    // 「本次产出」卡片 → 侧边栏打开文件信号（seq 递增保证重复打开同一文件也触发）
    const [wsOpenSignal, setWsOpenSignal] = useState<{path: string; seq: number} | null>(null);
    const openSeqRef = useRef(0);
    const handleOpenFileInWorkspace = useCallback((p: string) => {
        setShowWsPanel(true);
        openSeqRef.current += 1;
        setWsOpenSignal({path: p, seq: openSeqRef.current});
    }, []);

    // ─── 共用输入框（两个 tab 共用，由活跃面板上报状态/提供 send） ───
    const planPanelRef = useRef<PanelHandle>(null);
    const execPanelRef = useRef<PanelHandle>(null);
    const [inputState, setInputState] = useState<PanelInputState | null>(null);
    const [replyText, setReplyText] = useState('');
    const handleInputState = useCallback((s: PanelInputState) => setInputState(s), []);
    const handleSharedSend = async (text: string, attachmentIds: string[]) => {
        const target = activeTab === 'plan' ? planPanelRef.current : execPanelRef.current;
        await target?.send(text, attachmentIds);
        setReplyText('');
    };
    const [wsPanelWidth, setWsPanelWidth] = useState(720);
    const [activeWorkspacePath, setActiveWorkspacePath] = useState<string | undefined>(undefined);

    const loadSavedWorkspaces = useCallback(async () => {
        try {
            const data = await apiGet<SavedWorkspaceLite[]>('/workspace/saved');
            setSavedWorkspaces(data || []);
        } catch { /* ignore */
        }
    }, []);

    /** 刷新统一历史列表（计划 + 执行） */
    const loadHistory = useCallback(async () => {
        setLoadingHistory(true);
        try {
            const [planList, execList] = await Promise.all([
                apiGet<PlanSummary[]>('/plan/list'),
                apiGet<ExecSummary[]>('/execution/list'),
            ]);
            setPlans(planList || []);
            setExecs(execList || []);
        } catch { /* ignore */
        } finally {
            setLoadingHistory(false);
        }
    }, []);

    useEffect(() => {
        loadHistory();
        loadSavedWorkspaces();
    }, [loadHistory, loadSavedWorkspaces]);

    // 计划 + 执行按 planId 归并为一个任务条目（同一任务只显示一行；
    // 无对应计划的孤儿执行单独成条），面板数据变化时经 onDataChanged 回到这里刷新
    const historyItems = useMemo<HistoryItem[]>(() => {
        const execByPlan = new Map<string, ExecSummary[]>();
        const orphanExecs: ExecSummary[] = [];
        for (const e of execs) {
            if (e.planId && plans.some((p) => p.id === e.planId)) {
                const list = execByPlan.get(e.planId) || [];
                list.push(e);
                execByPlan.set(e.planId, list);
            } else {
                orphanExecs.push(e);
            }
        }

        const items: HistoryItem[] = plans.map((p) => {
            const related = (execByPlan.get(p.id) || [])
                .slice()
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
            const latest = related[0];
            return {
                key: `plan:${p.id}`,
                planId: p.id,
                execId: latest?.id,
                title: p.requirementNumber ? `${p.requirementNumber} ${p.requirementTitle || ''}` : (p.requirementTitle || p.id.substring(0, 8)),
                status: latest?.status || p.status,
                time: latest ? (latest.startedAt > p.updatedAt ? latest.startedAt : p.updatedAt) : p.updatedAt,
                workspacePath: latest?.workspacePath || p.workspacePath,
            };
        });
        for (const e of orphanExecs) {
            items.push({
                key: `exec:${e.id}`,
                execId: e.id,
                title: e.requirementNumber ? `${e.requirementNumber} ${e.requirementTitle || ''}` : (e.requirementTitle || e.id.substring(0, 8)),
                status: e.status,
                time: e.startedAt,
                workspacePath: e.workspacePath,
            });
        }
        return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    }, [plans, execs]);

    // 按项目空间分组（组名优先用已保存工作区名称），组间按最近时间倒序
    const groupedHistory = useMemo(() => {
        const groups = new Map<string, { label: string; path?: string; items: HistoryItem[] }>();
        for (const item of historyItems) {
            const key = item.workspacePath || '__none__';
            if (!groups.has(key)) {
                const saved = item.workspacePath
                    ? savedWorkspaces.find((ws) => ws.path === item.workspacePath)
                    : undefined;
                groups.set(key, {
                    label: item.workspacePath
                        ? (saved?.name || item.workspacePath.split(/[\\/]/).filter(Boolean).pop() || item.workspacePath)
                        : '未指定工作空间',
                    path: item.workspacePath,
                    items: [],
                });
            }
            groups.get(key)!.items.push(item);
        }
        return [...groups.values()];
    }, [historyItems, savedWorkspaces]);

    const toggleGroup = (key: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    /** 点击历史条目：优先进入执行（有执行时），否则进入计划；同时加载该任务
     *  的计划与执行，切到开发计划 tab 也能直接看到计划内容 */
    const handleSelectItem = (item: HistoryItem) => {
        loadSeqRef.current += 1;
        const seq = loadSeqRef.current;
        if (item.planId) setPlanLoadTarget({id: item.planId, seq});
        if (item.execId) {
            setActiveTab('execution');
            setExecLoadTarget({id: item.execId, seq});
        } else if (item.planId) {
            setActiveTab('plan');
        }
    };

    /** 删除历史条目：执行与其关联计划一并删除 */
    const handleDeleteItem = async (item: HistoryItem, e: React.MouseEvent) => {
        e.stopPropagation();
        if (['generating', 'running'].includes(item.status)) return;
        if (!confirm('确定删除该任务？其计划与执行记录将一并删除，且不可恢复。')) return;
        try {
            if (item.execId) await apiDelete(`/execution/${item.execId}`);
            if (item.planId) await apiDelete(`/plan/${item.planId}`);
            await loadHistory();
        } catch { /* ignore */
        }
    };

    const tabItems = [
        {key: 'plan' as const, label: t('pageTitle.plan'), icon: FileCode},
        {key: 'execution' as const, label: t('pageTitle.execution'), icon: Play},
    ];

    return (
        <div className="flex h-full">
            {/* ====== 左侧：统一历史列表（按项目空间分组，无新建入口） ====== */}
            <div className="w-64 flex flex-col border-r border-border bg-muted/10 shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="label-strong text-xs uppercase tracking-wide">
                        执行历史
                    </span>
                    {loadingHistory && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground"/>}
                </div>

                <div className="flex-1 overflow-y-auto">
                    {historyItems.length === 0 && !loadingHistory && (
                        <div className="flex flex-col items-center justify-center py-8 px-4 text-center gap-2">
                            <Terminal className="h-7 w-7 text-muted-foreground/30"/>
                            <p className="text-xs text-muted-foreground">暂无记录，请从流水线发起任务</p>
                        </div>
                    )}

                    {groupedHistory.map((group) => {
                        const groupKey = group.path || '__none__';
                        const collapsed = collapsedGroups.has(groupKey);
                        const activeTargetId = activeTab === 'plan' ? planLoadTarget?.id : execLoadTarget?.id;
                        return (
                            <div key={groupKey}>
                                {/* 分组头 */}
                                <div
                                    onClick={() => toggleGroup(groupKey)}
                                    className="group sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-muted/40 border-b border-border/60 cursor-pointer select-none hover:bg-muted/70 transition-colors"
                                    title={group.path || ''}
                                >
                                    <ChevronRight className={cn(
                                        'h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform',
                                        !collapsed && 'rotate-90',
                                    )}/>
                                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-blue-400"/>
                                    <span className="text-xs font-semibold truncate flex-1 min-w-0">{group.label}</span>
                                    <span className="text-[10px] text-muted-foreground/60 shrink-0">{group.items.length}</span>
                                </div>

                                {!collapsed && group.items.map((item) => {
                                    const itemActive = (item.execId && activeTargetId === item.execId)
                                        || (!item.execId && item.planId && activeTargetId === item.planId);
                                    return (
                                        <div
                                            key={item.key}
                                            onClick={() => handleSelectItem(item)}
                                            className={cn(
                                                'group flex items-start gap-2 px-3 py-2.5 pl-5 cursor-pointer border-b border-border/50 transition-colors',
                                                itemActive
                                                    ? 'bg-primary/5 border-l-2 border-l-primary'
                                                    : 'hover:bg-accent/50'
                                            )}
                                        >
                                            <div className="mt-0.5 shrink-0">{itemIcon(item.status)}</div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-medium truncate text-foreground">
                                                    {/* 阶段角标：P=有计划 E=有执行 */}
                                                    {item.planId && (
                                                        <span className="inline-flex mr-0.5 px-1 py-px rounded text-[9px] align-middle bg-blue-500/10 text-blue-500">P</span>
                                                    )}
                                                    {item.execId && (
                                                        <span className="inline-flex mr-1 px-1 py-px rounded text-[9px] align-middle bg-emerald-500/10 text-emerald-600">E</span>
                                                    )}
                                                    {item.title}
                                                </p>
                                                <div className="flex items-center gap-1.5 mt-0.5">
                                                    <Clock className="h-3 w-3 text-muted-foreground/50"/>
                                                    <span className="text-xs text-muted-foreground/60">
                                                        {formatRelativeTime(item.time)}
                                                    </span>
                                                </div>
                                            </div>
                                            {!['generating', 'running'].includes(item.status) && (
                                                <button
                                                    onClick={(e) => handleDeleteItem(item, e)}
                                                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-all shrink-0"
                                                    title="删除"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5"/>
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ====== 中间：tab + 面板 ====== */}
            <div className="adw-jumpbar-gutter relative flex-1 flex flex-col min-w-0">
                {/* tab 头 */}
                <div className="border-b border-border px-6 pt-2 shrink-0 flex items-center justify-between">
                    <div className="flex">
                        {tabItems.map((tab) => (
                            <button
                                key={tab.key}
                                onClick={() => setActiveTab(tab.key)}
                                className={cn(
                                    'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                                    activeTab === tab.key
                                        ? 'border-primary text-primary'
                                        : 'border-transparent label-strong hover:text-foreground',
                                )}
                            >
                                <tab.icon className="h-4 w-4"/>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    {!showWsPanel && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs btn-key border-primary/40"
                            onClick={() => setShowWsPanel(true)}
                            title="工作区预览"
                        >
                            <PanelRightOpen className="h-3.5 w-3.5 mr-1"/>
                            工作区
                        </Button>
                    )}
                </div>

                {/* 面板内容：条件渲染（切 tab 时卸载非活跃面板，轮询随卸载清理） */}
                <div className="flex-1 min-h-0">
                    {activeTab === 'plan' ? (
                        <PlanPanel
                            ref={planPanelRef}
                            loadTarget={planLoadTarget}
                            onExecutionStarted={() => setActiveTab('execution')}
                            onDataChanged={loadHistory}
                            onPlanChange={(p) => setActiveWorkspacePath(p?.workspacePath)}
                            onInputState={handleInputState}
                        />
                    ) : (
                        <ExecutionPanel
                            ref={execPanelRef}
                            loadTarget={execLoadTarget}
                            onDataChanged={loadHistory}
                            onExecutionChange={(d) => setActiveWorkspacePath(d?.workspacePath)}
                            onGoToPlan={() => setActiveTab('plan')}
                            onInputState={handleInputState}
                            onOpenFileInWorkspace={handleOpenFileInWorkspace}
                        />
                    )}
                </div>

                {/* 共用输入框：两个 tab 共用，动作按钮/占位文案由活跃面板上报；
                    流内常驻底条（不悬浮、不遮挡面板内容），与面板内容同宽对齐，样式统一 floating-input-card */}
                {inputState && (
                    <div className="shrink-0 px-6 pb-4 pt-2">
                        <div className="floating-input-card w-full rounded-xl border border-primary/25 shadow-xl">
                            <div className="p-3">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <MessageSquare className="h-4 w-4 text-primary"/>
                                        <span className="text-sm font-semibold">
                                            {activeTab === 'plan' ? t('plan.replyTitle') : t('execution.replyTitle')}
                                        </span>
                                    </div>
                                    {inputState.onSuggestNewSession && (
                                        <ContextIndicator
                                            logs={inputState.contextLogs || []}
                                            onSuggestNewSession={inputState.onSuggestNewSession}
                                        />
                                    )}
                                </div>
                                <ChatInputBox
                                    value={replyText}
                                    onChange={setReplyText}
                                    onSend={(text, atts) => handleSharedSend(text, atts.map(a => a.attachmentId))}
                                    placeholder={inputState.placeholder}
                                    rows={3}
                                    disabled={inputState.disabled}
                                    title={activeTab === 'plan' ? t('plan.replyTitle') : t('execution.replyTitle')}
                                    optimizable
                                    optimizePurpose="reply"
                                    sending={inputState.sending}
                                    branchWorkspacePath={inputState.branchWorkspacePath}
                                    branchDisabled={inputState.branchDisabled}
                                    actions={inputState.actions}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ====== 右侧悬浮工作区预览（Portal 到 body，覆盖在内容之上，不挤压主页面）====== */}
            <FloatingSidePanel
                open={showWsPanel}
                title="工作区预览"
                width={wsPanelWidth}
                onWidthChange={setWsPanelWidth}
                onClose={() => setShowWsPanel(false)}
            >
                <WorkspacePanel
                    defaultWorkspacePath={activeWorkspacePath}
                    showWorkspaceList={false}
                    openFileSignal={wsOpenSignal}
                />
            </FloatingSidePanel>
        </div>
    );
}
