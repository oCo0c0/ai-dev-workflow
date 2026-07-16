/**
 * @file AgentsPage.tsx
 * @description Agent智能执行页面 - 遵循系统统一设计模式
 *
 * 设计原则：
 * - 左侧面板：Agent执行历史列表（按需求组织）
 * - 右侧面板：当前执行的详细信息
 * - 固化历史会话：一个需求可以多次执行Agent，每次都有记录
 * - 存储方式：按需求文件夹组织，与Plan/Execution页面一致
 */

import {useState, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {apiGet, apiPost, apiDelete} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn, formatRelativeTime} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Card, CardContent} from '../components/ui/card';
import {Input} from '../components/ui/input';
import {
    Bot, FileText, FolderOpen, Play, Pause, ChevronRight,
    Loader2, CheckCircle2, XCircle, Sparkles, Clock,
    RefreshCw, Trash2, Plus, AlertTriangle, Download, Send
} from 'lucide-react';

interface StoredRequirement {
    id: string;
    number?: string;
    title: string;
    description: string;
    savedAt: string;
}

interface WorkspaceInfo {
    id: string;
    name: string;
    path: string;
}

/**
 * Agent执行摘要（用于历史列表）
 */
interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementTitle?: string;
    requirementNumber?: string;
    workspacePath: string;
    agentId: string;
    status: 'running' | 'completed' | 'failed' | 'aborted';
    summary?: string;
    createdAt: string;
    updatedAt: string;
    stepsCount?: number;
    tokensUsed?: number;
    duration?: number;
}

/**
 * 完整的Agent执行信息
 */
interface StoredAgentExecution extends AgentExecutionSummary {
    inputData?: any;
    result?: any;
    error?: string;
    quality?: number;
}

interface ExecutionWizardState {
    step: 1 | 2 | 3 | 4; // 1:选择需求 2:确认工作区 3:展示计划 4:执行中
    selectedRequirement: StoredRequirement | null;
    workspacePath: string;
    executing: boolean;
    paused?: boolean;
    error?: string;
    executionId?: string;
    executionPlan?: any;
}

