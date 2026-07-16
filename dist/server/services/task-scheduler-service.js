"use strict";
/**
 * @module task-scheduler-service
 * @description 任务调度器 — Coordinator 模式实现
 *
 * 管理多个并行任务，每个任务拥有独立的 Claude Bridge 子进程。
 * 借鉴 Claude Code 的 Coordinator 模式：
 * - 每个 Task 对应一个独立的 CLIProvider 实例（独立子进程）
 * - 最大并行数控制，超出排队
 * - 任务完成自动启动排队中的下一个
 * - 内部编排完整流水线：Plan → Execution → Test
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskScheduler = void 0;
const claude_provider_js_1 = require("./cli-providers/claude-provider.js");
const error_utils_js_1 = require("../utils/error-utils.js");
const prompt_enrichment_js_1 = require("../utils/prompt-enrichment.js");
const skill_utils_js_1 = require("../utils/skill-utils.js");
const mcp_config_service_js_1 = require("./mcp-config-service.js");
const websocket_js_1 = require("../websocket.js");
/** 计划生成 prompt 模板 */
const PLAN_PROMPT_TEMPLATE = `Analyze the following requirement and generate a structured development plan.\n\n## Requirement\n{title}\n\n{description}\n\n## Instructions\nGenerate a development plan. Respond in the same language as the requirement.`;
// === 调度器 ===
class TaskScheduler {
    running = new Map();
    queue = [];
    tasks = new Map();
    maxConcurrent;
    deps = null;
    /** MCP 配置服务（无状态，按名解析为 stdio 配置注入执行阶段） */
    mcpConfigService = new mcp_config_service_js_1.MCPConfigService();
    /** 持久化回调：状态变更时同步写入磁盘 */
    onPersist;
    /** 确认等待：taskId → resolve 回调 */
    confirmationResolvers = new Map();
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
    }
    /** 注入流水线依赖 */
    setDependencies(deps) {
        this.deps = deps;
    }
    // === 基础访问 ===
    getMaxConcurrent() { return this.maxConcurrent; }
    setMaxConcurrent(n) { this.maxConcurrent = Math.max(1, n); }
    getRunningCount() { return this.running.size; }
    getQueueLength() { return this.queue.length; }
    registerTask(task) { this.tasks.set(task.id, task); }
    getTask(taskId) { return this.tasks.get(taskId); }
    /**
     * 启动任务（如果达到并行上限则排队，否则直接执行完整流水线）
     */
    async startTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error(`Task not found: ${taskId}`);
        if (task.status === 'running')
            throw new Error(`Task already running: ${taskId}`);
        // 检查依赖是否都已完成
        const pendingDeps = task.dependsOn.filter(depId => {
            const dep = this.tasks.get(depId);
            return !dep || dep.status !== 'completed';
        });
        if (pendingDeps.length > 0) {
            // 有未完成依赖，标记为 pending 等待
            task.status = 'pending';
            task.updatedAt = new Date().toISOString();
            this.addLog(taskId, 'idle', 'info', `等待前置任务完成: ${pendingDeps.join(', ')}`);
            this.notifyUpdate(task);
            return;
        }
        // 无依赖或依赖全部完成，加入执行队列
        if (this.running.size >= this.maxConcurrent) {
            task.status = 'queued';
            task.updatedAt = new Date().toISOString();
            this.queue.push(taskId);
            this.notifyUpdate(task);
            return;
        }
        await this.executeTask(taskId);
    }
    async pauseTask(taskId) {
        const running = this.running.get(taskId);
        if (!running)
            throw new Error(`Task not running: ${taskId}`);
        running.abortController.abort();
        running.task.status = 'paused';
        running.task.updatedAt = new Date().toISOString();
        this.notifyUpdate(running.task);
    }
    async resumeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'paused')
            throw new Error(`Task not paused: ${taskId}`);
        if (this.running.size >= this.maxConcurrent) {
            task.status = 'queued';
            task.updatedAt = new Date().toISOString();
            this.queue.push(taskId);
            this.notifyUpdate(task);
            return;
        }
        await this.executeTask(taskId);
    }
    async abortTask(taskId) {
        const running = this.running.get(taskId);
        if (running) {
            running.abortController.abort();
            await running.provider.dispose().catch(() => { });
            this.running.delete(taskId);
        }
        const queueIdx = this.queue.indexOf(taskId);
        if (queueIdx >= 0)
            this.queue.splice(queueIdx, 1);
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'aborted';
            task.updatedAt = new Date().toISOString();
            this.notifyUpdate(task);
        }
        this.processQueue();
    }
    removeTask(taskId) {
        const running = this.running.get(taskId);
        if (running) {
            running.abortController.abort();
            running.provider.dispose().catch(() => { });
            this.running.delete(taskId);
        }
        this.tasks.delete(taskId);
        const queueIdx = this.queue.indexOf(taskId);
        if (queueIdx >= 0)
            this.queue.splice(queueIdx, 1);
    }
    /**
     * 向运行中的任务发送对话（多轮回复）
     */
    async sendReply(taskId, message) {
        const running = this.running.get(taskId);
        if (!running)
            throw new Error(`Task not running: ${taskId}`);
        if (!running.task.sessionId)
            throw new Error(`Task has no session: ${taskId}`);
        return running.provider.run({ prompt: message, sessionId: running.task.sessionId, maxTurns: 30 }, {
            signal: running.abortController.signal,
            onOutput: (data) => this.addLog(taskId, running.task.phase, 'output', data),
            onError: (data) => this.addLog(taskId, running.task.phase, 'error', data),
        });
    }
    updateTaskState(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (task) {
            Object.assign(task, updates, { updatedAt: new Date().toISOString() });
            this.notifyUpdate(task);
        }
    }
    /**
     * 用户确认当前阶段，推进流水线
     */
    async confirmTask(taskId) {
        const resolver = this.confirmationResolvers.get(taskId);
        if (!resolver)
            throw new Error(`No pending confirmation for task: ${taskId}`);
        this.confirmationResolvers.delete(taskId);
        resolver();
    }
    /**
     * 等待用户确认（可被 abort 中断）
     */
    waitForConfirmation(taskId, signal) {
        return new Promise((resolve, reject) => {
            this.confirmationResolvers.set(taskId, resolve);
            const onAbort = () => {
                this.confirmationResolvers.delete(taskId);
                reject(new Error('Aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
        });
    }
    // === 内部：任务执行 + 流水线编排 ===
    /**
     * 启动独立 provider 进程，然后编排完整流水线
     */
    async executeTask(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        if (!this.deps) {
            task.status = 'failed';
            task.updatedAt = new Date().toISOString();
            this.addLog(taskId, 'idle', 'error', 'Pipeline dependencies not configured');
            this.notifyUpdate(task);
            return;
        }
        const provider = new claude_provider_js_1.ClaudeProvider();
        const abortController = new AbortController();
        task.status = 'running';
        task.updatedAt = new Date().toISOString();
        this.running.set(taskId, { task, provider, abortController });
        this.notifyUpdate(task);
        try {
            await provider.initialize();
            this.addLog(taskId, 'idle', 'info', 'Bridge 进程启动成功');
        }
        catch (err) {
            task.status = 'failed';
            task.updatedAt = new Date().toISOString();
            this.addLog(taskId, task.phase, 'error', `Bridge 进程启动失败: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            this.running.delete(taskId);
            this.notifyUpdate(task);
            this.processQueue();
            return;
        }
        // 编排完整流水线
        try {
            await this.runPipeline(taskId, provider, abortController.signal);
            task.status = 'completed';
        }
        catch (err) {
            if (abortController.signal.aborted) {
                task.status = 'aborted';
            }
            else {
                task.status = 'failed';
                this.addLog(taskId, task.phase, 'error', `Pipeline failed: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            }
        }
        finally {
            task.updatedAt = new Date().toISOString();
            await provider.dispose().catch(() => { });
            this.running.delete(taskId);
            this.notifyUpdate(task);
            // 任务成功完成：stash 代码并触发依赖任务
            if (task.status === 'completed' && this.deps?.workspaceService) {
                await this.stashAndTriggerDependents(taskId);
            }
            this.processQueue();
        }
    }
    /**
     * 任务完成后 stash 代码，如果有依赖任务则合并到 base 后触发
     */
    async stashAndTriggerDependents(completedTaskId) {
        const task = this.tasks.get(completedTaskId);
        if (!task || !this.deps?.workspaceService)
            return;
        // 先 stash 代码（按需求号标记）
        try {
            await this.deps.workspaceService.stashTaskChanges(task.workspacePath, task.name || task.requirementId);
            this.addLog(completedTaskId, task.phase, 'info', `代码已 stash: ${task.name || task.requirementId}`);
        }
        catch (err) {
            this.addLog(completedTaskId, task.phase, 'warning', `Stash 失败: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
        }
        // 查找依赖此任务的后继任务
        const hasDependents = Array.from(this.tasks.values()).some(t => (t.status === 'pending' || t.status === 'queued') && t.dependsOn.includes(completedTaskId));
        // 如果有后继任务，需要合并分支到 base（让后继任务基于最新代码）
        if (hasDependents) {
            try {
                const baseBranch = task.baseBranch || 'main';
                await this.deps.workspaceService.mergeBranchToBase(task.workspacePath, task.branch, baseBranch);
                this.addLog(completedTaskId, task.phase, 'info', `分支 ${task.branch} 已合并到 ${baseBranch}（存在依赖任务）`);
            }
            catch (err) {
                this.addLog(completedTaskId, task.phase, 'warning', `合并失败（依赖任务可能基于旧 base）: ${(0, error_utils_js_1.getErrorMessage)(err)}`);
            }
        }
        // 触发等待的后继任务
        for (const [id, t] of this.tasks) {
            if (t.status !== 'pending' && t.status !== 'queued')
                continue;
            if (!t.dependsOn.includes(completedTaskId))
                continue;
            const allDepsMet = t.dependsOn.every(depId => {
                const dep = this.tasks.get(depId);
                return dep?.status === 'completed';
            });
            if (allDepsMet) {
                this.addLog(id, 'idle', 'info', `所有前置任务完成，开始执行...`);
                if (this.running.size < this.maxConcurrent) {
                    this.executeTask(id).catch(() => { });
                }
                else {
                    t.status = 'queued';
                    t.updatedAt = new Date().toISOString();
                    this.queue.push(id);
                    this.notifyUpdate(t);
                }
            }
        }
    }
    /**
     * 内部编排完整流水线：Plan → Execution → Test
     * 同一个 provider/session 贯穿全流程
     */
    async runPipeline(taskId, provider, signal) {
        const task = this.tasks.get(taskId);
        if (!task || !this.deps)
            return;
        const { requirementStore, mcpBridgeService, pipelineService, memoryService } = this.deps;
        // 直接使用项目目录（不使用 worktree）
        const cwd = task.workspacePath;
        // --- Phase 1: Plan ---
        this.updateTaskState(taskId, { phase: 'plan' });
        this.addLog(taskId, 'plan', 'info', '开始生成开发计划...');
        // 获取需求内容
        const { title, description } = await this.getRequirementContent(task.requirementId, requirementStore, mcpBridgeService);
        const promptText = PLAN_PROMPT_TEMPLATE
            .replace('{title}', title)
            .replace('{description}', description);
        const planSkills = (0, skill_utils_js_1.getPhaseSkills)(pipelineService.get(task.pipelineId)?.steps ?? {}, 'plan');
        const { map: planMcpServers, missing: planMcpMissing } = (0, skill_utils_js_1.resolveMcpServerMap)((0, skill_utils_js_1.getPhaseMcpServers)(pipelineService.get(task.pipelineId)?.steps ?? {}, 'plan'), this.mcpConfigService);
        if (planMcpMissing.length > 0) {
            this.addLog(taskId, 'plan', 'warning', `MCP servers not found, skipped: ${planMcpMissing.join(', ')}`);
        }
        const planPrompt = (0, prompt_enrichment_js_1.enrichPrompt)(promptText, memoryService, cwd);
        let planOutput = '';
        // ponytail: 过滤掉Agent模式
        const filteredPlanSkills = (planSkills && typeof planSkills === 'object' && 'mode' in planSkills && planSkills.mode === 'agent')
            ? undefined
            : planSkills;
        const planResult = await provider.run({
            prompt: planPrompt,
            cwd: cwd,
            maxTurns: 20,
            skills: filteredPlanSkills,
            mcpServers: planMcpServers,
        }, {
            signal,
            onOutput: (data) => {
                planOutput += data;
                this.addLog(taskId, 'plan', 'output', data);
                (0, websocket_js_1.broadcast)({ type: 'plan:progress', data: { taskId, content: data } });
            },
        });
        if (planResult.sessionId)
            task.sessionId = planResult.sessionId;
        if (planResult.exitCode !== 0) {
            throw new Error(`Plan generation failed: ${planResult.stderr || 'exit code ' + planResult.exitCode}`);
        }
        this.addLog(taskId, 'plan', 'info', '计划生成完成，等待用户确认...');
        // --- 暂停：等待用户确认计划 ---
        this.updateTaskState(taskId, { phase: 'waiting_plan_confirm' });
        (0, websocket_js_1.broadcast)({ type: 'plan:waiting_confirm', data: { taskId } });
        await this.waitForConfirmation(taskId, signal);
        // --- Phase 2: Execution ---
        this.updateTaskState(taskId, { phase: 'execution' });
        this.addLog(taskId, 'execution', 'info', '用户已确认，开始执行...');
        const executionSkills = (0, skill_utils_js_1.getPhaseSkills)(pipelineService.get(task.pipelineId)?.steps ?? {}, 'execution');
        const { map: executionMcpServers, missing: executionMcpMissing } = (0, skill_utils_js_1.resolveMcpServerMap)((0, skill_utils_js_1.getPhaseMcpServers)(pipelineService.get(task.pipelineId)?.steps ?? {}, 'execution'), this.mcpConfigService);
        if (executionMcpMissing.length > 0) {
            this.addLog(taskId, 'execution', 'warning', `MCP servers not found, skipped: ${executionMcpMissing.join(', ')}`);
        }
        const executionPrompt = (0, prompt_enrichment_js_1.enrichPrompt)(planOutput, memoryService, cwd);
        // ponytail: 过滤掉Agent模式
        const filteredExecutionSkills = (executionSkills && typeof executionSkills === 'object' && 'mode' in executionSkills && executionSkills.mode === 'agent')
            ? undefined
            : executionSkills;
        const execResult = await provider.run({
            prompt: executionPrompt,
            cwd: cwd,
            sessionId: task.sessionId,
            maxTurns: 50,
            skills: filteredExecutionSkills,
            mcpServers: executionMcpServers,
        }, {
            signal,
            onOutput: (data) => {
                this.addLog(taskId, 'execution', 'output', data);
                (0, websocket_js_1.broadcast)({ type: 'execution:output', data: { taskId, content: data } });
            },
        });
        if (execResult.sessionId)
            task.sessionId = execResult.sessionId;
        if (execResult.aborted)
            throw new Error('Aborted');
        if (execResult.exitCode !== 0) {
            throw new Error(`Execution failed: exit code ${execResult.exitCode}`);
        }
        this.addLog(taskId, 'execution', 'info', '执行完成，等待用户确认...');
        (0, websocket_js_1.broadcast)({ type: 'execution:complete', data: { taskId, status: 'completed' } });
        // --- 暂停：等待用户确认执行结果 ---
        this.updateTaskState(taskId, { phase: 'waiting_execution_confirm' });
        (0, websocket_js_1.broadcast)({ type: 'execution:waiting_confirm', data: { taskId } });
        await this.waitForConfirmation(taskId, signal);
        // --- Phase 3: Test（如果配置了自动测试） ---
        const pipeline = pipelineService.get(task.pipelineId);
        const testStrategy = pipeline?.steps?.testStrategy;
        if (testStrategy?.autoRunAfterExecution) {
            this.updateTaskState(taskId, { phase: 'test' });
            this.addLog(taskId, 'test', 'info', '自动测试已配置，但多任务模式下暂不支持独立测试阶段。');
            // 测试阶段需要 TestExecutorService 等更多依赖，后续迭代补充
        }
    }
    /**
     * 获取需求内容（本地 store 优先，fallback MCP）
     */
    async getRequirementContent(requirementId, reqStore, mcpBridgeService) {
        const saved = reqStore.get(requirementId);
        if (saved)
            return { title: saved.title, description: saved.description };
        const detail = await mcpBridgeService.fetchRequirementDetail(requirementId);
        return { title: detail.title, description: detail.description };
    }
    // === 内部工具 ===
    processQueue() {
        while (this.queue.length > 0 && this.running.size < this.maxConcurrent) {
            const nextId = this.queue.shift();
            this.executeTask(nextId).catch(() => { });
        }
    }
    addLog(taskId, phase, logType, content) {
        const task = this.tasks.get(taskId);
        if (!task)
            return;
        const log = { timestamp: new Date().toISOString(), phase, logType, content };
        task.logs.push(log);
        (0, websocket_js_1.broadcast)({ type: 'task:log', data: { taskId, log: { timestamp: log.timestamp, phase, logType, content } } });
    }
    notifyUpdate(task) {
        (0, websocket_js_1.broadcast)({
            type: 'task:status_change',
            data: { taskId: task.id, status: task.status, phase: task.phase },
        });
        this.onPersist?.(task);
    }
    async dispose() {
        for (const [, running] of this.running) {
            running.abortController.abort();
            await running.provider.dispose().catch(() => { });
        }
        this.running.clear();
        this.queue.length = 0;
        this.confirmationResolvers.clear();
    }
}
exports.TaskScheduler = TaskScheduler;
//# sourceMappingURL=task-scheduler-service.js.map