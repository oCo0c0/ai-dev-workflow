/**
 * @file Agent Coordinator (重新实现)
 * @description Agent真正自主决策，不硬编码映射到Skill
 *
 * Agent = 自主决策的AI
 * - 能思考、规划
 * - 能调用工具（Claude/Skill/MCP）
 * - 能读写文件、运行命令
 * - 不是Skill的包装器
 */

import {v4 as uuidv4} from 'uuid';
import {getAgentExecutionStore, SubTask} from './agent-execution-store.js';
import {CLIRunnerService} from './cli-runner-service.js';
import {SkillsService} from './skills-service.js';
import {MCPBridgeService} from './mcp-bridge-service.js';
import {broadcast} from '../websocket.js';

/**
 * Agent协调器配置
 */
export interface CoordinatorConfig {
    cliRunner: CLIRunnerService;
    skillsService?: SkillsService;
    mcpBridgeService?: MCPBridgeService;
    workspacePath?: string;
}

/**
 * Agent协调器
 */
export class AgentCoordinator {
    private store = getAgentExecutionStore();
    private abortControllers = new Map<string, AbortController>();
    private config: CoordinatorConfig;

    constructor(config: CoordinatorConfig) {
        this.config = config;
    }

    /**
     * 分析需求 - Coordinator Agent思考
     */
    async analyzeRequirement(executionId: string): Promise<void> {
        const execution = await this.store.get(executionId);
        if (!execution) throw new Error(`Execution not found: ${executionId}`);

        const controller = new AbortController();
        this.abortControllers.set(executionId, controller);

        try {
            this.broadcastStatus(executionId, 'analyzing');

            const prompt = `你是Coordinator Agent（项目经理Agent）。
请分析以下需求并制定执行计划。

## 用户需求
${execution.requirementText}

## 你的职责

1. **需求分析**：理解用户要做什么
2. **任务拆解**：将需求拆解为具体的子任务
3. **Agent分配**：为每个子任务分配合适的Agent

## 可用的Agent类型

- **coordinator** - 协调Agent（统筹全局）
- **code-agent** - 代码Agent（写代码、改代码）
- **test-agent** - 测试Agent（写测试、跑测试）
- **review-agent** - 审查Agent（审查代码质量）
- **doc-agent** - 文档Agent（写文档）

## 输出格式

请先输出你的分析思考过程，然后输出JSON格式的任务列表：

\`\`\`json
[
  {
    "title": "需求分析",
    "description": "深入理解需求细节和技术要点",
    "agent": "coordinator",
    "order": 1
  },
  {
    "title": "代码实现",
    "description": "根据需求编写实现代码",
    "agent": "code-agent",
    "order": 2
  },
  {
    "title": "编写测试",
    "description": "编写单元测试和集成测试",
    "agent": "test-agent",
    "order": 3
  }
]
\`\`\`

请开始分析和规划：`;

            const cwd = execution.workspacePath || this.config.workspacePath || process.cwd();
            let accumulatedOutput = '';

            // 使用sessionId（如果有）以保持上下文
            const sessionId = execution.sessionId;
            const result = await this.config.cliRunner.runBridge(
                {prompt, cwd, sessionId, maxTurns: 1},
                {
                    workspacePath: cwd,
                    signal: controller.signal,
                    onOutput: (data: string) => {
                        accumulatedOutput += data;
                        this.store.addLog(executionId, data);
                        this.broadcastLog(executionId, data);
                    },
                }
            );

            // 解析子任务
            const subTasks = this.parseSubTasks(accumulatedOutput);
            await this.store.setSubTasks(executionId, subTasks);
            this.broadcastPlan(executionId, subTasks);

            await this.store.updateStatus(executionId, 'ready');
            this.broadcastStatus(executionId, 'ready');

        } catch (error) {
            if (controller.signal.aborted) {
                await this.store.updateStatus(executionId, 'aborted');
            } else {
                await this.store.updateStatus(executionId, 'failed');
                await this.store.addLog(executionId, `分析失败: ${(error as Error).message}`);
            }
        } finally {
            this.abortControllers.delete(executionId);
        }
    }

    /**
     * 执行任务 - 依次执行子任务
     */
    async execute(executionId: string): Promise<void> {
        const execution = await this.store.get(executionId);
        if (!execution) throw new Error(`Execution not found: ${executionId}`);
        if (execution.status !== 'ready') throw new Error(`Execution not ready: ${execution.status}`);

        const controller = new AbortController();
        this.abortControllers.set(executionId, controller);

        try {
            await this.store.updateStatus(executionId, 'running');
            this.broadcastStatus(executionId, 'running');

            for (const subTask of execution.subTasks) {
                if (controller.signal.aborted) throw new Error('Aborted');
                try {
                    await this.executeSubTask(executionId, subTask, controller.signal);
                } catch (error) {
                    console.error(`Subtask failed:`, error);
                }
            }

            await this.store.updateStatus(executionId, 'completed');
            this.broadcastComplete(executionId, 'completed');

        } catch (error) {
            if (controller.signal.aborted) {
                await this.store.updateStatus(executionId, 'aborted');
            } else {
                await this.store.updateStatus(executionId, 'failed');
            }
        } finally {
            this.abortControllers.delete(executionId);
        }
    }

