/**
 * @file 全局应用状态管理 Store
 * @description 基于 Zustand 的全局状态管理模块，集中管理 AI 开发工作台的所有业务状态。
 *              涵盖需求管理、工作空间、开发计划、执行监控、测试结果、
 *              工作流管道、WebSocket 连接状态及 UI 偏好设置等模块。
 *
 *              状态持久化策略:
 *                - 主题偏好（dark/light）持久化到 localStorage
 *                - 当前计划关联的任务 ID 持久化到 localStorage（页面刷新后可恢复）
 *
 *              使用方式:
 *                在组件中通过 `useAppStore(selector)` 订阅所需的状态切片，
 *                Zustand 会自动处理组件重渲染优化，仅在实际使用的状态变化时触发更新。
 */

import {create} from 'zustand';
import type {AgentExecutionSummary} from '../types/agent-types';

// === 数据模型接口定义 ===

/**
 * 需求条目（列表项）
 * @description 需求列表中展示的精简信息，不含详细描述和附件
 */
interface Requirement {
    /** 需求唯一标识（= 需求号，如 CWXT-130341） */
    id: string;
    /** 需求号（与 id 一致，全局唯一） */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态 */
    status: string;
    /** 优先级 */
    priority: string;
    /** 负责人 */
    assignee: string;
    /** 最后更新时间（ISO 格式） */
    updatedAt: string;
}

/**
 * 需求详情
 * @description 继承 Requirement，包含完整的需求描述、验收标准、附件和关联问题
 */
interface RequirementDetail extends Requirement {
    /** 需求详细描述 */
    description: string;
    /** 验收标准列表 */
    acceptanceCriteria: string[];
    /** 附件列表 */
    attachments: { name: string; url: string; type: string }[];
    /** 关联的其他问题/缺陷 */
    relatedIssues: { id: string; title: string; status: string }[];
}

/**
 * 工作空间信息
 * @description 描述当前打开的项目工作空间的元数据
 */
interface WorkspaceInfo {
    /** 工作空间（项目）的文件系统路径 */
    path: string;
    /** 项目类型 */
    projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
    /** 上下文文件列表（AI 分析用的关键文件） */
    contextFiles: string[];
    /** 是否存在 CLAUDE.md 配置文件 */
    hasClaudeMd: boolean;
    /** Git 仓库状态 */
    gitStatus: 'clean' | 'dirty' | 'not_git';
}

/**
 * 开发计划
 * @description AI 生成的完整开发计划，包含风险评估和分步骤实施细节
 */
interface DevelopmentPlan {
    /** 计划唯一标识 */
    id: string;
    /** 关联的需求 ID */
    requirementId: string;
    /** 工作空间路径 */
    workspacePath: string;
    /** 计划摘要 */
    summary: string;
    /** 复杂度评估 */
    complexity: 'low' | 'medium' | 'high';
    /** 风险点列表 */
    risks: string[];
    /** 计划步骤列表 */
    steps: PlanStep[];
    /** 创建时间（ISO 格式） */
    createdAt: string;
    /** 计划状态 */
    status: 'draft' | 'confirmed' | 'executing' | 'completed' | 'failed';
}

/**
 * 计划步骤
 * @description 开发计划中的单个执行步骤
 */
interface PlanStep {
    /** 步骤序号（从 0 开始） */
    index: number;
    /** 步骤标题 */
    title: string;
    /** 步骤详细描述 */
    description: string;
    /** 涉及的目标文件列表 */
    targetFiles: string[];
    /** 操作类型 */
    action: 'create' | 'modify' | 'delete';
    /** 预估工作量 */
    estimatedEffort: string;
}

/**
 * 执行状态
 * @description 当前计划执行的实时状态信息
 */
interface ExecutionStatus {
    /** 执行实例唯一标识 */
    executionId: string;
    /** 关联的计划 ID（可能为空） */
    planId?: string;
    /** 当前正在执行的步骤索引 */
    currentStep: number;
    /** 总步骤数 */
    totalSteps: number;
    /** 执行状态 */
    status: 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | 'waiting_skill_confirm';
    /** 开始时间（ISO 格式） */
    startedAt?: string;
    /** 完成时间（ISO 格式），执行未完成时为 undefined */
    completedAt?: string;
}

