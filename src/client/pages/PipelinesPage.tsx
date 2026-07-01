/**
 * @file PipelinesPage.tsx
 * @description 流水线（Pipeline）管理页面组件
 *
 * 本页面提供了完整的流水线生命周期管理功能，包括：
 * - 流水线的创建、编辑、删除和默认设置
 * - 流水线步骤配置（需求来源、工作空间、技能集、MCP工具集、测试策略）
 * - 流水线执行向导（ExecutionWizard），引导用户完成需求选择、工作空间确认和启动执行
 * - 依赖检测，自动识别缺失的MCP服务器或技能
 *
 * 页面采用左右分栏布局：左侧为流水线列表，右侧为编辑表单或空状态提示。
 * 当用户点击"Run"按钮时，会弹出执行向导模态框。
 */
import {useState, useEffect, useCallback} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Joyride} from 'react-joyride';
import {useGuide} from '../guides/useGuide';
import {apiGet, apiPost, apiPut, apiDelete, pickFolder} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Card, CardContent} from '../components/ui/card';
import {Badge} from '../components/ui/badge';
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
    Clock,
    BookOpen,
    Download,
    RefreshCw,
} from 'lucide-react';

/**
 * @interface PipelineStepConfig
 * @description 流水线各步骤的配置项
 *
 * 定义了流水线执行过程中各阶段的具体配置：
 * - requirementSource: 需求来源配置（ONES/Jira/GitLab/手动输入）
 * - workspace: 工作空间绑定配置
 * - planSkills/executionSkills/testSkills: 各阶段使用的技能集配置
 * - mcpToolSet: MCP工具服务器选择配置
 * - testStrategy: 测试策略配置（AI自动生成测试或运行已有测试）
 */
interface PhaseToolsConfig {
    /** 该阶段启用的技能名列表，空 = 不启用 */
    skills: string[];
    /** 该阶段启用的 MCP 服务器名列表，空 = 不启用 */
    mcpServers: string[];
}

interface PipelineStepConfig {
    /** 需求来源配置（可选——需求获取方式现由运行时向导决定，保留兼容旧配置） */
    requirementSource?: { type: string; mcpServerName?: string };
    /** 工作空间配置，支持预绑定路径 */
    workspace: { boundPath?: string };
    /** 规划阶段工具配置（技能 + MCP，新模型，空数组 = 不启用） */
    plan?: PhaseToolsConfig;
    /** 执行阶段工具配置（技能 + MCP，新模型，空数组 = 不启用） */
    execution?: PhaseToolsConfig;
    /** 测试阶段工具配置（技能 + MCP，新模型，空数组 = 不启用） */
    test?: PhaseToolsConfig;
    /** 规划阶段技能配置 */
    planSkills?: { mode: string; selectedSkills: string[] };
    /** 执行阶段技能配置 */
    executionSkills?: { mode: string; selectedSkills: string[] };
    /** 测试阶段技能配置 */
    testSkills?: { mode: string; selectedSkills: string[] };
    /** 兼容旧版的全局技能集配置（已废弃） */
    skillSet?: { mode: string; selectedSkills: string[] }; // legacy
    /** MCP工具集配置 */
    mcpToolSet: { mode: string; selectedServers: string[] };
    /** 文档解析配置（MinerU） */
    documentParsing?: { extraPaths?: string[] };
    /** 测试策略配置 */
    testStrategy: {
        /** 测试模式 */
        mode: 'ai_generate' | 'run_existing' | 'ai_generate_e2e';
        /** 测试框架类型（仅run_existing模式使用） */
        framework?: string;
        /** 自定义测试命令 */
        command?: string;
        /** 是否在执行完成后自动运行测试 */
        autoRunAfterExecution: boolean;
        /** 是否仅运行变更文件相关的测试 */
        changedFilesOnly?: boolean;
        /** 测试执行环境：local 本地（默认），sandbox 远程沙箱 */
        environment?: 'local' | 'sandbox';
        /** Daytona 沙箱 ID（environment 为 sandbox 时必填） */
        sandboxId?: string;
    };
}

/**
 * @interface Pipeline
 * @description 流水线数据模型
 *
 * 表示一个完整的开发流水线，包含基本信息和步骤配置。
 */
interface Pipeline {
    /** 流水线唯一标识符 */
    id: string;
    /** 流水线名称 */
    name: string;
    /** 流水线描述 */
    description: string;
    /** 是否为默认流水线 */
    isDefault: boolean;
    /** 创建时间（ISO 8601格式） */
    createdAt: string;
    /** 更新时间（ISO 8601格式） */
    updatedAt: string;
    /** 流水线步骤配置 */
    steps: PipelineStepConfig;
}

/**
 * @interface MCPServerConfig
 * @description MCP服务器配置信息
 */
interface MCPServerConfig {
    /** MCP服务器名称 */
    name: string;
    /** 运行时类型（node/python/docker/custom） */
    type?: string;
    /** 是否已启用 */
    enabled: boolean;
}

/**
 * @interface Skill
 * @description 技能信息
 */
interface Skill {
    /** 技能名称 */
    name: string;
    /** 技能描述 */
    description?: string;
}

/**
 * @interface StoredRequirement
 * @description 已保存的需求信息
 *
 * 从需求管理系统获取并本地存储的需求数据。
 */
interface StoredRequirement {
    /** 需求唯一标识符 */
    id: string;
    /** 需求编号（如 #125975） */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态 */
    status: string;
    /** 需求优先级 */
    priority: string;
    /** 需求负责人 */
    assignee: string;
    /** 需求描述内容 */
    description: string;
    /** 本地保存时间（ISO 8601格式） */
    savedAt: string;
    /** 需求来源系统标识 */
    source: string;
}

// ─── 执行向导（Execution Wizard） ──────────────────────────────────────────

/**
 * @interface WizardState
 * @description 执行向导的状态管理接口
 *
 * 管理执行向导的三步骤流程状态：
 * - Step 1: 选择需求（支持从MCP获取或手动输入）
 * - Step 2: 确认工作空间
 * - Step 3: 审核信息并启动执行
 */
interface WizardState {
    /** 当前关联的流水线 */
    pipeline: Pipeline;
    /** 当前步骤（1: 选择需求, 2: 确认工作空间, 3: 审核并启动） */
    step: 1 | 2 | 3;
    // Step 1 相关状态
    /** 需求获取方式：fetch 通过 MCP 拉取（调 MCP） / saved 选择已保存（本地，不调 MCP） */
    reqMode: 'fetch' | 'saved';
    /** MCP 模式下选用的 MCP 服务器名（拉取需求用） */
    selectedMcpServer: string;
    /** 已选择的需求 */
    selectedRequirement: StoredRequirement | null;
    /** 手动输入的需求文本 */
    manualRequirementText: string;
    /** 需求获取ID输入框的值 */
    fetchId: string;
    /** 需求获取错误信息 */
    fetchError: string | null;
    /** 是否正在获取需求 */
    fetching: boolean;
    /** 已保存的需求列表 */
    savedRequirements: StoredRequirement[];
    /** 是否正在加载已保存的需求 */
    loadingSaved: boolean;
    // Step 2 相关状态
    /** 选择的工作空间路径 */
    workspacePath: string;
    /** 工作空间历史记录列表 */
    workspaceHistory: string[];
    /** 是否正在加载工作空间历史 */
    loadingHistory: boolean;
    /** 是否解析文档附件（PDF/DOCX 等） */
    parseDocuments: boolean;
    // Step 3 相关状态
    /** 是否正在启动执行 */
    starting: boolean;
    /** 启动执行时的错误信息 */
    startError: string | null;
}

