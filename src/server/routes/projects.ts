/**
 * @module routes/tasks
 * @description 多任务管理 API 路由
 *
 * 任务以 SavedWorkspace ID 组织（替代独立的 ProjectSpace 实体）。
 * 提供：任务 CRUD、调度控制（启动/暂停/恢复/终止）、调度器配置。
 */

import {Router} from 'express';
import type {TaskStoreService} from '../services/task-store-service.js';
import type {TaskScheduler, TaskInfo} from '../services/task-scheduler-service.js';
import type {WorkspaceService} from '../services/workspace-service.js';

export function createTaskRoutes(
    taskStore: TaskStoreService,
    taskScheduler: TaskScheduler,
    workspaceService: WorkspaceService,
): Router {
    const router = Router();

    // ==================== 任务管理（以 workspaceId 组织） ====================

    /** 列出工作区下所有任务（合并调度器实时状态） */
    router.get('/workspace/:workspaceId', (req, res) => {
        const persisted = taskStore.listByProject(req.params.workspaceId);
        // 合并 TaskScheduler 内存中的实时状态
        const merged = persisted.map(t => {
            const live = taskScheduler.getTask(t.id);
            return live
                ? {...t, status: live.status, phase: live.phase, sessionId: live.sessionId, logs: live.logs}
                : t;
        });
        res.json(merged);
    });

    /** 获取所有工作区的任务统计 */
    router.get('/summary', (_req, res) => {
        const allTasks = taskStore.listAll();
        const grouped = new Map<string, { total: number; running: number }>();
        for (const task of allTasks) {
            const stats = grouped.get(task.projectId) || {total: 0, running: 0};
            stats.total++;
            if (task.status === 'running') stats.running++;
            grouped.set(task.projectId, stats);
        }
        res.json(Object.fromEntries(grouped));
    });

    /** 创建任务（自动创建 Git 分支） */
    router.post('/workspace/:workspaceId', async (req, res) => {
        const {name, requirementId, pipelineId, baseBranch, dependsOn} = req.body;
        const workspaceId = req.params.workspaceId;

        // 从 SavedWorkspace 获取信息
        const savedWorkspaces = workspaceService.listSavedWorkspaces();
        const workspace = savedWorkspaces.find(ws => ws.id === workspaceId);
        if (!workspace) {
            res.status(404).json({message: 'Workspace not found'});
            return;
        }
        if (!requirementId) {
            res.status(400).json({message: 'requirementId is required'});
            return;
        }

        const resolvedPipelineId = pipelineId || workspace.defaultPipelineId;
        if (!resolvedPipelineId) {
            res.status(400).json({message: 'pipelineId is required (no default pipeline set for this workspace)'});
            return;
        }

        try {
            const resolvedBaseBranch = baseBranch || workspace.baseBranch || 'main';

            // 创建独立 Git Worktree（并行隔离）
            const {branch} = await workspaceService.createTaskBranch(
                workspace.path,
                resolvedBaseBranch,
                name || `task-${Date.now()}`
            );

            const task = taskStore.create(workspaceId, {
                name: name || branch,
                projectId: workspaceId,
                requirementId,
                pipelineId: resolvedPipelineId,
                branch,
                workspacePath: workspace.path,
                dependsOn: Array.isArray(dependsOn) ? dependsOn : [],
                baseBranch: resolvedBaseBranch,
                status: 'pending',
                phase: 'idle',
            });

            // 注册到调度器
            const schedulerTask: TaskInfo = {
                ...task,
                logs: [],
            };
            taskScheduler.registerTask(schedulerTask);

            res.status(201).json(task);
        } catch (err) {
            res.status(500).json({message: (err as Error).message});
        }
    });

    /** 获取任务详情 */
    router.get('/:taskId', (req, res) => {
        const task = taskStore.getGlobal(req.params.taskId);
        if (!task) {
            res.status(404).json({message: 'Task not found'});
            return;
        }
        const liveTask = taskScheduler.getTask(req.params.taskId);
        res.json({
            ...task,
            status: liveTask?.status || task.status,
            phase: liveTask?.phase || task.phase,
            sessionId: liveTask?.sessionId || task.sessionId,
        });
    });

    /** 启动任务（立即返回，流水线后台异步执行） */
    router.post('/:taskId/start', async (req, res) => {
        const {taskId} = req.params;
        const task = taskStore.getGlobal(taskId);
        if (!task) {
            res.status(404).json({message: 'Task not found'});
            return;
        }

        // 先返回 HTTP 响应，再异步启动流水线
        res.json({success: true, taskId});

        // 后台异步执行，持久化由 onPersist 回调自动处理
        taskScheduler.startTask(taskId).catch(err => {
            console.error(`[task-scheduler] Task ${taskId} failed: ${err instanceof Error ? err.message : err}`);
        });
    });

    /** 暂停任务 */
    router.post('/:taskId/pause', async (req, res) => {
        try {
            await taskScheduler.pauseTask(req.params.taskId);
            const task = taskStore.getGlobal(req.params.taskId);
            if (task) {
                task.status = 'paused';
                task.updatedAt = new Date().toISOString();
                taskStore.upsert(task.projectId, task);
            }
            res.json({success: true});
        } catch (err) {
            res.status(400).json({message: (err as Error).message});
        }
    });

    /** 恢复任务 */
    router.post('/:taskId/resume', async (req, res) => {
        try {
            await taskScheduler.resumeTask(req.params.taskId);
            const task = taskStore.getGlobal(req.params.taskId);
            if (task) {
                const liveTask = taskScheduler.getTask(req.params.taskId);
                task.status = liveTask?.status || 'running';
                task.updatedAt = new Date().toISOString();
                taskStore.upsert(task.projectId, task);
            }
            res.json({success: true});
        } catch (err) {
            res.status(400).json({message: (err as Error).message});
        }
    });

    /** 终止任务 */
    router.post('/:taskId/abort', async (req, res) => {
        try {
            await taskScheduler.abortTask(req.params.taskId);
            const task = taskStore.getGlobal(req.params.taskId);
            if (task) {
                task.status = 'aborted';
                task.updatedAt = new Date().toISOString();
                taskStore.upsert(task.projectId, task);
            }
            res.json({success: true});
        } catch (err) {
            res.status(400).json({message: (err as Error).message});
        }
    });

    /** 向运行中的任务发送回复 */
    router.post('/:taskId/reply', async (req, res) => {
        const {message} = req.body;
        if (!message || typeof message !== 'string') {
            res.status(400).json({message: 'message is required'});
            return;
        }
        try {
            const result = await taskScheduler.sendReply(req.params.taskId, message);
            res.json({success: true, ...result});
        } catch (err) {
            res.status(400).json({message: (err as Error).message});
        }
    });

    /** 确认当前阶段（计划确认 / 执行确认） */
    router.post('/:taskId/confirm', async (req, res) => {
        try {
            await taskScheduler.confirmTask(req.params.taskId);
            res.json({success: true});
        } catch (err) {
            res.status(400).json({message: (err as Error).message});
        }
    });

    /** 删除任务 */
    router.delete('/:taskId', (req, res) => {
        const task = taskStore.getGlobal(req.params.taskId);
        if (!task) {
            res.status(404).json({message: 'Task not found'});
            return;
        }
        taskScheduler.removeTask(req.params.taskId);
        // 清理分支
        if (task.branch) {
            workspaceService.removeTaskBranch(task.workspacePath, task.baseBranch || 'main', task.branch).catch(() => {
            });
        }
        taskStore.delete(task.projectId, req.params.taskId);
        res.json({success: true});
    });

    // ==================== 调度器配置 ====================

    /** 获取调度器状态 */
    router.get('/scheduler/status', (_req, res) => {
        res.json({
            maxConcurrent: taskScheduler.getMaxConcurrent(),
            runningCount: taskScheduler.getRunningCount(),
            queueLength: taskScheduler.getQueueLength(),
        });
    });

    /** 设置最大并行数 */
    router.put('/scheduler/config', (req, res) => {
        const {maxConcurrent} = req.body;
        if (typeof maxConcurrent === 'number' && maxConcurrent >= 1) {
            taskScheduler.setMaxConcurrent(maxConcurrent);
            res.json({success: true, maxConcurrent});
        } else {
            res.status(400).json({message: 'maxConcurrent must be a number >= 1'});
        }
    });

    return router;
}
