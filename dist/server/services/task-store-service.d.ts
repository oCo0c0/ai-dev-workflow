/**
 * @module task-store-service
 * @description 任务持久化存储
 *
 * 任务存储在项目空间目录下: ~/.ai-dev-workbench/projects/{projectId}/tasks.json
 * 与 TaskScheduler 的内存状态配合，持久化用于服务重启恢复。
 */
import type { TaskStatus, TaskPhase, TaskLog } from './task-scheduler-service.js';
export interface PersistedTask {
    id: string;
    name: string;
    projectId: string;
    requirementId: string;
    pipelineId: string;
    branch: string;
    workspacePath: string;
    worktreePath?: string;
    dependsOn: string[];
    baseBranch: string;
    status: TaskStatus;
    phase: TaskPhase;
    sessionId?: string;
    logs: TaskLog[];
    createdAt: string;
    updatedAt: string;
}
export declare class TaskStoreService {
    private getTasksFile;
    private ensureProjectDir;
    listAll(): PersistedTask[];
    listByProject(projectId: string): PersistedTask[];
    get(projectId: string, taskId: string): PersistedTask | undefined;
    getGlobal(taskId: string): PersistedTask | undefined;
    upsert(projectId: string, task: PersistedTask): PersistedTask;
    create(projectId: string, input: Omit<PersistedTask, 'id' | 'createdAt' | 'updatedAt' | 'logs'>): PersistedTask;
    delete(projectId: string, taskId: string): boolean;
}
//# sourceMappingURL=task-store-service.d.ts.map