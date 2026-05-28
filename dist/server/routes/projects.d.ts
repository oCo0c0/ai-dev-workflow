/**
 * @module routes/tasks
 * @description 多任务管理 API 路由
 *
 * 任务以 SavedWorkspace ID 组织（替代独立的 ProjectSpace 实体）。
 * 提供：任务 CRUD、调度控制（启动/暂停/恢复/终止）、调度器配置。
 */
import { Router } from 'express';
import type { TaskStoreService } from '../services/task-store-service.js';
import type { TaskScheduler } from '../services/task-scheduler-service.js';
import type { WorkspaceService } from '../services/workspace-service.js';
export declare function createTaskRoutes(taskStore: TaskStoreService, taskScheduler: TaskScheduler, workspaceService: WorkspaceService): Router;
//# sourceMappingURL=projects.d.ts.map