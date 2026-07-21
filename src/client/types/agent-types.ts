/** Agent 执行相关共享类型 */

export type ExecutionStatus = 'analyzing' | 'ready' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';

export interface AgentExecutionSummary {
    id: string;
    requirementId: string;
    requirementNumber?: string;
    requirementTitle?: string;
    workspacePath: string;
    status: ExecutionStatus;
    createdAt: string;
    updatedAt: string;
    subTasksCount?: number;
    completedSubTasks?: number;
    currentStep?: number;
    totalSteps?: number;
}

export interface SubTask {
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

export interface ExecutionStep {
    id: string;
    title: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    startedAt?: string;
    completedAt?: string;
    logs: string[];
}

export interface AgentThought {
    type: 'analysis' | 'planning' | 'decision' | 'tool_selection' | 'error';
    content: string;
    timestamp: string;
    confidence?: number;
}

export interface AgentExecutionDetail extends AgentExecutionSummary {
    requirementText?: string;
    thoughts: AgentThought[];
    subTasks: SubTask[];
    steps: ExecutionStep[];
    logs: string[];
    error?: string;
    sessionId?: string;
}