/**
 * 执行日志条目
 * @description 执行过程中产生的单条日志记录
 */
export interface ExecutionLogEntry {
    /** 日志时间戳（ISO 格式） */
    timestamp: string;
    /** 关联的步骤索引 */
    stepIndex: number;
    /** 日志类型 */
    type: 'info' | 'output' | 'error' | 'warning';
    /** 日志内容 */
    content: string;
}

/**
 * 测试结果
 * @description 测试运行完成后的汇总结果，包含通过/失败/跳过统计及覆盖率
 */
interface TestResults {
    /** 测试框架名称（如 vitest, jest 等） */
    framework: string;
    /** 总测试用例数 */
    totalTests: number;
    /** 通过数 */
    passed: number;
    /** 失败数 */
    failed: number;
    /** 跳过数 */
    skipped: number;
    /** 总耗时（毫秒） */
    duration: number;
    /** 代码覆盖率百分比（可选） */
    coverage?: number;
    /** 测试套件列表 */
    suites: TestSuite[];
}

/**
 * 测试套件
 * @description 一个测试文件或测试分组，包含多个测试用例
 */
interface TestSuite {
    /** 套件名称 */
    name: string;
    /** 套件内的测试用例列表 */
    tests: TestCase[];
}

/**
 * 测试用例
 * @description 单个测试用例的执行结果
 */
interface TestCase {
    /** 用例名称 */
    name: string;
    /** 用例执行状态 */
    status: 'passed' | 'failed' | 'skipped';
    /** 执行耗时（毫秒） */
    duration: number;
    /** 失败时的错误信息 */
    error?: string;
    /** 失败时的截图（Base64 编码，可选） */
    screenshot?: string;
}

/**
 * 工作流管道
 * @description 预定义的自动化工作流配置
 */
interface WorkflowPipeline {
    /** 管道唯一标识 */
    id: string;
    /** 管道名称 */
    name: string;
    /** 管道描述 */
    description: string;
    /** 是否为默认管道 */
    isDefault: boolean;
    /** 创建时间（ISO 格式） */
    createdAt: string;
    /** 最后更新时间（ISO 格式） */
    updatedAt: string;
}

// === 多任务模型 ===

/** 任务日志 */
interface TaskLog {
    timestamp: string;
    phase: 'plan' | 'execution' | 'test' | 'idle';
    logType: 'info' | 'output' | 'error' | 'warning';
    content: string;
}

/** 任务信息 */
interface TaskInfo {
    id: string;
    name: string;
    projectId: string;
    requirementId: string;
    pipelineId: string;
    branch: string;
    workspacePath: string;
    status: 'pending' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    phase: 'plan' | 'execution' | 'test' | 'idle';
    sessionId?: string;
    logs: TaskLog[];
    createdAt: string;
    updatedAt: string;
}

// === Agent 模型 ===
// AgentExecution和AgentExecutionSummary现在从shared types导入

/** 项目空间 */
interface ProjectSpace {
    id: string;
    name: string;
    workspacePath: string;
    baseBranch: string;
    defaultPipelineId?: string;
    taskCount?: number;
    runningCount?: number;
    createdAt: string;
    updatedAt: string;
}

/** 调度器状态 */
interface SchedulerStatus {
    maxConcurrent: number;
    runningCount: number;
    queueLength: number;
}

// === 应用状态接口 ===

/**
 * 模型配置类型（Claude / Codex 各自的模型参数）
 * 供 AppState.cliProvider.modelConfig 和相关 action 共用
 */
interface ModelConfig {
    claude: {
        model: string;
        extendedThinking: boolean;
        reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        streaming: boolean;
        maxTokens?: number;
    };
    codex: {
        model: string;
        streaming: boolean;
        maxTokens?: number;
    };
}

/**
 * 全局应用状态接口
 * @description 定义整个应用的完整状态树及所有 action 方法。
 *              状态按业务模块划分为：需求、工作空间、计划、执行、测试、管道、WebSocket、UI。
 */
interface AppState {
    // --- 需求管理 ---
    /** 需求相关状态 */
    requirements: {
        /** 需求列表 */
        list: Requirement[];
        /** 当前选中的需求详情 */
        selected: RequirementDetail | null;
        /** 列表是否正在加载 */
        loading: boolean;
    };

