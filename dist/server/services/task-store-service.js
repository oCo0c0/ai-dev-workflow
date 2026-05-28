"use strict";
/**
 * @module task-store-service
 * @description 任务持久化存储
 *
 * 任务存储在项目空间目录下: ~/.ai-dev-workbench/projects/{projectId}/tasks.json
 * 与 TaskScheduler 的内存状态配合，持久化用于服务重启恢复。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskStoreService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const constants_js_1 = require("../utils/constants.js");
const PROJECTS_DIR = path_1.default.join(constants_js_1.APP_DATA_DIR, 'projects');
class TaskStoreService {
    getTasksFile(projectId) {
        return path_1.default.join(PROJECTS_DIR, projectId, 'tasks.json');
    }
    ensureProjectDir(projectId) {
        const dir = path_1.default.join(PROJECTS_DIR, projectId);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
    }
    listAll() {
        const allTasks = [];
        try {
            const entries = fs_1.default.readdirSync(PROJECTS_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const tasks = this.listByProject(entry.name);
                    allTasks.push(...tasks);
                }
            }
        }
        catch { /* ignore */
        }
        return allTasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    listByProject(projectId) {
        const filePath = this.getTasksFile(projectId);
        try {
            const raw = fs_1.default.readFileSync(filePath, 'utf-8');
            const tasks = JSON.parse(raw);
            return tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }
        catch {
            return [];
        }
    }
    get(projectId, taskId) {
        const tasks = this.listByProject(projectId);
        return tasks.find(t => t.id === taskId);
    }
    getGlobal(taskId) {
        // 全局查找（遍历所有项目）
        try {
            const entries = fs_1.default.readdirSync(PROJECTS_DIR, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const tasks = this.listByProject(entry.name);
                    const found = tasks.find(t => t.id === taskId);
                    if (found)
                        return found;
                }
            }
        }
        catch { /* ignore */
        }
        return undefined;
    }
    upsert(projectId, task) {
        this.ensureProjectDir(projectId);
        const tasks = this.listByProject(projectId);
        const idx = tasks.findIndex(t => t.id === task.id);
        if (idx >= 0) {
            tasks[idx] = task;
        }
        else {
            tasks.push(task);
        }
        fs_1.default.writeFileSync(this.getTasksFile(projectId), JSON.stringify(tasks, null, 2), 'utf-8');
        return task;
    }
    create(projectId, input) {
        const task = {
            ...input,
            id: crypto_1.default.randomUUID(),
            logs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        return this.upsert(projectId, task);
    }
    delete(projectId, taskId) {
        const tasks = this.listByProject(projectId);
        const filtered = tasks.filter(t => t.id !== taskId);
        if (filtered.length === tasks.length)
            return false;
        fs_1.default.writeFileSync(this.getTasksFile(projectId), JSON.stringify(filtered, null, 2), 'utf-8');
        return true;
    }
}
exports.TaskStoreService = TaskStoreService;
//# sourceMappingURL=task-store-service.js.map