/**
 * @interface ExecutionWizardProps
 * @description 执行向导组件的属性接口
 */
interface ExecutionWizardProps {
    /** 要执行的流水线配置 */
    pipeline: Pipeline;
    /** 关闭向导的回调函数 */
    onClose: () => void;
    /** 已保存的工作空间列表，用于下拉选择 */
    savedWorkspaces: { id: string; name: string; path: string }[];
    /** 可用 MCP 服务器列表，用于需求拉取时选择 */
    mcpServers: MCPServerConfig[];
}

/**
 * @function ExecutionWizard
 * @description 流水线执行向导组件
 *
 * 以模态框形式呈现的三步骤向导，引导用户完成流水线执行前的准备工作：
 * 1. 选择需求来源（支持ONES/Jira/GitLab获取或手动输入）
 * 2. 确认或选择工作空间目录
 * 3. 审核配置信息并启动执行（调用/plan/generate API）
 *
 * 启动成功后会跳转到计划页面（/plan）进行后续的规划和执行流程。
 *
 * @param props - 执行向导属性
 * @param props.pipeline - 要执行的流水线
 * @param props.onClose - 关闭回调
 * @param props.savedWorkspaces - 可用工作空间列表
 */
function ExecutionWizard({pipeline, onClose, savedWorkspaces, mcpServers}: ExecutionWizardProps) {
    const {t} = useTranslation();
    const navigate = useNavigate();
    // 从全局状态获取更新方法，用于设置选中的需求和计划状态
    const setSelectedRequirement = useAppStore((s) => s.setSelectedRequirement);
    const setPlanTaskId = useAppStore((s) => s.setPlanTaskId);
    const setPlanStatus = useAppStore((s) => s.setPlanStatus);

    // 工作空间绑定路径（绑定是流水线级配置，仍从配置读）
    const boundPath = pipeline.steps?.workspace?.boundPath;

    // 初始化向导状态：默认 MCP 获取模式，预选第一个可用 MCP 服务器
    const [state, setState] = useState<WizardState>({
        pipeline,
        step: 1,
        reqMode: 'fetch',
        selectedMcpServer: mcpServers[0]?.name ?? '',
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
        parseDocuments: false,
        starting: false,
        startError: null,
    });

    /**
     * 局部状态更新辅助函数
     * 使用部分更新模式，避免完整替换状态对象
     */
    const update = (patch: Partial<WizardState>) =>
        setState((prev) => ({...prev, ...patch}));

    // 已保存模式加载需求列表（fetch 模式只拉新，不需预加载）
    useEffect(() => {
        if (state.reqMode === 'saved') {
            update({loadingSaved: true});
            apiGet<StoredRequirement[]>('/requirements/saved')
                .then((data) => update({savedRequirements: data, loadingSaved: false}))
                .catch(() => update({loadingSaved: false}));
        }
    }, [state.reqMode]);

    // 进入步骤2时，如果工作空间未绑定，则加载工作空间历史记录供选择
    useEffect(() => {
        if (state.step === 2 && !boundPath) {
            update({loadingHistory: true});
            apiGet<string[]>('/workspace/history')
                .then((data) => update({workspaceHistory: data, loadingHistory: false}))
                .catch(() => update({loadingHistory: false}));
        }
    }, [state.step, boundPath]);

    /**
     * 通过ID从需求管理系统获取需求详情
     * 支持通过MCP服务器名称指定来源系统
     */
    const handleFetchRequirement = async () => {
        if (!state.fetchId.trim()) return;
        update({fetching: true, fetchError: null});
        try {
            // 调用需求获取API，携带MCP服务器名称（如果配置了的话）
            const req = await apiPost<StoredRequirement>('/requirements/fetch', {
                id: state.fetchId.trim(),
                parseDocuments: state.parseDocuments,
                ...(state.selectedMcpServer ? {mcpServerName: state.selectedMcpServer} : {}),
            });
            // 获取成功后更新状态：选中新需求，将其插入列表顶部，并去重
            update({
                fetching: false,
                selectedRequirement: req,
                fetchId: '',
                savedRequirements: [req, ...state.savedRequirements.filter((r) => r.id !== req.id)],
            });
        } catch (err) {
            update({
                fetching: false,
                fetchError: err instanceof Error ? err.message : t('pipelines.failedFetchReq'),
            });
        }
    };

    /**
     * 打开文件夹选择器，让用户选择工作空间目录
     */
    const handleBrowse = async () => {
        const path = await pickFolder(t('pipelines.selectFolder'));
        if (path) {
            update({workspacePath: path});
        }
    };

    // 步骤1前置条件：两种模式都需选中需求（fetch 拉到 / saved 选到）
    const canProceedStep1 = state.selectedRequirement !== null;

    // 计算步骤2的前置条件：需要有工作空间路径
    const canProceedStep2 = state.workspacePath.trim().length > 0;

    /**
     * 处理"下一步"按钮点击
     * 只有满足当前步骤的前置条件时才允许前进
     */
    const handleNext = () => {
        if (state.step === 1 && canProceedStep1) update({step: 2});
        else if (state.step === 2 && canProceedStep2) update({step: 3});
    };

    /**
     * 处理"返回"按钮点击
     * 回退到上一步骤
     */
    const handleBack = () => {
        if (state.step === 2) update({step: 1});
        else if (state.step === 3) update({step: 2});
    };

    /**
     * 启动流水线执行
     *
     * 根据需求来源类型构建不同的请求参数：
     * - 非手动模式：传递requirementId
     * - 手动模式：传递requirementText
     *
     * 成功启动后将taskId存入全局状态，并跳转到计划页面
     */
    const handleStart = async () => {
        update({starting: true, startError: null});
        try {
            const requirementId = state.selectedRequirement?.id;

            // 调用计划生成API，携带流水线ID用于技能解析
            const result = await apiPost<{ taskId: string }>('/plan/generate', {
                requirementId,
                workspacePath: state.workspacePath,
                pipelineId: pipeline.id,  // 传递流水线ID，服务端据此解析技能配置
            });

            // 将taskId和状态存入全局store，供计划页面使用
            setPlanTaskId(result.taskId);
            setPlanStatus('generating');

            // 如果不是手动模式，将选中的需求保存到全局状态
            if (state.selectedRequirement) {
                const req = state.selectedRequirement;
                setSelectedRequirement({
                    id: req.id,
                    title: req.title,
                    status: req.status,
                    priority: req.priority,
                    assignee: req.assignee,
                    updatedAt: req.savedAt,
                    description: req.description,
                    acceptanceCriteria: [],
                    attachments: [],
                    relatedIssues: [],
                });
            }

            // 跳转到计划页面，展示生成进度
            navigate('/plan');
        } catch (err) {
            update({
                starting: false,
                startError: err instanceof Error ? err.message : t('pipelines.failedStartPipeline'),
            });
        }
    };

    // 向导步骤标签定义
    const stepLabels = t('pipelines.wizardSteps').split(', ');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* 半透明背景遮罩，点击可关闭向导 */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>

            {/* 向导模态框主体 */}
            <div
                className="relative z-10 w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
                {/* 模态框头部：显示流水线名称和关闭按钮 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                    <div>
                        <h2 className="text-sm font-semibold">{t('pipelines.wizardTitle')}</h2>
                        <p className="text-xs text-muted-foreground mt-0.5">{pipeline.name}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                        <X className="h-4 w-4"/>
                    </button>
                </div>

                {/* 步骤指示器：显示当前步骤和已完成步骤 */}
                <div className="flex items-center gap-0 px-5 py-3 border-b border-border bg-muted/20">
                    {stepLabels.map((label, i) => {
                        const stepNum = (i + 1) as 1 | 2 | 3;
                        const isActive = state.step === stepNum;
                        const isDone = state.step > stepNum;
                        return (
                            <div key={i} className="flex items-center flex-1 min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                    {/* 步骤编号圆圈：当前步骤高亮，已完成步骤显示对勾 */}
                                    <div
                                        className={cn(
                                            'flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0 transition-colors',
                                            isActive && 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/30',
                                            isDone && 'bg-emerald-500 text-white',
                                            !isActive && !isDone && 'bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {isDone ? <CheckCircle2 className="h-3.5 w-3.5"/> : stepNum}
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
                                {/* 步骤之间的分隔箭头 */}
                                {i < stepLabels.length - 1 && (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 mx-2 shrink-0"/>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* 步骤内容区域，根据当前步骤渲染不同的表单 */}
                <div className="flex-1 overflow-y-auto p-5">
                    {/* ── 步骤1：选择需求 ── */}
                    {state.step === 1 && (
                        <div className="space-y-4">
                            {/* 需求获取方式切换 */}
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => update({reqMode: 'fetch'})}
                                    className={cn('flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all',
                                        state.reqMode === 'fetch' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/30')}
                                >
                                    <Download className="h-3.5 w-3.5"/>
                                    {t('pipelines.wizardModeFetch')}
                                </button>
                                <button
                                    onClick={() => update({reqMode: 'saved'})}
                                    className={cn('flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-all',
                                        state.reqMode === 'saved' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent/30')}
                                >
                                    <FolderOpen className="h-3.5 w-3.5"/>
                                    {t('pipelines.wizardModeSaved')}
                                </button>
                            </div>

                            {/* 通过 MCP 获取：选 server + 输入 ID 拉取（调 MCP） */}
                            {state.reqMode === 'fetch' ? (
                                <>
                                    {/* MCP 服务器选择（拉取需求用） */}
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {t('pipelines.mcpServer')}
                                        </label>
                                        <select
                                            value={state.selectedMcpServer}
                                            onChange={(e) => update({selectedMcpServer: e.target.value})}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">{t('pipelines.selectPlaceholder')}</option>
                                            {mcpServers.map((s) => (
                                                <option key={s.name} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* 通过ID/编号从需求管理系统获取需求 */}
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {t('pipelines.wizardFetchById')}
                                        </label>
                                        <div className="flex gap-2">
                                            <div className="relative flex-1">
                                                <BookOpen
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                                                <Input
                                                    value={state.fetchId}
                                                    onChange={(e) => update({fetchId: e.target.value})}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleFetchRequirement()}
                                                    placeholder={t('pipelines.wizardFetchPlaceholder')}
                                                    className="pl-9"
                                                />
                                            </div>
                                            <Button
                                                size="sm"
                                                onClick={handleFetchRequirement}
                                                disabled={state.fetching || !state.fetchId.trim()}
                                            >
                                                {state.fetching ? (
                                                    <Loader2 className="h-4 w-4 animate-spin"/>
                                                ) : (
                                                    <Download className="h-4 w-4"/>
                                                )}
                                            </Button>
                                        </div>
                                        {/* 需求获取失败时显示错误信息 */}
                                        {state.fetchError && (
                                            <p className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                                                <AlertTriangle className="h-3.5 w-3.5 shrink-0"/>
                                                {state.fetchError}
                                            </p>
                                        )}
                                        {/* 文档解析开关 */}
                                        <label
                                            className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={state.parseDocuments}
                                                onChange={(e) => update({parseDocuments: e.target.checked})}
                                                className="rounded border-input"
                                            />
                                            {t('pipelines.wizardParseDocs')}
                                        </label>
                                    </div>
                                </>
                            ) : (
                                <>
                                    {/* 已保存的需求列表，支持单选 */}
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {t('pipelines.wizardSavedReq')}
                                        </label>
                                        {state.loadingSaved ? (
                                            <div className="flex justify-center py-6">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                                            </div>
                                        ) : state.savedRequirements.length === 0 ? (
                                            <div
                                                className="flex flex-col items-center justify-center py-6 gap-2 rounded-lg border border-dashed border-border">
                                                <FileText className="h-7 w-7 text-muted-foreground/30"/>
                                                <p className="text-xs text-muted-foreground">{t('pipelines.wizardNoSaved')}</p>
                                                <p className="text-xs text-muted-foreground/60">{t('pipelines.wizardNoSavedHint')}</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                                                {state.savedRequirements.map((req) => (
                                                    <div
                                                        key={req.id}
                                                        // 点击切换选中状态：已选中则取消，未选中则选中
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
                                                        {/* 单选按钮样式的圆形指示器 */}
                                                        <div
                                                            className={cn(
                                                                'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                                                                state.selectedRequirement?.id === req.id
                                                                    ? 'border-primary bg-primary'
                                                                    : 'border-muted-foreground/40'
                                                            )}
                                                        >
                                                            {state.selectedRequirement?.id === req.id && (
                                                                <div
                                                                    className="w-1.5 h-1.5 rounded-full bg-primary-foreground"/>
                                                            )}
                                                        </div>
                                                        {/* 需求详情：标题、ID和保存时间 */}
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm font-medium truncate">{req.number ? `${req.number} ` : ''}{req.title}</p>
                                                            <div className="mt-0.5 flex items-center gap-2">
                                                                <span
                                                                    className="text-xs text-muted-foreground">{req.id}</span>
                                                                <span
                                                                    className="text-xs text-muted-foreground/60">·</span>
                                                                <span
                                                                    className="flex items-center gap-1 text-xs text-muted-foreground/60">
                                  <Clock className="h-3 w-3"/>
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

                    {/* ── 步骤2：确认工作空间 ── */}
                    {state.step === 2 && (
                        <div className="space-y-4">
                            {/* 如果流水线已绑定工作空间，显示绑定信息（不可更改） */}
                            {boundPath ? (
                                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                                    <div className="flex items-center gap-2 mb-1">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0"/>
                                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      {t('pipelines.workspaceBound')}
                    </span>
                                    </div>
                                    <p className="text-xs font-mono text-muted-foreground break-all">{boundPath}</p>
                                </div>
                            ) : (
                                /* 未绑定时，显示工作空间下拉选择器 */
                                <div>
                                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                        {t('pipelines.selectWorkspace')}
                                    </label>
                                    <select
                                        value={state.workspacePath}
                                        onChange={(e) => update({workspacePath: e.target.value})}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="">{t('pipelines.selectWorkspaceOption')}</option>
                                        {savedWorkspaces.map((ws) => (
                                            <option key={ws.id} value={ws.path}>{ws.name}</option>
                                        ))}
                                    </select>
                                    {savedWorkspaces.length === 0 && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {t('pipelines.noWorkspacesHint')}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── 步骤3：审核信息并启动 ── */}
                    {state.step === 3 && (
                        <div className="space-y-4">
                            {/* 汇总卡片：展示需求、工作空间和流水线信息 */}
                            <div className="rounded-lg border border-border bg-muted/20 divide-y divide-border">
                                {/* 需求摘要 */}
                                <div className="px-4 py-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('pipelines.reviewRequirement')}</p>
                                    {state.selectedRequirement ? (
                                        <div>
                                            <p className="text-sm font-medium">{state.selectedRequirement.number ? `${state.selectedRequirement.number} ` : ''}{state.selectedRequirement.title}</p>
                                        </div>
                                    ) : null}
                                </div>

                                {/* 工作空间摘要 */}
                                <div className="px-4 py-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('pipelines.reviewWorkspace')}</p>
                                    <div className="flex items-center gap-2">
                                        <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0"/>
                                        <span className="text-sm font-mono break-all">{state.workspacePath}</span>
                                    </div>
                                </div>

                                {/* 流水线摘要 */}
                                <div className="px-4 py-3">
                                    <p className="text-xs font-medium text-muted-foreground mb-1">{t('pipelines.reviewPipeline')}</p>
                                    <p className="text-sm font-medium">{pipeline.name}</p>
                                    {pipeline.description && (
                                        <p className="text-xs text-muted-foreground mt-0.5">{pipeline.description}</p>
                                    )}
                                </div>
                            </div>

                            {/* 启动失败时显示错误信息 */}
                            {state.startError && (
                                <div
                                    className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                                    <AlertTriangle className="h-4 w-4 shrink-0"/>
                                    {state.startError}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 底部操作栏：取消/返回 + 下一步/启动 */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/10">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={state.step === 1 ? onClose : handleBack}
                    >
                        {/* 第一步时显示"取消"，其他步骤显示"返回" */}
                        {state.step === 1 ? (
                            <>
                                <X className="h-4 w-4 mr-1"/>
                                {t('common.cancel')}
                            </>
                        ) : (
                            <>
                                <ChevronLeft className="h-4 w-4 mr-1"/>
                                {t('common.back')}
                            </>
                        )}
                    </Button>

                    {/* 最后一步显示"Start Pipeline"按钮，其他步骤显示"Next" */}
                    {state.step < 3 ? (
                        <Button
                            size="sm"
                            onClick={handleNext}
                            disabled={state.step === 1 ? !canProceedStep1 : !canProceedStep2}
                        >
                            {t('pipelines.wizardNext')}
                            <ChevronRight className="h-4 w-4 ml-1"/>
                        </Button>
                    ) : (
                        <Button size="sm" onClick={handleStart} disabled={state.starting}>
                            {state.starting ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin"/>
                                    {t('pipelines.wizardStarting')}
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-1.5"/>
                                    {t('pipelines.wizardStart')}
                                </>
                            )}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── 阶段工具选择（技能 + MCP 卡片网格 + 弹窗） ─────────────────────────────

interface SelectableItem {
    name: string;
    description?: string;
    type?: string;
}

interface MultiSelectModalProps {
    title: string;
    items: SelectableItem[];
    selected: string[];
    onConfirm: (selected: string[]) => void;
    onClose: () => void;
}

/**
 * 多选弹窗：卡片网格点选高亮 + 搜索。技能显 name+description，MCP 显 name+type。
 */
function MultiSelectModal({title, items, selected, onConfirm, onClose}: MultiSelectModalProps) {
    const {t} = useTranslation();
    const [query, setQuery] = useState('');
    const [draft, setDraft] = useState<string[]>(selected);

    const filtered = items.filter((i) =>
        i.name.toLowerCase().includes(query.toLowerCase())
        || (i.description ?? '').toLowerCase().includes(query.toLowerCase())
    );

    const toggle = (name: string) => {
        setDraft((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>
            <div
                className="relative z-10 w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-indigo-500/10 to-purple-600/10">
                    <h3 className="text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent">{title}</h3>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    >
                        <X className="h-4 w-4"/>
                    </button>
                </div>
                <div className="p-3 border-b border-border">
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('pipelines.phaseTools.search')}
                    />
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                    {filtered.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                            {t('pipelines.noSkillsAvailable')}
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {filtered.map((item) => {
                                const checked = draft.includes(item.name);
                                return (
                                    <div
                                        key={item.name}
                                        onClick={() => toggle(item.name)}
                                        className={cn(
                                            'rounded-md border p-2.5 cursor-pointer transition-all',
                                            checked
                                                ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                                : 'border-border hover:border-primary/40 hover:bg-accent/30'
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-1">
                                            <p className="text-xs font-medium truncate flex-1">{item.name}</p>
                                            {checked && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0"/>}
                                        </div>
                                        {item.description && (
                                            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                                                {item.description}
                                            </p>
                                        )}
                                        {item.type && (
                                            <Badge variant="outline" className="text-[9px] mt-1">{item.type}</Badge>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/10">
                    <span className="text-xs text-muted-foreground">
                        {t('pipelines.phaseTools.selected', {count: draft.length})}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={onClose}>
                            {t('pipelines.phaseTools.cancel')}
                        </Button>
                        <Button size="sm" onClick={() => onConfirm(draft)}>
                            {t('pipelines.phaseTools.confirm')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface PhaseToolsCardProps {
    phaseLabel: string;
    config: PhaseToolsConfig;
    skills: Skill[];
    mcpServers: MCPServerConfig[];
    onChange: (config: PhaseToolsConfig) => void;
}

/**
 * 阶段工具卡片：展示该阶段已添加的技能和 MCP（卡片网格），点按钮弹窗多选。
 * 空数组显示"未配置"占位。技能卡片显 name+description，MCP 卡片显 name+type。
 */
function PhaseToolsCard({phaseLabel, config, skills, mcpServers, onChange}: PhaseToolsCardProps) {
    const {t} = useTranslation();
    const [modal, setModal] = useState<null | 'skill' | 'mcp'>(null);

    const removeSkill = (name: string) =>
        onChange({...config, skills: config.skills.filter((s) => s !== name)});
    const removeMcp = (name: string) =>
        onChange({...config, mcpServers: config.mcpServers.filter((s) => s !== name)});

    return (
        <div className="mb-3 rounded-md border border-border p-3">
            <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-4 rounded-full bg-gradient-to-b from-indigo-500 to-purple-600"/>
                <p className="text-xs font-semibold text-foreground">{phaseLabel}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
                {/* 技能列 */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{t('pipelines.phaseTools.skillLabel')}</span>
                        <button
                            onClick={() => setModal('skill')}
                            className="text-xs text-primary hover:bg-primary/10 px-2 py-0.5 rounded-md flex items-center gap-0.5 transition-colors"
                        >
                            <Plus className="h-3 w-3"/>
                            {t('pipelines.phaseTools.addSkill')}
                        </button>
                    </div>
                    {config.skills.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic py-2 text-center rounded border border-dashed border-border">
                            {t('pipelines.phaseTools.noSkills')}
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {config.skills.map((name) => {
                                const skill = skills.find((s) => s.name === name);
                                return (
                                    <div
                                        key={name}
                                        className="group flex items-start gap-1.5 rounded border border-border bg-muted/20 px-2 py-1.5"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate">{name}</p>
                                            {skill?.description && (
                                                <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                                                    {skill.description}
                                                </p>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => removeSkill(name)}
                                            className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                        >
                                            <X className="h-3 w-3"/>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
                {/* MCP 列 */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-muted-foreground">{t('pipelines.phaseTools.mcpLabel')}</span>
                        <button
                            onClick={() => setModal('mcp')}
                            className="text-xs text-primary hover:bg-primary/10 px-2 py-0.5 rounded-md flex items-center gap-0.5 transition-colors"
                        >
                            <Plus className="h-3 w-3"/>
                            {t('pipelines.phaseTools.addMcp')}
                        </button>
                    </div>
                    {config.mcpServers.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic py-2 text-center rounded border border-dashed border-border">
                            {t('pipelines.phaseTools.noMcp')}
                        </p>
                    ) : (
                        <div className="space-y-1">
                            {config.mcpServers.map((name) => {
                                const srv = mcpServers.find((s) => s.name === name);
                                return (
                                    <div
                                        key={name}
                                        className="group flex items-center gap-1.5 rounded border border-border bg-muted/20 px-2 py-1.5"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate">{name}</p>
                                            {srv?.type && (
                                                <Badge variant="outline" className="text-[9px] mt-0.5">{srv.type}</Badge>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => removeMcp(name)}
                                            className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
                                        >
                                            <X className="h-3 w-3"/>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {modal === 'skill' && (
                <MultiSelectModal
                    title={t('pipelines.phaseTools.selectSkills')}
                    items={skills}
                    selected={config.skills}
                    onClose={() => setModal(null)}
                    onConfirm={(sel) => {
                        onChange({...config, skills: sel});
                        setModal(null);
                    }}
                />
            )}
            {modal === 'mcp' && (
                <MultiSelectModal
                    title={t('pipelines.phaseTools.selectMcp')}
                    items={mcpServers.map((s) => ({name: s.name, type: s.type}))}
                    selected={config.mcpServers}
                    onClose={() => setModal(null)}
                    onConfirm={(sel) => {
                        onChange({...config, mcpServers: sel});
                        setModal(null);
                    }}
                />
            )}
        </div>
    );
}

/**
 * @function getDefaultCommand
 * @description 根据测试框架返回默认的测试执行命令
 *
 * 提供常见测试框架的默认命令映射，当用户选择框架时自动填充命令输入框。
 *
 * @param framework - 测试框架标识符
 * @returns 对应的测试执行命令，未知框架返回空字符串
 */
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

/**
 * @constant defaultSteps
 * @description 流水线步骤的默认配置
 *
 * 新建流水线时使用的初始配置模板：
 * - 需求来源默认为ONES系统
 * - 工作空间不绑定（运行时选择）
 * - 各阶段技能默认使用全部技能
 * - MCP工具默认使用全部服务器
 * - 测试策略默认为AI自动生成，执行后自动运行测试
 */
const defaultSteps: PipelineStepConfig = {
    workspace: {},
    plan: {skills: [], mcpServers: []},
    execution: {skills: [], mcpServers: []},
    test: {skills: [], mcpServers: []},
    mcpToolSet: {mode: 'all', selectedServers: []},
    testStrategy: {mode: 'ai_generate', autoRunAfterExecution: true, changedFilesOnly: false, environment: 'local'},
};

/**
 * @function PipelinesPage
 * @description 流水线管理页面主组件（默认导出）
 *
 * 提供完整的流水线CRUD操作界面，采用左右分栏布局：
 * - 左侧（w-72）：流水线列表，显示名称、描述、默认标记、依赖警告及操作按钮
 * - 右侧：创建/编辑表单，包含以下配置区块：
 *   1. 基本信息（名称、描述）
 *   2. 需求来源（ONES/Jira/GitLab/手动 + MCP服务器选择）
 *   3. 工作空间绑定
 *   4. 各阶段技能配置（规划/执行/测试三个阶段独立配置）
 *   5. MCP工具服务器选择
 *   6. 测试策略（AI生成 vs 运行已有测试 + 框架选择 + 自动运行）
 *
 * 组件还包含依赖检测功能（getMissingDeps），在列表中标记引用了不存在的MCP服务器的流水线。
 */
export default function PipelinesPage() {
    const {t} = useTranslation();
    const {run: guideRun, steps: guideSteps, handleJoyrideEvent} = useGuide('pipelines');
    // ─── 列表和选择状态 ───
    const [pipelines, setPipelines] = useState<Pipeline[]>([]);       // 流水线列表数据
    const [selected, setSelected] = useState<Pipeline | null>(null);  // 当前选中的流水线（用于编辑）
    const [creating, setCreating] = useState(false);                  // 是否处于创建模式
    const [editing, setEditing] = useState(false);                    // 是否处于编辑模式
    const [loading, setLoading] = useState(false);                    // 列表加载状态
    const [error, setError] = useState<string | null>(null);          // 全局错误信息

    // ─── 依赖数据（MCP服务器和技能列表） ───
    const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);  // 可用MCP服务器列表
    const [skills, setSkills] = useState<Skill[]>([]);                     // 可用技能列表

    // ─── 执行向导状态 ───
    const [wizardPipeline, setWizardPipeline] = useState<Pipeline | null>(null);  // 待执行的流水线

    // ─── 表单状态 ───
    const [formName, setFormName] = useState('');                      // 表单：流水线名称
    const [formDescription, setFormDescription] = useState('');        // 表单：流水线描述
    const [formSteps, setFormSteps] = useState<PipelineStepConfig>(defaultSteps);  // 表单：步骤配置
    const [savedWorkspaces, setSavedWorkspaces] = useState<{ id: string; name: string; path: string }[]>([]);  // 已保存的工作空间列表

    // 加载已保存的工作空间列表，供表单中的工作空间绑定下拉选择使用
    useEffect(() => {
        apiGet<{ id: string; name: string; path: string }[]>('/workspace/saved')
            .then(setSavedWorkspaces)
            .catch(() => {
            });
    }, []);

    /**
     * 获取流水线列表
     * 从后端API加载所有流水线数据，失败时设置错误信息
     */
    const fetchPipelines = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet<Pipeline[]>('/pipelines');
            setPipelines(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('pipelines.failedFetch');
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * 获取依赖数据（MCP服务器和技能列表）
     * 并行请求两个API，失败时静默处理（非关键数据）
     */
    const fetchDependencies = useCallback(async () => {
        try {
            const [servers, skillList] = await Promise.all([
                apiGet<MCPServerConfig[]>('/mcp-servers').catch(() => []),
                apiGet<Skill[]>('/skills').catch(() => []),
            ]);
            setMcpServers(servers);
            setSkills(skillList);
        } catch {
            // 非关键数据，加载失败不影响页面使用
        }
    }, []);

    // 页面初始化时并行加载流水线列表和依赖数据
    useEffect(() => {
        fetchPipelines();
        fetchDependencies();
    }, [fetchPipelines, fetchDependencies]);

    /**
     * 进入创建模式
     * 重置表单状态，清空名称和描述，使用默认步骤配置
     */
    const startCreate = () => {
        setCreating(true);
        setEditing(false);
        setSelected(null);
        setFormName('');
        setFormDescription('');
        setFormSteps(defaultSteps);
    };

    /**
     * 进入编辑模式
     * 选中指定流水线，并用其当前配置填充表单
     */
    const startEdit = (pipeline: Pipeline) => {
        setSelected(pipeline);
        setEditing(true);
        setCreating(false);
        setFormName(pipeline.name);
        setFormDescription(pipeline.description);
        setFormSteps(pipeline.steps || defaultSteps);
    };

    /**
     * 取消创建/编辑
     * 重置表单模式状态
     */
    const cancelForm = () => {
        setCreating(false);
        setEditing(false);
    };

    /**
     * 保存流水线
     * 根据当前模式（创建/编辑）调用不同的API端点，
     * 成功后关闭表单并刷新列表
     */
    const handleSave = async () => {
        const payload = {
            name: formName.trim(),
            description: formDescription.trim(),
            steps: formSteps,
        };

        try {
            if (creating) {
                // 创建新流水线
                await apiPost('/pipelines', payload);
            } else if (editing && selected) {
                // 更新已有流水线
                await apiPut(`/pipelines/${selected.id}`, payload);
            }
            cancelForm();
            fetchPipelines();
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('pipelines.failedSave');
            setError(msg);
        }
    };

    /**
     * 删除流水线
     * 弹出确认对话框后调用删除API，
     * 如果删除的是当前选中的流水线则清空选择状态
     */
    const handleDelete = async (id: string) => {
        if (!confirm(t('pipelines.deleteConfirm'))) return;
        try {
            await apiDelete(`/pipelines/${id}`);
            // 如果删除的是当前正在编辑的流水线，清空编辑状态
            if (selected?.id === id) {
                setSelected(null);
                setEditing(false);
            }
            fetchPipelines();
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('pipelines.failedDelete');
            setError(msg);
        }
    };

    /**
     * 设置默认流水线
     * 调用API将指定流水线标记为默认，成功后刷新列表
     */
    const setDefault = async (id: string) => {
        try {
            await apiPost(`/pipelines/${id}/set-default`);
            fetchPipelines();
        } catch (err) {
            const msg = err instanceof Error ? err.message : t('pipelines.failedSetDefault');
            setError(msg);
        }
    };

    /**
     * 检测流水线步骤配置中引用的缺失依赖
     *
     * 对比流水线配置中引用的MCP服务器名称与实际可用的服务器列表，
     * 返回所有不存在的服务器名称（去重后）。
     * 用于在流水线列表中显示依赖警告。
     *
     * @param steps - 流水线步骤配置
     * @returns 缺失的依赖名称数组
     */
    const getMissingDeps = (steps: PipelineStepConfig) => {
        const missing: string[] = [];
        // 检查需求来源中配置的MCP服务器是否存在
        const reqMcp = steps.requirementSource?.mcpServerName;
        if (reqMcp) {
            const exists = mcpServers.some((s) => s.name === reqMcp);
            if (!exists) missing.push(reqMcp);
        }
        // 检查MCP工具集中选中的服务器是否存在
        if (steps.mcpToolSet.mode === 'selected') {
            steps.mcpToolSet.selectedServers.forEach((name) => {
                if (!mcpServers.some((s) => s.name === name)) missing.push(name);
            });
        }
        // 去重后返回
        return [...new Set(missing)];
    };

    // @ts-ignore
    return (
        <div className="p-6 h-full flex flex-col">
            {/* 页面标题 */}
            <div className="mb-4 flex items-center gap-3">
                <div
                    className="flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md shadow-indigo-500/30">
                    <Workflow className="h-5 w-5 text-white"/>
                </div>
                <div>
                    <h1 className="text-base font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 bg-clip-text text-transparent leading-tight">
                        {t('pipelines.title')}
                    </h1>
                    <p className="text-xs text-muted-foreground">{t('pipelines.subtitle')}</p>
                </div>
            </div>
            {/* 全局错误提示条 */}
            {error && (
                <div
                    className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            <div className="flex-1 flex gap-4 min-h-0">
                {/* ─── 左侧：流水线列表 ─── */}
                <div className="w-72 flex flex-col flex-shrink-0">
                    {/* 新建流水线按钮 + 刷新依赖数据 */}
                    <div className="flex gap-2 mb-3">
                        <Button onClick={startCreate}
                                className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-md shadow-indigo-500/20 border-0"
                                size="sm" data-tour="pipe-new-btn">
                            <Plus className="h-4 w-4 mr-1"/>
                            {t('pipelines.newPipeline')}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={fetchDependencies}
                            title={t('pipelines.reloadDeps')}
                        >
                            <RefreshCw className="h-4 w-4"/>
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2" data-tour="pipe-list">
                        {/* 加载中状态 */}
                        {loading && (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}
                        {/* 空列表状态 */}
                        {!loading && pipelines.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-8 gap-2">
                                <Workflow className="h-8 w-8 text-muted-foreground/50"/>
                                <p className="text-xs text-muted-foreground">{t('pipelines.noPipelines')}</p>
                            </div>
                        )}
                        {/* 流水线卡片列表 */}
                        {pipelines.map((pipeline) => {
                            // 检测当前流水线的缺失依赖
                            const missing = getMissingDeps(pipeline.steps || defaultSteps);
                            return (
                                <Card
                                    key={pipeline.id}
                                    className={cn(
                                        'relative cursor-pointer transition-all duration-200 overflow-hidden hover:shadow-lg hover:-translate-y-0.5',
                                        selected?.id === pipeline.id
                                            ? 'border-primary ring-1 ring-primary/30 shadow-md'
                                            : 'hover:border-primary/50'
                                    )}
                                    // 点击卡片进入编辑模式
                                    onClick={() => startEdit(pipeline)}
                                >
                                    {/* 左侧渐变色条 */}
                                    <div className={cn(
                                        'absolute left-0 top-0 bottom-0 w-1 transition-all',
                                        selected?.id === pipeline.id
                                            ? 'bg-gradient-to-b from-indigo-500 to-purple-600'
                                            : 'bg-gradient-to-b from-indigo-500/30 to-purple-600/30'
                                    )}/>
                                    <CardContent className="p-3 pl-4">
                                        {/* 流水线名称和默认标记 */}
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium flex-1 truncate">{pipeline.name}</span>
                                            {pipeline.isDefault && (
                                                <Badge variant="default" className="text-[10px]">
                                                    <Star className="h-3 w-3 mr-0.5"/>
                                                    {t('pipelines.defaultBadge')}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 truncate">{pipeline.description}</p>
                                        {/* 缺失依赖警告 */}
                                        {missing.length > 0 && (
                                            <div className="flex items-center gap-1 mt-1.5">
                                                <AlertTriangle className="h-3 w-3 text-amber-500"/>
                                                <span
                                                    className="text-xs text-amber-500">{t('pipelines.missing', {deps: missing.join(', ')})}</span>
                                            </div>
                                        )}
                                        {/* 操作按钮组：运行、设为默认、删除 */}
                                        <div className="mt-2.5 flex gap-2 flex-wrap">
                                            <Button
                                                size="sm"
                                                className="h-7 text-xs bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 border-0"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setWizardPipeline(pipeline);
                                                }}
                                            >
                                                <Play className="h-3 w-3 mr-1"/>
                                                {t('pipelines.run')}
                                            </Button>
                                            {/* 仅非默认流水线才显示"设为默认"按钮 */}
                                            {!pipeline.isDefault && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-xs"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDefault(pipeline.id);
                                                    }}
                                                >
                                                    <Star className="h-3 w-3 mr-1"/>
                                                    {t('pipelines.setDefault')}
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs text-destructive hover:text-destructive"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(pipeline.id);
                                                }}
                                            >
                                                <Trash2 className="h-3 w-3 mr-1"/>
                                                {t('common.delete')}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>

                {/* ─── 右侧：创建/编辑表单 ─── */}
                {(creating || editing) && (
                    <Card className="flex-1 overflow-y-auto" data-tour="pipe-editor">
                        <div className="p-4">
                            <h3 className="text-sm font-medium mb-4">
                                {creating ? t('pipelines.createTitle') : t('pipelines.editTitle', {name: selected?.name})}
                            </h3>
                            <div className="space-y-4">
                                {/* 基本信息：名称 */}
                                <div>
                                    <label
                                        className="block text-xs font-medium text-muted-foreground mb-1.5">{t('pipelines.name')}</label>
                                    <Input value={formName} onChange={(e) => setFormName(e.target.value)}/>
                                </div>
                                {/* 基本信息：描述 */}
                                <div>
                                    <label
                                        className="block text-xs font-medium text-muted-foreground mb-1.5">{t('pipelines.description')}</label>
                                    <Input value={formDescription}
                                           onChange={(e) => setFormDescription(e.target.value)}/>
                                </div>

                                {/* ─── 工作空间绑定配置 ─── */}
                                <div className="border-t border-border pt-4">
                                    <h4 className="text-xs font-medium mb-2">{t('pipelines.workspaceTitle')}</h4>
                                    <select
                                        value={formSteps.workspace.boundPath || ''}
                                        onChange={(e) => setFormSteps({
                                            ...formSteps,
                                            workspace: {boundPath: e.target.value || undefined},
                                        })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="">{t('pipelines.workspaceNotBound')}</option>
                                        {savedWorkspaces.map((ws) => (
                                            <option key={ws.id} value={ws.path}>{ws.name} ({ws.path})</option>
                                        ))}
                                    </select>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {t('pipelines.workspaceHint')}
                                    </p>
                                </div>

                                {/* ─── 各阶段工具配置（技能 + MCP 按阶段独立） ─── */}
                                <div className="border-t border-border pt-4">
                                    <h4 className="text-xs font-medium mb-1">{t('pipelines.skillsPerPhase')}</h4>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        {t('pipelines.skillsDescription')}
                                    </p>
                                    {(['plan', 'execution', 'test'] as const).map((phase) => {
                                        const phaseKey = phase as 'plan' | 'execution' | 'test';
                                        const phaseConfig: PhaseToolsConfig = formSteps[phaseKey] ?? {skills: [], mcpServers: []};
                                        const phaseLabel = phase === 'plan'
                                            ? t('pipelines.phaseTools.planPhase')
                                            : phase === 'execution'
                                                ? t('pipelines.phaseTools.executionPhase')
                                                : t('pipelines.phaseTools.testPhase');
                                        return (
                                            <PhaseToolsCard
                                                key={phase}
                                                phaseLabel={phaseLabel}
                                                config={phaseConfig}
                                                skills={skills}
                                                mcpServers={mcpServers}
                                                onChange={(cfg) => setFormSteps({
                                                    ...formSteps,
                                                    [phaseKey]: cfg,
                                                })}
                                            />
                                        );
                                    })}
                                </div>

                                {/* ─── 文档解析配置（MinerU 额外文件） ─── */}
                                <div className="border-t border-border pt-4">
                                    <h4 className="text-xs font-medium mb-2">{t('pipelines.extraDocuments')}</h4>
                                    <p className="text-xs text-muted-foreground mb-3">
                                        {t('pipelines.extraDocumentsDesc')}
                                    </p>
                                    <div>
                                        {(formSteps.documentParsing?.extraPaths ?? []).map((p, i) => (
                                            <div key={i} className="flex items-center gap-1.5 mb-1.5">
                                                <Input
                                                    value={p}
                                                    onChange={(e) => {
                                                        const paths = [...(formSteps.documentParsing?.extraPaths ?? [])];
                                                        paths[i] = e.target.value;
                                                        setFormSteps({
                                                            ...formSteps,
                                                            documentParsing: {extraPaths: paths},
                                                        });
                                                    }}
                                                    placeholder={t('pipelines.extraDocPlaceholder')}
                                                    className="text-xs h-8"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const paths = (formSteps.documentParsing?.extraPaths ?? []).filter((_, j) => j !== i);
                                                        setFormSteps({
                                                            ...formSteps,
                                                            documentParsing: {extraPaths: paths},
                                                        });
                                                    }}
                                                    className="shrink-0 text-muted-foreground hover:text-destructive"
                                                >
                                                    <X className="h-3.5 w-3.5"/>
                                                </button>
                                            </div>
                                        ))}
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => setFormSteps({
                                                ...formSteps,
                                                documentParsing: {
                                                    extraPaths: [...(formSteps.documentParsing?.extraPaths ?? []), ''],
                                                },
                                            })}
                                        >
                                            <Plus className="h-3 w-3 mr-1"/>
                                            {t('pipelines.addPath')}
                                        </Button>
                                    </div>
                                </div>

                                {/* ─── 测试策略配置 ─── */}
                                <div className="border-t border-border pt-4">
                                    <h4 className="text-xs font-medium mb-2">{t('pipelines.testStrategy')}</h4>

                                    {/* 测试模式选择：AI自动生成 vs 运行已有测试 vs AI E2E */}
                                    <div className="grid grid-cols-3 gap-2 mb-3">
                                        {[
                                            {
                                                value: 'ai_generate',
                                                label: t('pipelines.aiWritesTests'),
                                                desc: t('pipelines.aiWritesTestsDesc')
                                            },
                                            {
                                                value: 'run_existing',
                                                label: t('pipelines.runExisting'),
                                                desc: t('pipelines.runExistingDesc')
                                            },
                                            {
                                                value: 'ai_generate_e2e',
                                                label: t('pipelines.aiE2eTests'),
                                                desc: t('pipelines.aiE2eTestsDesc')
                                            },
                                        ].map((opt) => (
                                            <div
                                                key={opt.value}
                                                onClick={() => setFormSteps({
                                                    ...formSteps,
                                                    testStrategy: {
                                                        ...formSteps.testStrategy,
                                                        mode: opt.value as 'ai_generate' | 'run_existing' | 'ai_generate_e2e'
                                                    },
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

                                    {/* AI模式说明：展示Claude自动测试的能力描述 */}
                                    {formSteps.testStrategy.mode === 'ai_generate' && (
                                        <div
                                            className="rounded-md bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
                                            <p>{t('pipelines.aiAutoDesc')}</p>
                                            <p>• {t('pipelines.aiAutoLine1')}</p>
                                            <p>• {t('pipelines.aiAutoLine2')}</p>
                                            <p>• {t('pipelines.aiAutoLine3')}</p>
                                            <p className="text-primary mt-2">{t('pipelines.aiAutoHint')}</p>
                                        </div>
                                    )}

                                    {formSteps.testStrategy.mode === 'ai_generate_e2e' && (
                                        <div
                                            className="rounded-md bg-blue-500/5 border border-blue-500/20 p-3 text-xs text-muted-foreground space-y-1">
                                            <p className="text-blue-500 font-medium">{t('pipelines.e2eTwoPhase')}</p>
                                            <p>{t('pipelines.e2ePhase1')}</p>
                                            <p>{t('pipelines.e2ePhase2')}</p>
                                            <p className="mt-2">{t('pipelines.e2eHint1')}</p>
                                            <p className="text-primary mt-1">{t('pipelines.e2eHint2')}</p>
                                        </div>
                                    )}

                                    {/* 运行已有测试模式：框架选择和命令配置 */}
                                    {formSteps.testStrategy.mode === 'run_existing' && (
                                        <div className="space-y-2">
                                            <div>
                                                <label
                                                    className="block text-xs text-muted-foreground mb-1">{t('pipelines.framework')}</label>
                                                <select
                                                    value={formSteps.testStrategy.framework || ''}
                                                    onChange={(e) => setFormSteps({
                                                        ...formSteps,
                                                        testStrategy: {
                                                            ...formSteps.testStrategy,
                                                            framework: e.target.value
                                                        },
                                                    })}
                                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                >
                                                    <option value="">{t('pipelines.autoDetect')}</option>
                                                    <optgroup label="Java">
                                                        <option value="junit">JUnit (Maven: mvn test)</option>
                                                        <option value="junit-gradle">JUnit (Gradle: ./gradlew test)
                                                        </option>
                                                    </optgroup>
                                                    <optgroup label="JavaScript / TypeScript">
                                                        <option value="jest">Jest (npm test)</option>
                                                        <option value="vitest">Vitest (npx vitest run)</option>
                                                        <option value="playwright">Playwright (npx playwright test)
                                                        </option>
                                                    </optgroup>
                                                    <optgroup label="Python">
                                                        <option value="pytest">PyTest (pytest)</option>
                                                    </optgroup>
                                                    <optgroup label="Other">
                                                        <option value="custom">Custom command</option>
                                                    </optgroup>
                                                </select>
                                            </div>

                                            {/* 测试命令输入框：根据选择的框架自动填充默认命令 */}
                                            <div>
                                                <label className="block text-xs text-muted-foreground mb-1">
                                                    {t('pipelines.testCommand')}
                                                    <span
                                                        className="ml-1 text-muted-foreground/60">{t('pipelines.testCommandHint')}</span>
                                                </label>
                                                <Input
                                                    value={formSteps.testStrategy.command || getDefaultCommand(formSteps.testStrategy.framework || '')}
                                                    onChange={(e) => setFormSteps({
                                                        ...formSteps,
                                                        testStrategy: {
                                                            ...formSteps.testStrategy,
                                                            command: e.target.value
                                                        },
                                                    })}
                                                    placeholder={t('pipelines.testCommandPlaceholder')}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* 自动运行测试开关 */}
                                    <label className="flex items-center gap-2 text-sm mt-3">
                                        <input
                                            type="checkbox"
                                            checked={formSteps.testStrategy.autoRunAfterExecution}
                                            onChange={(e) => setFormSteps({
                                                ...formSteps,
                                                testStrategy: {
                                                    ...formSteps.testStrategy,
                                                    autoRunAfterExecution: e.target.checked
                                                },
                                            })}
                                            className="rounded border-input"
                                        />
                                        {t('pipelines.autoRun')}
                                    </label>

                                    {/* 仅运行变更文件相关测试开关 */}
                                    {formSteps.testStrategy.autoRunAfterExecution && formSteps.testStrategy.mode === 'run_existing' && (
                                        <label className="flex items-center gap-2 text-sm mt-2 ml-5">
                                            <input
                                                type="checkbox"
                                                checked={formSteps.testStrategy.changedFilesOnly ?? false}
                                                onChange={(e) => setFormSteps({
                                                    ...formSteps,
                                                    testStrategy: {
                                                        ...formSteps.testStrategy,
                                                        changedFilesOnly: e.target.checked
                                                    },
                                                })}
                                                className="rounded border-input"
                                            />
                                            {t('pipelines.changedFilesOnly')}
                                        </label>
                                    )}

                                    {/* 测试执行环境选择 */}
                                    <div className="mt-3 space-y-2">
                                        <label className="text-xs font-medium text-muted-foreground">
                                            {t('pipelines.testEnv')}
                                        </label>
                                        <div className="flex gap-3">
                                            <label className="flex items-center gap-1.5 text-sm">
                                                <input
                                                    type="radio"
                                                    name="testEnvironment"
                                                    checked={(formSteps.testStrategy.environment ?? 'local') === 'local'}
                                                    onChange={() => setFormSteps({
                                                        ...formSteps,
                                                        testStrategy: {
                                                            ...formSteps.testStrategy,
                                                            environment: 'local',
                                                            sandboxId: undefined,
                                                        },
                                                    })}
                                                />
                                                {t('pipelines.localEnv')}
                                            </label>
                                            <label className="flex items-center gap-1.5 text-sm">
                                                <input
                                                    type="radio"
                                                    name="testEnvironment"
                                                    checked={formSteps.testStrategy.environment === 'sandbox'}
                                                    onChange={() => setFormSteps({
                                                        ...formSteps,
                                                        testStrategy: {
                                                            ...formSteps.testStrategy,
                                                            environment: 'sandbox',
                                                        },
                                                    })}
                                                />
                                                {t('pipelines.sandboxEnv')}
                                            </label>
                                        </div>

                                        {/* 沙箱 ID 输入 */}
                                        {formSteps.testStrategy.environment === 'sandbox' && (
                                            <input
                                                type="text"
                                                placeholder={t('pipelines.sandboxIdPlaceholder')}
                                                value={formSteps.testStrategy.sandboxId || ''}
                                                onChange={(e) => setFormSteps({
                                                    ...formSteps,
                                                    testStrategy: {
                                                        ...formSteps.testStrategy,
                                                        sandboxId: e.target.value || undefined,
                                                    },
                                                })}
                                                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* 表单底部操作按钮：保存和取消 */}
                                <div className="flex gap-2 pt-4 border-t border-border">
                                    <Button onClick={handleSave} size="sm">
                                        <Save className="h-4 w-4 mr-1"/>
                                        {creating ? t('common.create') : t('common.save')}
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={cancelForm}>
                                        <X className="h-4 w-4 mr-1"/>
                                        {t('common.cancel')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                )}

                {/* 未选择任何流水线时的空状态提示 */}
                {!creating && !editing && (
                    <Card className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <GitBranch className="h-10 w-10 text-muted-foreground/30"/>
                            <p className="text-sm text-muted-foreground">{t('pipelines.selectEmpty')}</p>
                        </div>
                    </Card>
                )}
            </div>

            {/* 执行向导模态框：当用户点击"Run"按钮时显示 */}
            {wizardPipeline && (
                <ExecutionWizard
                    pipeline={wizardPipeline}
                    onClose={() => setWizardPipeline(null)}
                    savedWorkspaces={savedWorkspaces}
                    mcpServers={mcpServers}
                />
            )}
            <Joyride
                steps={guideSteps}
                run={guideRun}
                onEvent={handleJoyrideEvent}
                continuous
                options={{
                    showProgress: true,
                    skipBeacon: true,
                    primaryColor: '#6366f1',
                    buttons: ['back', 'close', 'primary', 'skip'],
                    zIndex: 10000
                }}
            />
        </div>
    );
}