    // --- 工作空间 ---
    /** 工作空间相关状态 */
    workspace: {
        /** 当前打开的工作空间信息 */
        current: WorkspaceInfo | null;
        /** 历史打开的工作空间路径列表 */
        history: string[];
    };

    // --- 开发计划 ---
    /** 计划相关状态 */
    plan: {
        /** 当前开发计划 */
        current: DevelopmentPlan | null;
        /** 计划生成/编辑状态 */
        status: 'idle' | 'generating' | 'paused' | 'ready' | 'editing' | 'failed';
        /** 当前计划关联的需求任务 ID（持久化到 localStorage） */
        taskId: string | null;
        /** 计划生成过程中的流式日志输出 */
        logs: string[];
    };

    // --- 执行监控 ---
    /** 执行相关状态 */
    execution: {
        /** 当前执行状态 */
        status: ExecutionStatus | null;
        /** 执行日志列表 */
        logs: ExecutionLogEntry[];
        /** 当前执行实例 ID */
        executionId: string | null;
    };

    // --- 测试 ---
    /** 测试相关状态 */
    tests: {
        /** 最近一次测试结果 */
        results: TestResults | null;
        /** 测试是否正在运行 */
        running: boolean;
        /** 当前沙箱测试阶段 */
        phase: string | null;
        /** 阶段描述标签 */
        phaseLabel: string | null;
    };

    // --- 工作流管道 ---
    /** 管道相关状态 */
    pipelines: {
        /** 管道列表 */
        list: WorkflowPipeline[];
        /** 当前激活的管道 */
        active: WorkflowPipeline | null;
    };

    // --- WebSocket ---
    /** WebSocket 连接状态 */
    ws: {
        /** 是否已连接 */
        connected: boolean;
    };

    // --- UI 偏好 ---
    /** UI 相关状态 */
    ui: {
        /** 主题（浅色/深色 + 多主题，见 Theme 类型）*/
        theme: Theme;
        /** 侧边栏是否折叠 */
        sidebarCollapsed: boolean;
        /** 语言偏好 */
        locale: 'zh' | 'en';
        /** 自定义背景照片（dataURL，持久化到 localStorage） */
        bgImage: string | null;
    };

    // --- CLI Provider ---
    /** Claude 模型档位映射（从配置文件读取） */
    claudeModelTiers: Array<{ tier: string; label: string; model: string }>;
    /** Codex 当前模型（从配置文件读取） */
    codexModel: string | null;
    /** CLI Provider 相关状态 */
    cliProvider: {
        /** 是否已完成首次引导 */
        configured: boolean;
        /** 当前激活的 Provider ID */
        active: string;
        /** 显示引导弹窗 */
        showSetupModal: boolean;
        /** 显示模型配置弹窗 */
        showModelConfigModal: boolean;
        /** 模型配置 */
        modelConfig: ModelConfig;
    };

    // --- 项目空间 & 多任务 ---
    /** 项目空间相关状态 */
    projects: {
        /** 项目空间列表 */
        list: ProjectSpace[];
        /** 当前选中的项目空间 */
        active: ProjectSpace | null;
        /** 是否正在加载 */
        loading: boolean;
    };

    /** 多任务相关状态 */
    tasks: {
        /** 当前项目下的任务列表 */
        list: TaskInfo[];
        /** 当前查看/操作的任务 ID */
        activeTaskId: string | null;
        /** 按任务 ID 索引的日志 Map */
        logsByTask: Record<string, TaskLog[]>;
        /** 调度器状态 */
        scheduler: SchedulerStatus | null;
    };

    // --- Agent ---
    /** Agent相关状态 */
    agents: {
        /** Agent执行列表 */
        executions: AgentExecutionSummary[];
        /** 当前活跃的Agent执行ID */
        activeExecutionId: string | null;
        /** Agent执行日志 */
        logs: string[];
    };

    // === Action 方法 ===

    // 需求管理 actions
    /** 设置需求列表 */
    setRequirements: (list: Requirement[]) => void;
    /** 设置当前选中的需求详情 */
    setSelectedRequirement: (req: RequirementDetail | null) => void;
    /** 设置需求列表加载状态 */
    setRequirementsLoading: (loading: boolean) => void;

