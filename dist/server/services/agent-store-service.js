"use strict";
/**
 * @file Agent执行存储服务
 * @description Agent执行持久化存储服务模块
 *
 * 管理Agent执行记录的持久化存储。
 * 每个执行存储在：agent-executions/{executionId}.json
 * 同时维护索引以支持快速查找。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentStoreService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const constants_js_1 = require("../utils/constants.js");
/** Agent执行存储目录 */
const AGENT_EXECUTIONS_DIR = path_1.default.join(constants_js_1.APP_DATA_DIR, 'agent-executions');
/**
 * Agent执行存储服务类
 *
 * 按执行ID存储：agent-executions/{executionId}.json
 */
class AgentStoreService {
    /** 获取执行文件路径 */
    executionFilePath(executionId) {
        return path_1.default.join(AGENT_EXECUTIONS_DIR, `${executionId}.json`);
    }
    /** 从文件读取执行记录 */
    readExecutionFile(executionId) {
        const filePath = this.executionFilePath(executionId);
        try {
            return JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        catch {
            return undefined;
        }
    }
    /** 写入执行记录到文件 */
    writeExecutionFile(execution) {
        const dir = AGENT_EXECUTIONS_DIR;
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(this.executionFilePath(execution.id), JSON.stringify(execution, null, 2), 'utf-8');
    }
    /**
     * 列出所有执行记录（按 updatedAt 倒序）
     */
    async list() {
        try {
            if (!fs_1.default.existsSync(AGENT_EXECUTIONS_DIR)) {
                return [];
            }
            const files = await fs_1.default.promises.readdir(AGENT_EXECUTIONS_DIR);
            const executions = [];
            // 并行读取所有执行文件
            const results = await Promise.all(files
                .filter(f => f.endsWith('.json'))
                .map(f => this.readExecutionFileAsync(f.replace('.json', ''))));
            for (const execution of results) {
                if (execution)
                    executions.push(execution);
            }
            return executions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        }
        catch {
            return [];
        }
    }
    /** 同步列表（仅fallback用） */
    listSync() {
        if (!fs_1.default.existsSync(AGENT_EXECUTIONS_DIR))
            return [];
        const executions = [];
        try {
            const files = fs_1.default.readdirSync(AGENT_EXECUTIONS_DIR);
            for (const file of files) {
                if (!file.endsWith('.json'))
                    continue;
                const executionId = file.replace('.json', '');
                const execution = this.readExecutionFile(executionId);
                if (execution)
                    executions.push(execution);
            }
        }
        catch { /* ignore */ }
        return executions;
    }
    async readExecutionFileAsync(executionId) {
        try {
            return JSON.parse(await fs_1.default.promises.readFile(this.executionFilePath(executionId), 'utf-8'));
        }
        catch {
            return undefined;
        }
    }
    /**
     * 根据执行ID获取记录
     */
    get(executionId) {
        return this.readExecutionFile(executionId);
    }
    /**
     * 根据Agent ID获取执行记录列表
     */
    getByAgent(agentId) {
        return this.listSync().filter(e => e.agentId === agentId);
    }
    /**
     * 根据任务ID获取执行记录列表
     */
    getByTask(taskId) {
        return this.listSync().filter(e => e.taskId === taskId);
    }
    /**
     * 创建或更新执行记录（自动填充 updatedAt）
     */
    upsert(execution) {
        const updated = {
            ...execution,
            updatedAt: execution.updatedAt ?? new Date().toISOString(),
        };
        this.writeExecutionFile(updated);
        return updated;
    }
    /**
     * 根据执行ID删除记录
     */
    delete(executionId) {
        const filePath = this.executionFilePath(executionId);
        if (!fs_1.default.existsSync(filePath))
            return false;
        fs_1.default.unlinkSync(filePath);
        return true;
    }
    /**
     * 清理旧执行记录（超过指定天数）
     */
    async cleanupOldExecutions(daysToKeep = 30) {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
        const executions = await this.list();
        let deletedCount = 0;
        for (const execution of executions) {
            const executionDate = new Date(execution.createdAt);
            if (executionDate < cutoffDate) {
                this.delete(execution.id);
                deletedCount++;
            }
        }
        return deletedCount;
    }
    /**
     * 获取统计信息
     */
    async getStats() {
        const executions = await this.list();
        const byStatus = {};
        const byAgent = {};
        for (const execution of executions) {
            // 按状态统计
            byStatus[execution.status] = (byStatus[execution.status] || 0) + 1;
            // 按Agent统计
            byAgent[execution.agentId] = (byAgent[execution.agentId] || 0) + 1;
        }
        return {
            total: executions.length,
            byStatus,
            byAgent
        };
    }
}
exports.AgentStoreService = AgentStoreService;
//# sourceMappingURL=agent-store-service.js.map