export default function AgentsPage() {
    const {t} = useTranslation();
    const navigate = useNavigate();

    // 历史记录列表
    const [executions, setExecutions] = useState<AgentExecutionSummary[]>([]);
    const [selectedExecution, setSelectedExecution] = useState<StoredAgentExecution | null>(null);
    const [loading, setLoading] = useState(false);

    // 执行向导状态
    const [wizardOpen, setWizardOpen] = useState(false);
    const [wizardState, setWizardState] = useState<ExecutionWizardState>({
        step: 1,
        selectedRequirement: null,
        workspacePath: '',
        executing: false
    });

    // WebSocket日志
    const agentLogs = useAppStore(s => s.agents.logs);
    const clearAgentLogs = useAppStore(s => s.clearAgentLogs);
    const addAgentLog = useAppStore(s => s.addAgentLog);

    const [requirements, setRequirements] = useState<StoredRequirement[]>([]);
    const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);

    // 用户问题交互
    const [pendingQuestion, setPendingQuestion] = useState<{ executionId: string; question: string } | null>(null);
    const [userAnswer, setUserAnswer] = useState('');

    useEffect(() => {
        loadExecutions();

        // 监听Agent提问事件
        const handleAgentQuestion = (event: CustomEvent) => {
            const {executionId, question} = event.detail;
            setPendingQuestion({executionId, question});
            setUserAnswer('');
        };

        window.addEventListener('agent:question', handleAgentQuestion as EventListener);

        return () => {
            window.removeEventListener('agent:question', handleAgentQuestion as EventListener);
        };
    }, []);

    const loadExecutions = async () => {
        setLoading(true);
        try {
            const response = await apiGet<AgentExecutionSummary[]>('/agents/history');
            setExecutions(response);
        } catch (err) {
            console.error('Failed to load executions:', err);
        } finally {
            setLoading(false);
        }
    };

    const loadExecutionDetail = async (executionId: string) => {
        try {
            const response = await apiGet<StoredAgentExecution>(`/agents/status/${executionId}`);
            setSelectedExecution(response);
        } catch (err) {
            console.error('Failed to load execution detail:', err);
        }
    };

    const loadRequirements = async () => {
        try {
            const response = await apiGet<any[]>('/requirements/saved');
            setRequirements(response.map(req => ({
                id: req.id,
                number: req.number,
                title: req.title,
                description: req.description || '',
                savedAt: req.savedAt
            })));
        } catch (err) {
            console.error('Failed to load requirements:', err);
        }
    };

    const loadWorkspaces = async () => {
        try {
            const response = await apiGet<WorkspaceInfo[]>('/workspace/saved');
            setWorkspaces(response);
        } catch (err) {
            console.error('Failed to load workspaces:', err);
        }
    };

    const deleteExecution = async (executionId: string) => {
        if (!confirm('确定要删除此执行记录吗？')) return;

        try {
            // 调用后端删除接口（会自动中止正在运行的执行）
            await apiDelete(`/agents/${executionId}`);

            // 从列表中移除
            setExecutions(executions.filter(e => e.id !== executionId));
            if (selectedExecution?.id === executionId) {
                setSelectedExecution(null);
            }
        } catch (err) {
            console.error('Failed to delete execution:', err);
        }
    };

    const abortExecution = async (executionId: string) => {
        if (!confirm('确定要中止此执行吗？')) return;

        try {
            await apiPost(`/agents/abort/${executionId}`, {});
            // 刷新列表
            await loadExecutions();
        } catch (err) {
            console.error('Failed to abort execution:', err);
        }
    };

    const pauseExecution = async (executionId: string) => {
        try {
            await apiPost(`/agents/pause/${executionId}`, {});
            addAgentLog('⏸️ 正在暂停执行...');
            // 刷新列表
            await loadExecutions();
        } catch (err) {
            console.error('Failed to pause execution:', err);
        }
    };

    const resumeExecution = async (executionId: string) => {
        try {
            await apiPost(`/agents/resume/${executionId}`, {});
            addAgentLog('▶️ 正在恢复执行...');
            // 刷新列表
            await loadExecutions();
        } catch (err) {
            console.error('Failed to resume execution:', err);
        }
    };

    const answerQuestion = async () => {
        if (!pendingQuestion || !userAnswer.trim()) return;

        try {
            await apiPost('/agents/answer', {
                executionId: pendingQuestion.executionId,
                answer: userAnswer
            });

            addAgentLog(`💬 用户回答: ${userAnswer}`);
            setPendingQuestion(null);
            setUserAnswer('');

            // 刷新执行列表以更新状态
            await loadExecutions();

            // 如果当前正在查看此执行，刷新详情
            if (selectedExecution?.id === pendingQuestion.executionId) {
                await loadExecutionDetail(pendingQuestion.executionId);
            }
        } catch (err) {
            console.error('Failed to submit answer:', err);
            addAgentLog('❌ 提交回答失败');
        }
    };

    const skipQuestion = async () => {
        if (!pendingQuestion) return;

        try {
            await apiPost('/agents/answer', {
                executionId: pendingQuestion.executionId,
                answer: '[SKIP]'
            });

            addAgentLog('⏭️ 用户跳过了此问题');
            setPendingQuestion(null);
            setUserAnswer('');

            // 刷新执行列表以更新状态
            await loadExecutions();

            // 如果当前正在查看此执行，刷新详情
            if (selectedExecution?.id === pendingQuestion.executionId) {
                await loadExecutionDetail(pendingQuestion.executionId);
            }
        } catch (err) {
            console.error('Failed to skip question:', err);
        }
    };

    const startWizard = () => {
        loadRequirements();
        loadWorkspaces();
        setWizardState({
            step: 1,
            selectedRequirement: null,
            workspacePath: '',
            executing: false
        });
        setWizardOpen(true);
    };

    const closeWizard = () => {
        if (wizardState.executing) return;
        setWizardOpen(false);
    };

    const selectRequirement = (req: StoredRequirement) => {
        setWizardState(prev => ({...prev, selectedRequirement: req}));
    };

    const handleBrowseFolder = async () => {
        try {
            const result = await (window as any).electron?.openFolder();
            if (result) {
                setWizardState(prev => ({...prev, workspacePath: result}));
            }
        } catch (err) {
            console.error('Failed to browse folder:', err);
        }
    };

    const canProceed = () => {
        if (wizardState.step === 1) {
            return wizardState.selectedRequirement !== null;
        }
        if (wizardState.step === 2) {
            return wizardState.workspacePath.trim().length > 0;
        }
        if (wizardState.step === 3) {
            return wizardState.executionPlan !== undefined;
        }
        return false;
    };

    const handleNext = () => {
        if (wizardState.step === 1 && canProceed()) {
            setWizardState(prev => ({...prev, step: 2}));
        }
    };

    const handleBack = () => {
        if (wizardState.step === 2) {
            setWizardState(prev => ({...prev, step: 1}));
        }
    };

    const generatePlan = async () => {
        if (!wizardState.selectedRequirement || !wizardState.workspacePath) return;

        setWizardState(prev => ({...prev, executing: true, error: undefined}));
        clearAgentLogs();

        try {
            addAgentLog('🧠 Agent正在分析需求并制定执行计划...');

            const {executionId} = await apiPost<{ executionId: string }>('/agents/coordinator/execute', {
                requirement: `${wizardState.selectedRequirement.title}: ${wizardState.selectedRequirement.description}`,
                workspace: wizardState.workspacePath,
                taskId: `req-${wizardState.selectedRequirement.id}`,
                planOnly: true, // 只生成计划
                context: {
                    requirementId: wizardState.selectedRequirement.id,
                    title: wizardState.selectedRequirement.title
                }
            });

            addAgentLog(`📋 计划生成中...`);

            // 轮询检查计划生成状态
            const pollInterval = setInterval(async () => {
                try {
                    const execution = await apiGet<any>(`/agents/status/${executionId}`);

                    if (execution.status === 'completed' && execution.result?.plan) {
                        clearInterval(pollInterval);
                        addAgentLog('✅ 计划生成完成！');

                        setWizardState(prev => ({
                            ...prev,
                            executing: false,
                            step: 3,
                            executionId,
                            executionPlan: execution.result.plan
                        }));
                    } else if (execution.status === 'failed') {
                        clearInterval(pollInterval);
                        addAgentLog(`❌ 计划生成失败: ${execution.error || 'Unknown error'}`);
                        setWizardState(prev => ({...prev, executing: false, error: execution.error}));
                    }
                } catch (err) {
                    clearInterval(pollInterval);
                    addAgentLog(`❌ 轮询错误: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setWizardState(prev => ({
                        ...prev,
                        executing: false,
                        error: err instanceof Error ? err.message : 'Unknown error'
                    }));
                }
            }, 1000);
        } catch (err) {
            addAgentLog(`❌ 启动失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setWizardState(prev => ({
                ...prev,
                executing: false,
                error: err instanceof Error ? err.message : 'Unknown error'
            }));
        }
    };

    const confirmAndExecute = async () => {
        if (!wizardState.executionId) return;

        setWizardState(prev => ({...prev, step: 4, executing: true}));
        clearAgentLogs();

        try {
            addAgentLog('🚀 开始执行计划...');

            await apiPost('/agents/coordinator/confirm-execution', {
                executionId: wizardState.executionId
            });

            addAgentLog('⏳ 正在执行，请稍候...');

            // 轮询检查执行状态
            const pollInterval = setInterval(async () => {
                try {
                    const execution = await apiGet<any>(`/agents/status/${wizardState.executionId}`);

                    if (execution.status === 'completed') {
                        clearInterval(pollInterval);
                        addAgentLog('✅ 执行完成！');
                        addAgentLog(`📊 共执行了 ${execution.result?.plan?.steps?.length || 0} 个步骤`);

                        // 刷新列表并关闭向导
                        await loadExecutions();
                        setWizardOpen(false);
                        setWizardState({
                            step: 1,
                            selectedRequirement: null,
                            workspacePath: '',
                            executing: false,
                            executionId: undefined,
                            executionPlan: undefined
                        });
                    } else if (execution.status === 'failed') {
                        clearInterval(pollInterval);
                        addAgentLog(`❌ 执行失败: ${execution.error || 'Unknown error'}`);
                        setWizardState(prev => ({...prev, executing: false, error: execution.error}));
                    } else if (execution.status === 'aborted') {
                        clearInterval(pollInterval);
                        addAgentLog('⚠️ 执行已中止');
                        setWizardState(prev => ({...prev, executing: false}));
                    }
                } catch (err) {
                    clearInterval(pollInterval);
                    addAgentLog(`❌ 轮询错误: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    setWizardState(prev => ({
                        ...prev,
                        executing: false,
                        error: err instanceof Error ? err.message : 'Unknown error'
                    }));
                }
            }, 2000);
        } catch (err) {
            addAgentLog(`❌ 启动执行失败: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setWizardState(prev => ({
                ...prev,
                executing: false,
                error: err instanceof Error ? err.message : 'Unknown error'
            }));
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'running':
                return <Loader2 className="w-4 h-4 animate-spin text-blue-500"/>;
            case 'completed':
                return <CheckCircle2 className="w-4 h-4 text-green-500"/>;
            case 'failed':
                return <XCircle className="w-4 h-4 text-red-500"/>;
            case 'aborted':
                return <AlertTriangle className="w-4 h-4 text-yellow-500"/>;
            default:
                return <Clock className="w-4 h-4 text-muted-foreground"/>;
        }
    };

    const getStatusText = (status: string) => {
        switch (status) {
            case 'running':
                return '执行中';
            case 'completed':
                return '已完成';
            case 'failed':
                return '失败';
            case 'aborted':
                return '已中止';
            default:
                return '未知';
        }
    };

    return (
        <div className="flex h-full bg-background">
            {/* 左侧面板：执行历史列表 */}
            <div className="w-80 border-r border-border flex flex-col">
                {/* 头部 */}
                <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Bot className="w-5 h-5 text-primary"/>
                            <h2 className="text-sm font-semibold">Agent执行历史</h2>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={loadExecutions}
                            className="h-7 px-2"
                        >
                            <RefreshCw className="w-3 h-3"/>
                        </Button>
                    </div>
                    <Button
                        onClick={startWizard}
                        className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                        size="sm"
                    >
                        <Plus className="w-4 h-4 mr-2"/>
                        新建执行
                    </Button>
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground"/>
                        </div>
                    ) : executions.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <Bot className="w-10 h-10 mx-auto mb-2 opacity-30"/>
                            <p className="text-xs">暂无执行记录</p>
                            <p className="text-xs mt-1">点击"新建执行"开始</p>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {executions.map((execution) => (
                                <div
                                    key={execution.id}
                                    className={cn(
                                        'group p-3 rounded-lg border transition-all hover:bg-accent/50',
                                        selectedExecution?.id === execution.id
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <div
                                            className="flex items-center gap-1.5 shrink-0"
                                            onClick={() => loadExecutionDetail(execution.id)}
                                        >
                                            {getStatusIcon(execution.status)}
                                        </div>
                                        <div
                                            className="flex-1 min-w-0"
                                            onClick={() => loadExecutionDetail(execution.id)}
                                        >
                                            <p className="text-xs font-medium truncate">
                                                {execution.requirementTitle || '未知需求'}
                                            </p>
                                            {execution.requirementNumber && (
                                                <p className="text-[10px] text-muted-foreground font-mono">
                                                    {execution.requirementNumber}
                                                </p>
                                            )}
                                        </div>
                                        <div
                                            className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                            {execution.status === 'running' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 w-6 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        abortExecution(execution.id);
                                                    }}
                                                >
                                                    <XCircle className="w-3.5 h-3.5"/>
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-red-50"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteExecution(execution.id);
                                                }}
                                            >
                                                <Trash2 className="w-3.5 h-3.5"/>
                                            </Button>
                                        </div>
                                    </div>
                                    <div
                                        className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1"
                                        onClick={() => loadExecutionDetail(execution.id)}
                                    >
                                        <span>{getStatusText(execution.status)}</span>
                                        {execution.stepsCount && (
                                            <>
                                                <span>·</span>
                                                <span>{execution.stepsCount}个步骤</span>
                                            </>
                                        )}
                                        <span>·</span>
                                        <span>{formatRelativeTime(execution.updatedAt)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* 右侧面板：执行详情 */}
            <div className="flex-1 flex flex-col">
                {selectedExecution ? (
                    <>
                        {/* 详情头部 */}
                        <div className="p-4 border-b border-border">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    {getStatusIcon(selectedExecution.status)}
                                    <div>
                                        <h3 className="text-sm font-semibold">
                                            {selectedExecution.requirementTitle || '未知需求'}
                                        </h3>
                                        {selectedExecution.requirementNumber && (
                                            <span className="text-xs text-muted-foreground font-mono ml-2">
                                                {selectedExecution.requirementNumber}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {selectedExecution.status === 'running' && (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => pauseExecution(selectedExecution.id)}
                                                className="h-7 px-2 text-xs"
                                            >
                                                <Pause className="w-3 h-3 mr-1"/>
                                                暂停
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => abortExecution(selectedExecution.id)}
                                                className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            >
                                                中止执行
                                            </Button>
                                        </>
                                    )}
                                    {selectedExecution.status === 'paused' && (
                                        <>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => resumeExecution(selectedExecution.id)}
                                                className="h-7 px-2 text-xs"
                                            >
                                                <Play className="w-3 h-3 mr-1"/>
                                                恢复
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => abortExecution(selectedExecution.id)}
                                                className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            >
                                                中止执行
                                            </Button>
                                        </>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setSelectedExecution(null)}
                                    >
                                        关闭
                                    </Button>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-4 text-xs">
                                <div>
                                    <span className="text-muted-foreground">工作区:</span>
                                    <span className="font-mono ml-1">{selectedExecution.workspacePath}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">创建时间:</span>
                                    <span
                                        className="ml-1">{new Date(selectedExecution.createdAt).toLocaleString()}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground">状态:</span>
                                    <span className="ml-1">{getStatusText(selectedExecution.status)}</span>
                                </div>
                            </div>
                        </div>

                        {/* 详情内容 */}
                        <div className="flex-1 overflow-y-auto p-4">
                            {selectedExecution.result?.plan && (
                                <Card className="mb-4">
                                    <CardContent className="p-4">
                                        <h4 className="text-sm font-semibold mb-3">执行计划</h4>
                                        <div className="space-y-2">
                                            {selectedExecution.result.plan.steps.map((step: any, index: number) => (
                                                <div key={index} className="p-3 rounded border border-border">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-xs font-medium">{step.agentName}</span>
                                                        <span className={cn(
                                                            'text-xs px-2 py-0.5 rounded',
                                                            step.status === 'completed' ? 'bg-green-500/10 text-green-600' :
                                                                step.status === 'failed' ? 'bg-red-500/10 text-red-600' :
                                                                    step.status === 'running' ? 'bg-blue-500/10 text-blue-600' :
                                                                        'bg-muted text-muted-foreground'
                                                        )}>
                                                            {step.status === 'completed' ? '已完成' :
                                                                step.status === 'failed' ? '失败' :
                                                                    step.status === 'running' ? '执行中' : '待执行'}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">{step.reasoning}</p>
                                                    {step.result && (
                                                        <div className="mt-2 p-2 bg-muted/30 rounded text-xs">
                                                            <p className="text-muted-foreground mb-1">执行结果:</p>
                                                            <pre
                                                                className="text-xs overflow-x-auto">{JSON.stringify(step.result, null, 2)}</pre>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

                            {selectedExecution.error && (
                                <Card>
                                    <CardContent className="p-4">
                                        <h4 className="text-sm font-semibold mb-2 text-red-600">执行错误</h4>
                                        <p className="text-sm text-muted-foreground">{selectedExecution.error}</p>
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    </>
                ) : (
                    /* 空状态 */
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-muted-foreground">
                            <Bot className="w-16 h-16 mx-auto mb-4 opacity-20"/>
                            <p>选择执行记录查看详情</p>
                            <p className="text-sm mt-1">或点击"新建执行"开始</p>
                        </div>
                    </div>
                )}

                {/* 执行日志面板 */}
                {agentLogs.length > 0 && (
                    <div className="h-48 border-t border-border">
                        <div className="p-2 border-b border-border bg-muted/50 flex items-center justify-between">
                            <span className="text-xs font-medium">执行日志</span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={clearAgentLogs}
                                className="h-6 px-2 text-xs"
                            >
                                清空
                            </Button>
                        </div>
                        <div className="p-2 h-32 overflow-y-auto">
                            {agentLogs.map((log, index) => (
                                <div
                                    key={index}
                                    className="text-xs font-mono p-1.5 rounded bg-background border border-border mb-1"
                                >
                                    {log}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* 执行向导 */}
            {wizardOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div
                        className="relative z-10 w-full max-w-lg mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
                        {/* 向导头部 */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                            <div>
                                <h2 className="text-sm font-semibold">新建Agent执行</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">Agent自主决策模式</p>
                            </div>
                            <button
                                onClick={closeWizard}
                                disabled={wizardState.executing}
                                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                            >
                                <Clock className="h-4 w-4"/>
                            </button>
                        </div>

                        {/* 向导内容 */}
                        <div className="flex-1 overflow-y-auto p-5">
                            {/* 步骤1：选择需求 */}
                            {wizardState.step === 1 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-medium">选择需求</h3>
                                    {requirements.length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground">
                                            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30"/>
                                            <p className="text-sm">暂无需求</p>
                                            <p className="text-xs">请先在需求管理页面添加</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2 max-h-60 overflow-y-auto">
                                            {requirements.map((req) => (
                                                <div
                                                    key={req.id}
                                                    onClick={() => selectRequirement(req)}
                                                    className={cn(
                                                        'p-3 rounded border cursor-pointer transition-all hover:bg-accent/50',
                                                        wizardState.selectedRequirement?.id === req.id
                                                            ? 'border-primary bg-primary/10'
                                                            : 'border-border'
                                                    )}
                                                >
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex-1">
                                                            <p className="text-sm font-medium">{req.title}</p>
                                                            {req.number && (
                                                                <p className="text-xs text-muted-foreground font-mono">{req.number}</p>
                                                            )}
                                                        </div>
                                                        {wizardState.selectedRequirement?.id === req.id && (
                                                            <CheckCircle2 className="w-4 h-4 text-primary shrink-0"/>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 步骤3：展示计划 */}
                            {wizardState.step === 3 && wizardState.executionPlan && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-primary"/>
                                        Agent执行计划
                                    </h3>
                                    <p className="text-xs text-muted-foreground">
                                        Agent已分析需求并制定执行计划，请确认后开始执行：
                                    </p>

                                    <Card>
                                        <CardContent className="p-4">
                                            <div className="space-y-3">
                                                {/* 计划概览 */}
                                                <div
                                                    className="p-3 rounded-lg bg-gradient-to-br from-indigo-500/5 to-purple-600/5 border border-indigo-500/20">
                                                    <div className="flex items-start gap-2">
                                                        <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5"/>
                                                        <div className="flex-1">
                                                            <p className="text-sm font-medium text-foreground">执行策略</p>
                                                            <p className="text-xs text-muted-foreground mt-1">
                                                                {wizardState.executionPlan.strategy}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* 执行步骤列表 */}
                                                <div className="space-y-2">
                                                    <h4 className="text-xs font-semibold">执行步骤</h4>
                                                    {wizardState.executionPlan.steps.map((step: any, index: number) => (
                                                        <div key={index} className="p-3 rounded border border-border">
                                                            <div className="flex items-start gap-3">
                                                                <div
                                                                    className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-semibold">
                                                                    {step.order}
                                                                </div>
                                                                <div className="flex-1">
                                                                    <p className="text-xs font-medium">{step.agentName}</p>
                                                                    <p className="text-xs text-muted-foreground mt-0.5">{step.reasoning}</p>
                                                                    <div className="flex items-center gap-2 mt-1">
                                                                        <span className={cn(
                                                                            'text-xs px-2 py-0.5 rounded',
                                                                            step.status === 'completed' ? 'bg-green-500/10 text-green-600' :
                                                                                step.status === 'running' ? 'bg-blue-500/10 text-blue-600' :
                                                                                    'bg-muted/50 text-muted-foreground'
                                                                        )}>
                                                                            {step.status === 'completed' ? '已完成' :
                                                                                step.status === 'running' ? '执行中' : '待执行'}
                                                                        </span>
                                                                        {step.confidence && (
                                                                            <span
                                                                                className="text-xs text-muted-foreground">
                                                                                置信度: {Math.round(step.confidence * 100)}%
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* 预估信息 */}
                                                <div
                                                    className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border">
                                                    <span>预估token: {wizardState.executionPlan.estimatedTokens}</span>
                                                    <span>•</span>
                                                    <span>共 {wizardState.executionPlan.steps.length} 个步骤</span>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}

                            {/* 步骤4：执行中 */}
                            {wizardState.step === 4 && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold flex items-center gap-2">
                                            {wizardState.paused ? (
                                                <Pause className="w-4 h-4 text-orange-500"/>
                                            ) : (
                                                <Play className="w-4 h-4 text-primary"/>
                                            )}
                                            {wizardState.paused ? '执行已暂停' : '正在执行...'}
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            {wizardState.paused ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => wizardState.executionId && resumeExecution(wizardState.executionId)}
                                                    className="h-7 px-2 text-xs"
                                                >
                                                    <Play className="w-3 h-3 mr-1"/>
                                                    恢复执行
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => wizardState.executionId && pauseExecution(wizardState.executionId)}
                                                    className="h-7 px-2 text-xs"
                                                >
                                                    <Pause className="w-3 h-3 mr-1"/>
                                                    暂停
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => wizardState.executionId && abortExecution(wizardState.executionId)}
                                                className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                                            >
                                                中止
                                            </Button>
                                        </div>
                                    </div>

                                    {/* 执行进度 */}
                                    <Card>
                                        <CardContent className="p-4">
                                            <div className="space-y-2">
                                                {wizardState.executionPlan?.steps.map((step: any, index: number) => (
                                                    <div key={index} className="p-3 rounded border border-border">
                                                        <div className="flex items-start gap-3">
                                                            <div className={cn(
                                                                'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold',
                                                                step.status === 'completed' ? 'bg-green-500 text-white' :
                                                                    step.status === 'running' ? 'bg-blue-500 text-white animate-pulse' :
                                                                        'bg-muted text-muted-foreground'
                                                            )}>
                                                                {step.status === 'completed' ? '✓' :
                                                                    step.status === 'running' ? '●' :
                                                                        step.order}
                                                            </div>
                                                            <div className="flex-1">
                                                                <p className="text-xs font-medium">{step.agentName}</p>
                                                                <p className="text-xs text-muted-foreground">{step.reasoning}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>

                                    {/* 实时日志 */}
                                    <Card>
                                        <CardContent className="p-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-xs font-semibold">执行日志</h4>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={clearAgentLogs}
                                                    className="h-6 px-2 text-xs"
                                                >
                                                    清空
                                                </Button>
                                            </div>
                                            <div
                                                className="bg-muted/50 rounded p-2 h-40 overflow-y-auto font-mono text-xs space-y-1">
                                                {agentLogs.length === 0 ? (
                                                    <div className="text-muted-foreground text-center py-4">
                                                        等待日志输出...
                                                    </div>
                                                ) : (
                                                    agentLogs.map((log, index) => (
                                                        <div key={index} className="text-muted-foreground">
                                                            {log}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </div>
                            )}

                            {/* 步骤2：确认工作区 */}
                            {wizardState.step === 2 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-medium">确认工作区</h3>

                                    {/* 当前需求 */}
                                    <div className="p-3 rounded bg-muted/50 border border-border">
                                        <p className="text-xs text-muted-foreground mb-1">当前需求</p>
                                        <p className="text-sm font-medium">{wizardState.selectedRequirement?.title}</p>
                                        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                                            {wizardState.selectedRequirement?.description}
                                        </p>
                                    </div>

                                    {/* 工作区选择 */}
                                    <div>
                                        <label className="block text-xs text-muted-foreground mb-2">
                                            选择工作区
                                        </label>
                                        <select
                                            value={wizardState.workspacePath}
                                            onChange={(e) => setWizardState(prev => ({
                                                ...prev,
                                                workspacePath: e.target.value
                                            }))}
                                            className="w-full flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">选择工作区...</option>
                                            {workspaces.map((ws) => (
                                                <option key={ws.id} value={ws.path}>{ws.name} ({ws.path})</option>
                                            ))}
                                        </select>
                                    </div>

                                    <Button
                                        variant="outline"
                                        onClick={handleBrowseFolder}
                                        className="w-full"
                                    >
                                        <FolderOpen className="w-4 h-4 mr-2"/>
                                        浏览文件夹
                                    </Button>

                                    {wizardState.workspacePath && (
                                        <div className="p-3 rounded border border-border bg-muted/20">
                                            <p className="text-xs text-muted-foreground mb-1">已选择</p>
                                            <p className="text-sm font-mono">{wizardState.workspacePath}</p>
                                        </div>
                                    )}

                                    {wizardState.error && (
                                        <div
                                            className="p-3 rounded border border-red-500/30 bg-red-500/10 text-sm text-red-600">
                                            {wizardState.error}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 向导底部 */}
                        <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/10">
                            {wizardState.step === 3 ? (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setWizardOpen(false)}
                                        disabled={wizardState.executing}
                                    >
                                        取消
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={confirmAndExecute}
                                        disabled={wizardState.executing}
                                        className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                                    >
                                        {wizardState.executing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin"/>
                                                执行中...
                                            </>
                                        ) : (
                                            <>
                                                <Play className="w-4 h-4 mr-2"/>
                                                确认执行
                                            </>
                                        )}
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleBack}
                                        disabled={wizardState.step === 1 || wizardState.step === 4 || wizardState.executing}
                                    >
                                        上一步
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={wizardState.step === 2 ? generatePlan : handleNext}
                                        disabled={!canProceed() || wizardState.executing || wizardState.step === 4}
                                        className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                                    >
                                        {wizardState.executing ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin"/>
                                                {wizardState.step === 2 ? '生成计划中...' : '执行中...'}
                                            </>
                                        ) : wizardState.step === 2 ? (
                                            <>
                                                <Sparkles className="w-4 h-4 mr-2"/>
                                                生成计划
                                            </>
                                        ) : (
                                            '下一步'
                                        )}
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Agent提问对话框 */}
            {pendingQuestion && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <Card className="w-full max-w-lg mx-4">
                        <CardContent className="p-6">
                            <div className="flex items-start gap-3 mb-4">
                                <div
                                    className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                                    <Bot className="w-5 h-5 text-white"/>
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-sm font-semibold mb-1">Agent提问</h3>
                                    <p className="text-sm text-muted-foreground">
                                        {pendingQuestion.question}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs text-muted-foreground mb-2">
                                        您的回答
                                    </label>
                                    <textarea
                                        value={userAnswer}
                                        onChange={(e) => setUserAnswer(e.target.value)}
                                        placeholder="请输入您的回答..."
                                        className="w-full h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                                        autoFocus
                                    />
                                </div>

                                <div className="flex items-center justify-end gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={skipQuestion}
                                        className="text-xs"
                                    >
                                        跳过
                                    </Button>
                                    <Button
                                        size="sm"
                                        onClick={answerQuestion}
                                        disabled={!userAnswer.trim()}
                                        className="bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700"
                                    >
                                        <Send className="w-3 h-3 mr-2"/>
                                        发送回答
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    );
}