    // 工作空间 actions
    /** 设置当前工作空间信息 */
    setCurrentWorkspace: (workspace: WorkspaceInfo | null) => void;
    /** 设置工作空间历史路径列表 */
    setWorkspaceHistory: (history: string[]) => void;

    // 计划 actions
    /** 设置当前开发计划 */
    setCurrentPlan: (plan: DevelopmentPlan | null) => void;
    /** 设置计划状态（idle/generating/paused/ready/editing/failed） */
    setPlanStatus: (status: 'idle' | 'generating' | 'paused' | 'ready' | 'editing' | 'failed') => void;
    /** 设置计划关联的任务 ID（同时持久化到 localStorage） */
    setPlanTaskId: (taskId: string | null) => void;
    /** 追加一条计划生成日志 */
    addPlanLog: (content: string) => void;
    /** 清空计划生成日志 */
    clearPlanLogs: () => void;

    // 执行 actions
    /** 设置执行状态 */
    setExecutionStatus: (status: ExecutionStatus | null) => void;
    /** 设置当前执行实例 ID */
    setExecutionId: (id: string | null) => void;
    /** 追加一条执行日志 */
    addExecutionLog: (entry: ExecutionLogEntry) => void;
    /** 清空执行日志 */
    clearExecutionLogs: () => void;

    // 测试 actions
    /** 设置测试结果 */
    setTestResults: (results: TestResults | null) => void;
    /** 设置测试运行状态 */
    setTestRunning: (running: boolean) => void;
    /** 设置当前沙箱测试阶段 */
    setTestPhase: (phase: string | null, label: string | null) => void;

    // 管道 actions
    /** 设置管道列表 */
    setPipelines: (list: WorkflowPipeline[]) => void;
    /** 设置当前激活的管道 */
    setActivePipeline: (pipeline: WorkflowPipeline | null) => void;

    // WebSocket actions
    /** 设置 WebSocket 连接状态 */
    setWsConnected: (connected: boolean) => void;

    // UI actions
    /** 切换明暗主题 */
    toggleTheme: () => void;
    /** 切换侧边栏折叠状态 */
    toggleSidebar: () => void;
    /** 设置侧边栏折叠状态 */
    setSidebarCollapsed: (collapsed: boolean) => void;
    /** 直接设置主题 */
    setTheme: (theme: Theme) => void;
    /** 设置自定义背景照片（null 表示清除，恢复默认渐变） */
    setBgImage: (img: string | null) => void;
    /** 设置语言偏好 */
    setLocale: (locale: 'zh' | 'en') => void;

    // CLI Provider actions
    /** 设置 CLI Provider 配置状态 */
    setCliProvider: (configured: boolean, active: string) => void;
    /** 显示/隐藏引导弹窗 */
    setShowSetupModal: (show: boolean) => void;
    /** 显示/隐藏模型配置弹窗 */
    setShowModelConfigModal: (show: boolean) => void;
    /** 更新指定 Provider 的模型配置（局部合并） */
    setModelConfig: (
        provider: 'claude' | 'codex',
        config: Partial<ModelConfig['claude']> | Partial<ModelConfig['codex']>,
    ) => void;
    /** 从后端加载模型配置 */
    fetchModelConfig: () => Promise<void>;
    /** 保存模型配置到后端 */
    saveModelConfig: (
        provider: 'claude' | 'codex',
        config: ModelConfig['claude'] | ModelConfig['codex'],
    ) => Promise<void>;
    /** 从配置文件读取可用模型列表 */
    fetchAvailableModels: () => Promise<void>;

    // 项目空间 actions
    /** 设置项目空间列表 */
    setProjects: (list: ProjectSpace[]) => void;
    /** 设置当前选中的项目空间 */
    setActiveProject: (project: ProjectSpace | null) => void;
    /** 设置项目加载状态 */
    setProjectsLoading: (loading: boolean) => void;

