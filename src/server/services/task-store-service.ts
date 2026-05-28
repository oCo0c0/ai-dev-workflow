/**
 * @module task-store-service
 * @description 任务持久化存储
 *
 * 任务存储在项目空间目录下: ~/.ai-dev-workbench/projects/{projectId}/tasks.json
 * 与 TaskScheduler 的内存状态配合，持久化用于服务重启恢复。
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {APP_DATA_DIR} from '../utils/constants.js';
import type {TaskStatus, TaskPhase, TaskLog} from './task-scheduler-service.js';

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

const PROJECTS_DIR = path.join(APP_DATA_DIR, 'projects');

export class TaskStoreService {
    private getTasksFile(projectId: string): string {
        return path.join(PROJECTS_DIR, projectId, 'tasks.json');
    }

    private ensureProjectDir(projectId: string): void {
        const dir = path.join(PROJECTS_DIR, projectId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, {recursive: true});
        }
    }

    listAll(): PersistedTask[] {
        const allTasks: PersistedTask[] = [];
        try {
            const entries = fs.readdirSync(PROJECTS_DIR, {withFileTypes: true});
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const tasks = this.listByProject(entry.name);
                    allTasks.push(...tasks);
                }
            }
        } catch { /* ignore */
        }
        return allTasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    listByProject(projectId: string): PersistedTask[] {
        const filePath = this.getTasksFile(projectId);
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const tasks: PersistedTask[] = JSON.parse(raw);
            return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        } catch {
            return [];
        }
    }

    get(projectId: string, taskId: string): PersistedTask | undefined {
        const tasks = this.listByProject(projectId);
        return tasks.find(t => t.id === taskId);
    }

    getGlobal(taskId: string): PersistedTask | undefined {
        // 全局查找（遍历所有项目）
        try {
            const entries = fs.readdirSync(PROJECTS_DIR, {withFileTypes: true});
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const tasks = this.listByProject(entry.name);
                    const found = tasks.find(t => t.id === taskId);
                    if (found) return found;
                }
            }
        } catch { /* ignore */
        }
        return undefined;
    }

    upsert(projectId: string, task: PersistedTask): PersistedTask {
        this.ensureProjectDir(projectId);
        const tasks = this.listByProject(projectId);
        const idx = tasks.findIndex(t => t.id === task.id);
        if (idx >= 0) {
            tasks[idx] = task;
        } else {
            tasks.push(task);
        }
        fs.writeFileSync(
            this.getTasksFile(projectId),
            JSON.stringify(tasks, null, 2),
            'utf-8'
        );
        return task;
    }

    create(projectId: string, input: Omit<PersistedTask, 'id' | 'createdAt' | 'updatedAt' | 'logs'>): PersistedTask {
        const task: PersistedTask = {
            ...input,
            id: crypto.randomUUID(),
            logs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return this.upsert(projectId, task);
    }

    delete(projectId: string, taskId: string): boolean {
        const tasks = this.listByProject(projectId);
        const filtered = tasks.filter(t => t.id !== taskId);
        if (filtered.length === tasks.length) return false;
        fs.writeFileSync(
            this.getTasksFile(projectId),
            JSON.stringify(filtered, null, 2),
            'utf-8'
        );
        return true;
    }
}
