"use strict";
/**
 * @file Agent Execution Store
 * @description Agent执行存储服务 - 管理Agent执行记录的持久化
 *
 * 功能：
 * - 按需求隔离存储（每个需求独立目录）
 * - 支持执行记录的CRUD操作
 * - 存储Agent思考过程、子任务状态、执行日志
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentExecutionStore = void 0;
exports.getAgentExecutionStore = getAgentExecutionStore;
const uuid_1 = require("uuid");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const constants_js_1 = require("../utils/constants.js");
/**
 * Agent执行存储服务
 */
class AgentExecutionStore {
    basePath;
    /** 每个 executionId 的写操作队列，串行化读-改-写避免并发覆盖/读到截断文件 */
    writeQueues = new Map();
    constructor() {
        this.basePath = (0, path_1.join)(constants_js_1.APP_DATA_DIR, 'agent-executions');
        if (!(0, fs_1.existsSync)(this.basePath)) {
            (0, promises_1.mkdir)(this.basePath, { recursive: true });
        }
    }
    /**
     * 把操作排入指定 executionId 的写队列，保证同一 execution 的写操作串行执行
     */
    async enqueue(executionId, task) {
        const prev = this.writeQueues.get(executionId) || Promise.resolve();
        const next = prev.then(() => task()).finally(() => {
            // 只在当前任务仍是队尾时清理，避免误删后续任务
            if (this.writeQueues.get(executionId) === next) {
                this.writeQueues.delete(executionId);
            }
        });
        this.writeQueues.set(executionId, next);
        return next;
    }
    /**
     * 获取执行记录的存储路径
     */
    getExecutionPath(executionId) {
        return (0, path_1.join)(this.basePath, `${executionId}.json`);
    }
    /**
     * 创建新执行记录
     */
    async create(data) {
        const now = new Date().toISOString();
        const execution = {
            id: (0, uuid_1.v4)(),
            ...data,
            subTasks: [],
            thoughts: [],
            logs: [],
            steps: [],
            createdAt: now,
            updatedAt: now,
        };
        await this.save(execution);
        return execution;
    }
    /**
     * 保存执行记录（直接写文件，调用方需自行入队或确保串行）
     */
    async save(execution) {
        const path = this.getExecutionPath(execution.id);
        const dir = (0, path_1.dirname)(path);
        if (!(0, fs_1.existsSync)(dir)) {
            await (0, promises_1.mkdir)(dir, { recursive: true });
        }
        execution.updatedAt = new Date().toISOString();
        await (0, promises_1.writeFile)(path, JSON.stringify(execution, null, 2), 'utf-8');
    }
    /**
     * 获取执行记录
     */
    async get(executionId) {
        const path = this.getExecutionPath(executionId);
        if (!(0, fs_1.existsSync)(path)) {
            return null;
        }
        try {
            const content = await (0, promises_1.readFile)(path, 'utf-8');
            return JSON.parse(content);
        }
        catch {
            return null;
        }
    }
    /**
     * 列出所有执行记录
     */
    async list() {
        if (!(0, fs_1.existsSync)(this.basePath)) {
            return [];
        }
        try {
            const files = await (0, promises_1.readdir)(this.basePath);
            const executions = [];
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                const path = (0, path_1.join)(this.basePath, file);
                try {
                    const content = await (0, promises_1.readFile)(path, 'utf-8');
                    const execution = JSON.parse(content);
                    const completedCount = execution.subTasks.filter(t => t.status === 'completed').length;
                    // 计算当前执行的步骤
                    const totalSteps = execution.steps.length || 5; // 默认5步
                    const currentStep = execution.steps.findIndex(s => s.status === 'running') + 1 ||
                        execution.steps.filter(s => s.status === 'completed').length + 1;
                    executions.push({
                        id: execution.id,
                        requirementId: execution.requirementId,
                        requirementNumber: execution.requirementNumber,
                        requirementTitle: execution.requirementTitle,
                        workspacePath: execution.workspacePath,
                        status: execution.status,
                        createdAt: execution.createdAt,
                        updatedAt: execution.updatedAt,
                        subTasksCount: execution.subTasks.length,
                        completedSubTasks: completedCount,
                        currentStep,
                        totalSteps,
                    });
                }
                catch {
                    // 跳过损坏的文件
                }
            }
            // 按创建时间倒序
            return executions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        catch {
            return [];
        }
    }
    /**
     * 删除执行记录
     */
    async delete(executionId) {
        const path = this.getExecutionPath(executionId);
        if (!(0, fs_1.existsSync)(path)) {
            return false;
        }
        try {
            // 在Windows上使用del模块，在Unix上使用unlink
            const { unlink } = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            await unlink(path);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 更新执行状态
     */
    async updateStatus(executionId, status) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.status = status;
            await this.save(execution);
        });
    }
    /**
     * 添加思考过程
     */
    async addThought(executionId, thought) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.thoughts.push(thought);
            await this.save(execution);
        });
    }
    /**
     * 添加日志
     */
    async addLog(executionId, log) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.logs.push(log);
            await this.save(execution);
        });
    }
    /**
     * 更新子任务状态
     */
    async updateSubTask(executionId, subTaskId, updates) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            const subTask = execution.subTasks.find(t => t.id === subTaskId);
            if (!subTask) {
                throw new Error(`SubTask not found: ${subTaskId}`);
            }
            Object.assign(subTask, updates);
            await this.save(execution);
        });
    }
    /**
     * 设置子任务列表
     */
    async setSubTasks(executionId, subTasks) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.subTasks = subTasks;
            await this.save(execution);
        });
    }
    /**
     * 添加单个子任务
     */
    async addSubTask(executionId, subTask) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.subTasks.push(subTask);
            await this.save(execution);
        });
    }
    /**
     * 更新执行步骤
     */
    async updateSteps(executionId, steps) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            execution.steps = steps;
            await this.save(execution);
        });
    }
    /**
     * 更新单个步骤
     */
    async updateStep(executionId, stepIndex, step) {
        return this.enqueue(executionId, async () => {
            const execution = await this.get(executionId);
            if (!execution) {
                throw new Error(`Execution not found: ${executionId}`);
            }
            if (!execution.steps[stepIndex]) {
                execution.steps[stepIndex] = step;
            }
            else {
                Object.assign(execution.steps[stepIndex], step);
            }
            await this.save(execution);
        });
    }
}
exports.AgentExecutionStore = AgentExecutionStore;
// 导出单例
let storeInstance = null;
function getAgentExecutionStore() {
    if (!storeInstance) {
        storeInstance = new AgentExecutionStore();
    }
    return storeInstance;
}
//# sourceMappingURL=agent-execution-store.js.map