    // 多任务 actions
    /** 设置任务列表 */
    setTasks: (list: TaskInfo[]) => void;
    /** 设置当前活跃任务 ID */
    setActiveTaskId: (taskId: string | null) => void;
    /** 追加任务日志 */
    addTaskLog: (taskId: string, log: TaskLog) => void;
    /** 更新单个任务状态 */
    updateTask: (taskId: string, updates: Partial<TaskInfo>) => void;
    /** 设置调度器状态 */
    setSchedulerStatus: (status: SchedulerStatus | null) => void;

    // Agent actions
    /** 设置Agent执行列表 */
    setAgentExecutions: (executions: AgentExecutionSummary[]) => void;
    /** 设置当前活跃的Agent执行ID */
    setActiveAgentExecution: (executionId: string | null) => void;
    /** 添加Agent执行日志 */
    addAgentLog: (content: string, metadata?: {
        timestamp?: string;
        type?: 'output' | 'error' | 'warning' | 'user' | 'system' | 'tool' | 'file' | 'shell';
        taskId?: string;
        subtaskStatus?: 'reading' | 'fetching' | 'generating' | 'processing';
        tokensUsed?: number;
        duration?: number;
    }) => void;
    /** 清空Agent日志 */
    setAgentLogs: (logs: string[]) => void;
    clearAgentLogs: () => void;
}

// === 辅助函数：主题持久化 ===

/**
 * 可用主题（浅色 + 深色两档），通过顶栏主题切换器选择。
 */
export type Theme = 'light' | 'dark';

/** 每个主题所属的明暗模式（决定挂 .light 还是 .dark class，从而控制 tailwind dark: 是否生效） */
const THEME_MODES: Record<Theme, 'light' | 'dark'> = {
    'light': 'light',
    'dark': 'dark',
};

/**
 * 从 localStorage 加载保存的主题设置
 * @returns 保存的主题值，若未保存或非法则默认返回 'dark'
 */
function loadTheme(): Theme {
    // SSR 环境下 localStorage 不可用，返回默认主题
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem('ai-workbench-theme') as Theme | null;
    // 校验合法 Theme 值（兼容旧 'dark'/'light' 与非法值）
    if (stored && stored in THEME_MODES) return stored;
    return 'dark';
}

/**
 * 将主题应用到 DOM 并持久化到 localStorage
 *
 * 通过在 <html> 元素上添加/移除 'dark' 和 'light' CSS 类来控制主题，
 * 同时将选择保存到 localStorage 以便下次加载时恢复。
 *
 * @param theme - 要应用的主题模式
 */
function applyTheme(theme: Theme) {
    // SSR 环境下 document 不可用，跳过 DOM 操作
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    // 按主题明暗模式挂 .light/.dark class（tailwind darkMode:'class' 据此生效）
    const mode = THEME_MODES[theme] ?? 'dark';
    if (mode === 'dark') {
        html.classList.add('dark');
        html.classList.remove('light');
    } else {
        html.classList.add('light');
        html.classList.remove('dark');
    }
    localStorage.setItem('ai-workbench-theme', theme);
}

/** 自定义背景照片 localStorage key */
const BG_IMAGE_KEY = 'ai-workbench-bg';

/**
 * 从 localStorage 加载自定义背景照片
 * @returns dataURL 或 URL；未设置返回 null
 */
function loadBgImage(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(BG_IMAGE_KEY);
}

/**
 * 将自定义背景照片应用到 <body>
 *
 * 有照片时在 <body> 挂 has-bg class 并注入 --user-bg（照片 url），
 * 由 CSS 的 body.has-bg 规则叠加主题色遮罩保证文字可读；
 * 无照片时移除，恢复默认多光晕渐变背景。
 *
 * @param img - 背景照片 dataURL/URL；null 表示清除
 */
function applyBgImage(img: string | null) {
    if (typeof document === 'undefined') return;
    const body = document.body;
    if (img) {
        body.classList.add('has-bg');
        body.style.setProperty('--user-bg', `url("${img}")`);
    } else {
        body.classList.remove('has-bg');
        body.style.removeProperty('--user-bg');
    }
}

// === Zustand Store 实例 ===

/**
 * 全局应用状态 Store
 *
 * 使用 Zustand 的 `create` 方法创建，所有状态和 action 集中管理。
 * Store 创建时会自动从 localStorage 恢复主题和任务 ID 等持久化数据。
 */