    /**
     * 执行单个子任务 - 让Agent自己决定怎么做
     */
    private async executeSubTask(
        executionId: string,
        subTask: SubTask,
        signal?: AbortSignal
    ): Promise<void> {
        await this.store.updateSubTask(executionId, subTask.id, {
            status: 'running',
            startedAt: new Date().toISOString(),
        });

        this.broadcastSubTask(executionId, subTask.id, 'running');
        await this.store.addLog(executionId, `\n## ${subTask.order}. ${subTask.title}`);

        try {
            const execution = await this.store.get(executionId);
            if (!execution) throw new Error('Execution not found');

            const cwd = execution.workspacePath || this.config.workspacePath || process.cwd();

            // 构建Agent提示词 - 让Agent自己决定怎么做
            const agentPrompt = `你是${subTask.agent}。

## 你的任务
${subTask.title}
${subTask.description ? `详细说明：${subTask.description}` : ''}

## 原始需求
${execution.requirementText || ''}

## 可用工具
- **Claude API** - 直接生成代码/文本
- **Skills** - 如果需要，可以调用预定义工作流
- **MCP工具** - 可以读写文件、运行命令等

## 执行方式
你自己决定如何完成这个任务：
- 如果是简单任务，直接用Claude完成
- 如果需要文件操作，说明你要读写什么文件
- 如果复杂，可以分步骤说明

请开始执行：`;

            let accumulatedOutput = '';

            const result = await this.config.cliRunner.runBridge(
                {
                    prompt: agentPrompt,
                    cwd,
                    sessionId: `agent-task-${executionId}-${subTask.id}`,
                    maxTurns: 5,
                },
                {
                    workspacePath: cwd,
                    signal,
                    onOutput: (data: string) => {
                        accumulatedOutput += data;
                        this.store.addLog(executionId, data);
                        this.broadcastLog(executionId, data);
                    },
                }
            );

            await this.store.updateSubTask(executionId, subTask.id, {
                status: 'completed',
                completedAt: new Date().toISOString(),
                output: accumulatedOutput || 'Task completed',
            });

            this.broadcastSubTask(executionId, subTask.id, 'completed');
            await this.store.addLog(executionId, `✅ 完成: ${subTask.title}`);

        } catch (error) {
            await this.store.updateSubTask(executionId, subTask.id, {
                status: 'failed',
                completedAt: new Date().toISOString(),
                error: (error as Error).message,
            });

            this.broadcastSubTask(executionId, subTask.id, 'failed');
            await this.store.addLog(executionId, `❌ 失败: ${subTask.title}`);
            throw error;
        }
    }

    /**
     * 解析子任务
     */
    private parseSubTasks(output: string): SubTask[] {
        try {
            const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/) || output.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                const jsonStr = jsonMatch[1] || jsonMatch[0];
                const parsed = JSON.parse(jsonStr);
                if (Array.isArray(parsed)) {
                    return parsed.map((item, index) => ({
                        id: uuidv4(),
                        title: item.title || `Task ${index + 1}`,
                        description: item.description || '',
                        agent: item.agent || 'coordinator',
                        order: item.order || (index + 1),
                        status: 'pending' as const,
                    }));
                }
            }
        } catch {
        }

        // 默认任务
        return [{
            id: uuidv4(),
            title: '执行需求',
            description: output.substring(0, 200),
            agent: 'coordinator',
            order: 1,
            status: 'pending',
        }];
    }

    /**
     * 中止执行
     */
    abort(executionId: string): void {
        const controller = this.abortControllers.get(executionId);
        if (controller) controller.abort();
    }

    /**
     * 暂停执行
     */
    async pause(executionId: string): Promise<void> {
        await this.store.updateStatus(executionId, 'paused');
        this.broadcastStatus(executionId, 'paused');
    }

    /**
     * 继续执行
     */
    async resume(executionId: string): Promise<void> {
        await this.store.updateStatus(executionId, 'running');
        this.broadcastStatus(executionId, 'running');
        this.execute(executionId).catch(console.error);
    }

    /**
     * WebSocket广播
     */
    private broadcastStatus(executionId: string, status: string): void {
        broadcast({type: 'agent-execution:status', data: {executionId, status}});
    }

    private broadcastSubTask(executionId: string, subTaskId: string, status: string): void {
        broadcast({type: 'agent-execution:subtask', data: {executionId, subTaskId, status}});
    }

    private broadcastPlan(executionId: string, subTasks: SubTask[]): void {
        broadcast({type: 'agent-execution:plan', data: {executionId, subTasks}});
    }

    private broadcastComplete(executionId: string, status: string): void {
        broadcast({type: 'agent-execution:complete', data: {executionId, status}});
    }

    private broadcastLog(executionId: string, log: string): void {
        broadcast({type: 'agent-execution:log', data: {executionId, log}});
    }
}

export function createAgentCoordinator(config: CoordinatorConfig): AgentCoordinator {
    return new AgentCoordinator(config);
}