export const useAppStore = create<AppState>((set) => {
    const initialTheme = loadTheme();
    const initialBgImage = loadBgImage();
    // Store 初始化时立即应用主题与背景，避免页面闪烁
    applyTheme(initialTheme);
    applyBgImage(initialBgImage);

    return {
        // === 初始状态 ===
        requirements: {list: [], selected: null, loading: false},
        workspace: {current: null, history: []},
        plan: {
            current: null,
            status: 'idle',
            // 从 localStorage 恢复上次关联的任务 ID，页面刷新后可继续上下文
            taskId: typeof window !== 'undefined' ? localStorage.getItem('ai-workbench-plan-taskid') : null,
            logs: [],
        },
        execution: {status: null, logs: [], executionId: null},
        tests: {results: null, running: false, phase: null, phaseLabel: null},
        pipelines: {list: [], active: null},
        ws: {connected: false},
        ui: {
            theme: initialTheme,
            sidebarCollapsed: false,
            locale: (localStorage.getItem('locale') as 'zh' | 'en') || 'zh',
            bgImage: initialBgImage,
        },
        claudeModelTiers: [],
        codexModel: null,
        cliProvider: {
            configured: false,
            active: 'claude',
            showSetupModal: false,
            showModelConfigModal: false,
            modelConfig: {
                claude: {
                    model: 'sonnet',
                    extendedThinking: true,
                    reasoningEffort: 'high',
                    streaming: true,
                },
                codex: {
                    model: 'codex-mini-latest',
                    streaming: true,
                },
            },
        },
        projects: {list: [], active: null, loading: false},
        tasks: {list: [], activeTaskId: null, logsByTask: {}, scheduler: null},
        agents: {executions: [], activeExecutionId: null, logs: []},

        // === 需求管理 Actions ===
        setRequirements: (list) =>
            set((state) => ({requirements: {...state.requirements, list}})),
        setSelectedRequirement: (selected) =>
            set((state) => ({requirements: {...state.requirements, selected}})),
        setRequirementsLoading: (loading) =>
            set((state) => ({requirements: {...state.requirements, loading}})),

        // === 工作空间 Actions ===
        setCurrentWorkspace: (current) =>
            set((state) => ({workspace: {...state.workspace, current}})),
        setWorkspaceHistory: (history) =>
            set((state) => ({workspace: {...state.workspace, history}})),

        // === 计划 Actions ===
        setCurrentPlan: (current) =>
            set((state) => ({plan: {...state.plan, current}})),
        setPlanStatus: (status) =>
            set((state) => ({plan: {...state.plan, status}})),
        setPlanTaskId: (taskId) => {
            // 同步持久化任务 ID 到 localStorage，确保页面刷新后可恢复关联
            if (taskId) {
                localStorage.setItem('ai-workbench-plan-taskid', taskId);
            } else {
                localStorage.removeItem('ai-workbench-plan-taskid');
            }
            return set((state) => ({plan: {...state.plan, taskId}}));
        },
        addPlanLog: (content) =>
            set((state) => ({plan: {...state.plan, logs: [...state.plan.logs, content]}})),
        clearPlanLogs: () =>
            set((state) => ({plan: {...state.plan, logs: []}})),

        // === 执行 Actions ===
        setExecutionStatus: (status) =>
            set((state) => ({execution: {...state.execution, status}})),
        setExecutionId: (executionId) =>
            set((state) => ({execution: {...state.execution, executionId}})),
        addExecutionLog: (entry) =>
            set((state) => ({
                execution: {...state.execution, logs: [...state.execution.logs, entry]},
            })),
        clearExecutionLogs: () =>
            set((state) => ({execution: {...state.execution, logs: []}})),

        // === 测试 Actions ===
        setTestResults: (results) =>
            set((state) => ({tests: {...state.tests, results, phase: null, phaseLabel: null}})),
        setTestRunning: (running) =>
            set((state) => ({tests: {...state.tests, running}})),
        setTestPhase: (phase, label) =>
            set((state) => ({tests: {...state.tests, phase, phaseLabel: label}})),

        // === 管道 Actions ===
        setPipelines: (list) =>
            set((state) => ({pipelines: {...state.pipelines, list}})),
        setActivePipeline: (active) =>
            set((state) => ({pipelines: {...state.pipelines, active}})),

        // === WebSocket Actions ===
        setWsConnected: (connected) => set({ws: {connected}}),

        // === UI Actions ===
        toggleTheme: () =>
            set((state) => {
                // 快捷明暗切换：当前是浅色系 → 切默认深色；否则切浅色
                const newTheme: Theme = THEME_MODES[state.ui.theme] === 'light' ? 'dark' : 'light';
                applyTheme(newTheme);
                return {ui: {...state.ui, theme: newTheme}};
            }),
        toggleSidebar: () =>
            set((state) => ({
                ui: {...state.ui, sidebarCollapsed: !state.ui.sidebarCollapsed},
            })),
        setSidebarCollapsed: (collapsed) =>
            set((state) => ({
                ui: {...state.ui, sidebarCollapsed: collapsed},
            })),
        setTheme: (theme) => {
            applyTheme(theme);
            return set((state) => ({ui: {...state.ui, theme}}));
        },
        setBgImage: (img) => {
            applyBgImage(img);
            if (img) localStorage.setItem(BG_IMAGE_KEY, img);
            else localStorage.removeItem(BG_IMAGE_KEY);
            return set((state) => ({ui: {...state.ui, bgImage: img}}));
        },
        setLocale: (locale) => {
            localStorage.setItem('locale', locale);
            return set((state) => ({ui: {...state.ui, locale}}));
        },

        // === CLI Provider Actions ===
        setCliProvider: (configured, active) =>
            set((state) => ({cliProvider: {...state.cliProvider, configured, active}})),
        setShowSetupModal: (show) =>
            set((state) => ({cliProvider: {...state.cliProvider, showSetupModal: show}})),
        setShowModelConfigModal: (show) =>
            set((state) => ({cliProvider: {...state.cliProvider, showModelConfigModal: show}})),
        setModelConfig: (provider, config) =>
            set((state) => {
                if (provider === 'claude') {
                    return {
                        cliProvider: {
                            ...state.cliProvider,
                            modelConfig: {
                                ...state.cliProvider.modelConfig,
                                claude: {...state.cliProvider.modelConfig.claude, ...config},
                            },
                        },
                    };
                }
                if (provider === 'codex') {
                    return {
                        cliProvider: {
                            ...state.cliProvider,
                            modelConfig: {
                                ...state.cliProvider.modelConfig,
                                codex: {...state.cliProvider.modelConfig.codex, ...config},
                            },
                        },
                    };
                }
                return state;
            }),
        fetchModelConfig: async () => {
            set((state) => ({cliProvider: {...state.cliProvider, loading: true}}));
            try {
                const response = await fetch('/api/system/model-config');
                if (!response.ok) throw new Error('Failed to fetch model config');
                const data = await response.json();
                set((state) => ({
                    cliProvider: {
                        ...state.cliProvider,
                        modelConfig: data,
                    },
                }));
            } catch (err) {
                console.error('Failed to load model config:', err);
            } finally {
                set((state) => ({cliProvider: {...state.cliProvider, loading: false}}));
            }
        },
        saveModelConfig: async (provider, config) => {
            set((state) => ({cliProvider: {...state.cliProvider, saving: true}}));
            try {
                const response = await fetch('/api/system/model-config', {
                    method: 'PUT',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({provider, [provider]: config}),
                });
                if (!response.ok) throw new Error('Failed to save model config');
                // 保存成功后直接更新本地状态，避免循环依赖
                set((state) => ({
                    cliProvider: {
                        ...state.cliProvider,
                        modelConfig: provider === 'claude'
                            ? {
                                ...state.cliProvider.modelConfig,
                                claude: {...state.cliProvider.modelConfig.claude, ...config}
                            }
                            : {
                                ...state.cliProvider.modelConfig,
                                codex: {...state.cliProvider.modelConfig.codex, ...config}
                            },
                    },
                }));
            } catch (err) {
                console.error('Failed to save model config:', err);
                throw err;
            } finally {
                set((state) => ({cliProvider: {...state.cliProvider, saving: false}}));
            }
        },
        fetchAvailableModels: async () => {
            try {
                const response = await fetch('/api/system/available-models');
                if (!response.ok) throw new Error('Failed to fetch available models');
                const data = await response.json() as {
                    claude: Array<{ tier: string; label: string; model: string }>;
                    codex: string | null;
                };
                const tiers = data.claude ?? [];

                // 校正 Claude 当前 model：若不在 tier 列表，回落到 sonnet 或第一个 tier
                set((state) => {
                    const currentModel = state.cliProvider.modelConfig.claude.model;
                    const tierNames = tiers.map(t => t.tier);
                    const isValid = tierNames.includes(currentModel);
                    const fallback = tierNames.includes('sonnet') ? 'sonnet' : tierNames[0];
                    return {
                        claudeModelTiers: tiers,
                        codexModel: data.codex ?? null,
                        ...(isValid || !fallback ? {} : {
                            cliProvider: {
                                ...state.cliProvider,
                                modelConfig: {
                                    ...state.cliProvider.modelConfig,
                                    claude: {...state.cliProvider.modelConfig.claude, model: fallback},
                                },
                            },
                        }),
                    };
                });

                // 校正 Codex：若 config.toml 有值且本地为默认占位，同步过来
                if (data.codex) {
                    set((state) => ({
                        cliProvider: state.cliProvider.modelConfig.codex.model === 'codex-mini-latest' ? {
                            ...state.cliProvider,
                            modelConfig: {
                                ...state.cliProvider.modelConfig,
                                codex: {...state.cliProvider.modelConfig.codex, model: data.codex as string},
                            },
                        } : state.cliProvider,
                    }));
                }
            } catch (err) {
                console.error('Failed to load available models:', err);
            }
        },

        // === 项目空间 Actions ===
        setProjects: (list) =>
            set((state) => ({projects: {...state.projects, list}})),
        setActiveProject: (active) =>
            set((state) => ({projects: {...state.projects, active}})),
        setProjectsLoading: (loading) =>
            set((state) => ({projects: {...state.projects, loading}})),

        // === 多任务 Actions ===
        setTasks: (list) =>
            set((state) => ({tasks: {...state.tasks, list}})),
        setActiveTaskId: (taskId) =>
            set((state) => ({tasks: {...state.tasks, activeTaskId: taskId}})),
        addTaskLog: (taskId, log) =>
            set((state) => ({
                tasks: {
                    ...state.tasks,
                    logsByTask: {
                        ...state.tasks.logsByTask,
                        [taskId]: [...(state.tasks.logsByTask[taskId] || []), log],
                    },
                },
            })),
        updateTask: (taskId, updates) =>
            set((state) => ({
                tasks: {
                    ...state.tasks,
                    list: state.tasks.list.map(t => t.id === taskId ? {...t, ...updates} : t),
                },
            })),
        setSchedulerStatus: (status) =>
            set((state) => ({tasks: {...state.tasks, scheduler: status}})),

        // Agent actions
        setAgentExecutions: (executions) =>
            set((state) => ({agents: {...state.agents, executions}})),
        setActiveAgentExecution: (executionId) =>
            set((state) => ({agents: {...state.agents, activeExecutionId: executionId}})),
        addAgentLog: (content, metadata?: {
            timestamp?: string;
            type?: 'output' | 'error' | 'warning' | 'user' | 'system' | 'tool' | 'file' | 'shell';
            taskId?: string;
            subtaskStatus?: 'reading' | 'fetching' | 'generating' | 'processing';
            tokensUsed?: number;
            duration?: number;
        }) =>
            set((state) => {
                // 如果是对象格式，直接添加
                if (typeof content === 'object') {
                    return {agents: {...state.agents, logs: [...state.agents.logs, JSON.stringify(content)]}};
                }
                // 如果是字符串格式，添加元数据
                if (metadata && Object.keys(metadata).length > 0) {
                    const logEntry = {
                        content: String(content),
                        ...metadata
                    };
                    return {agents: {...state.agents, logs: [...state.agents.logs, JSON.stringify(logEntry)]}};
                }
                // 简单字符串格式
                return {agents: {...state.agents, logs: [...state.agents.logs, content]}};
            }),
        setAgentLogs: (logs: string[]) =>
            set((state) => ({agents: {...state.agents, logs}})),
        clearAgentLogs: () =>
            set((state) => ({agents: {...state.agents, logs: []}}))
    };
});
