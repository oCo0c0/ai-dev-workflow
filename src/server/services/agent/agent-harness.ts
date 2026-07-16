/**
 * @file Agent Harness
 * @description Agent 执行器 - 核心 Agent 运行时系统
 *
 * 核心功能：
 * 1. Agent 生命周期管理 - 初始化、执行、清理
 * 2. 执行循环 - Think → Act → Observe → Reflect
 * 3. 状态管理 - 任务状态、执行历史、质量跟踪
 * 4. 协调服务 - 集成工具执行器、监控、错误恢复
 * 5. 前置/后置验证 - 确保执行正确性
 */

import {v4 as uuidv4} from 'uuid';
import {
    AgentConfig,
    Task,
    AgentResult,
    TaskState,
    ExecutionContext,
    Action,
    Result,
    ExecutionTrace,
    Reflection
} from './types.js';
import {ToolExecutorImpl, createToolExecutor} from './tool-executor.js';
import {AgentMonitorImpl, createAgentMonitor} from './agent-monitor.js';
import {ErrorRecoverySystem, createErrorRecoverySystem} from './error-recovery.js';
import {broadcast} from '../../websocket.js';

/**
 * Agent 思考接口
 */
interface Thought {
    /** 思考内容 */
    content: string;
    /** 下一步行动 */
    nextAction?: Action;
    /** 置信度 */
    confidence?: number;
}

/**
 * Agent 观察接口
 */
interface Observation {
    /** 观察到的结果 */
    result: Result;
    /** 质量评估 */
    quality: number;
    /** 是否需要改进 */
    needsImprovement: boolean;
}

/**
 * Agent 执行器实现
 */
export class AgentHarness {
    private toolExecutor: ToolExecutorImpl;
    private monitor: AgentMonitorImpl;
    private recovery: ErrorRecoverySystem;
    private agents: Map<string, AgentImplementation> = new Map();

    constructor() {
        this.toolExecutor = createToolExecutor();
        this.monitor = createAgentMonitor();
        this.recovery = createErrorRecoverySystem();
    }

    /**
     * 注册 Agent 实现
     */
    registerAgent(agent: AgentImplementation): void {
        this.agents.set(agent.config.id, agent);

        // 注册 Agent 的工具
        for (const tool of agent.config.tools) {
            const handler = agent.getToolHandler(tool.name);
            if (handler) {
                this.toolExecutor.registerTool({
                    ...tool,
                    handler
                });
            }
        }

        console.log(`[AgentHarness] Registered agent: ${agent.config.id} (${agent.config.name})`);
    }

    /**
     * 执行 Agent
     */
    async execute(agentId: string, task: Task): Promise<AgentResult> {
        const agent = this.agents.get(agentId);
        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
        }

        console.log(`[AgentHarness] Starting agent ${agentId} for task ${task.id}`);

        // 创建执行上下文
        const context = await this.createContext(agent.config, task);
        const trace = context.trace;

        try {
            // 前置验证
            this.validatePreconditions(agent.config, task);

            // 执行循环
            const result = await this.executeLoop(agent, context);

            // 后置验证
            this.validatePostconditions(result, task);

            // 完成监控
            this.monitor.complete(trace, result);

            return result;

        } catch (error) {
            // 错误处理
            this.monitor.error(trace, error as Error);

            const errorInfo = this.recovery.getErrorInfo(error as Error);
            const recovered = await this.recovery.recover(error as Error, context);

            if (!recovered) {
                // 无法恢复，返回失败结果
                const failedResult: AgentResult = {
                    success: false,
                    quality: 0,
                    iterations: context.state.iteration,
                    tokensUsed: context.state.tokensUsed,
                    duration: Date.now() - new Date(trace.startTime).getTime(),
                    trace,
                    error: errorInfo
                };

                this.monitor.complete(trace, failedResult);
                return failedResult;
            }

            // 恢复成功，继续执行
            return await this.execute(agentId, task);
        }
    }

    /**
     * 创建执行上下文
     */
    private async createContext(
        agentConfig: AgentConfig,
        task: Task
    ): Promise<ExecutionContext> {
        // 初始化任务状态
        const state: TaskState = {
            task,
            history: [],
            iteration: 0,
            quality: 0,
            tokensUsed: 0,
            phase: 'initialization',
            errorCount: 0,
            lastUpdate: new Date().toISOString()
        };

        // 启动监控
        const trace = this.monitor.start(agentConfig.id, task);

        return {
            agent: agentConfig,
            task,
            state,
            trace,
            tools: this.toolExecutor
        };
    }

    /**
     * 执行循环（Think → Act → Observe → Reflect）
     */
    private async executeLoop(
        agent: AgentImplementation,
        context: ExecutionContext
    ): Promise<AgentResult> {
        const {task, state, trace} = context;
        const startTime = Date.now();
        let shouldContinue = true;

        while (shouldContinue && !task.done) {
            state.iteration++;

            // 1. Think：Agent 思考下一步行动
            const thought = await this.think(agent, context);
            this.recordThink(trace, thought);

            // 广播思考过程到前端
            this.broadcastProgress(task.id, {
                type: 'think',
                iteration: state.iteration,
                content: thought.content,
                confidence: thought.confidence,
                nextAction: thought.nextAction?.type
            });

            // 2. Act：执行行动
            const action = thought.nextAction || await this.decideAction(agent, context);
            const result = await this.act(agent, context, action);
            state.tokensUsed += result.tokensUsed || 0;

            // 广播行动执行到前端
            this.broadcastProgress(task.id, {
                type: 'act',
                iteration: state.iteration,
                action: action.type,
                tool: action.tool,
                success: result.success
            });

            // 3. Observe：观察结果
            const observation = await this.observe(agent, context, result);
            this.recordObservation(trace, result, observation);

            // 广播观察结果到前端
            this.broadcastProgress(task.id, {
                type: 'observe',
                iteration: state.iteration,
                quality: observation.quality,
                needsImprovement: observation.needsImprovement
            });

            // 4. Reflect：反思并决定是否继续
            const reflection = await this.reflect(agent, context, observation);
            this.recordReflection(trace, reflection);

            // 广播反思过程到前端
            this.broadcastProgress(task.id, {
                type: 'reflect',
                iteration: state.iteration,
                content: reflection.content,
                quality: reflection.quality,
                improvements: reflection.improvements.length
            });

            // 更新状态
            state.quality = observation.quality;
            state.lastUpdate = new Date().toISOString();
            state.history.push({
                id: uuidv4(),
                timestamp: new Date().toISOString(),
                action,
                result,
                quality: observation.quality,
                tokensUsed: result.tokensUsed
            });

            // 决策：是否继续
            shouldContinue = await this.shouldContinue(agent, context, reflection);

            // 检查 Token 预算
            if (task.tokenBudget && state.tokensUsed >= task.tokenBudget) {
                console.log(`[AgentHarness] Token budget reached: ${state.tokensUsed}/${task.tokenBudget}`);
                break;
            }

            // 检查最大迭代次数
            const maxIterations = agent.config.maxExecutionTime ? 100 : 50;
            if (state.iteration >= maxIterations) {
                console.log(`[AgentHarness] Max iterations reached: ${state.iteration}`);
                break;
            }
        }

        // 返回最终结果
        return {
            success: state.quality >= (task.targetQuality || 0.8),
            data: state.history[state.history.length - 1]?.result.data,
            quality: state.quality,
            iterations: state.iteration,
            tokensUsed: state.tokensUsed,
            duration: Date.now() - startTime,
            trace
        };
    }

    /**
     * 广播Agent决策过程到前端
     */
    private broadcastProgress(taskId: string, data: {
        type: 'think' | 'act' | 'observe' | 'reflect';
        iteration: number;
        content?: string;
        confidence?: number;
        nextAction?: string;
        action?: string;
        tool?: string;
        success?: boolean;
        quality?: number;
        needsImprovement?: boolean;
        improvements?: number;
    }): void {
        broadcast({
            type: 'agent:progress',
            data: {
                taskId,
                ...data
            }
        });
    }

    /**
     * Think：Agent 思考
     */
    private async think(
        agent: AgentImplementation,
        context: ExecutionContext
    ): Promise<Thought> {
        const thought = await agent.think(context);
        this.monitor.record(context.trace, {
            type: 'think',
            timestamp: new Date().toISOString(),
            agentId: context.agent.id,
            taskId: context.task.id,
            data: {thought: thought.content, confidence: thought.confidence}
        });

        return thought;
    }

    /**
     * Act：执行行动
     */
    private async act(
        agent: AgentImplementation,
        context: ExecutionContext,
        action: Action
    ): Promise<Result> {
        this.monitor.record(context.trace, {
            type: 'action',
            timestamp: new Date().toISOString(),
            agentId: context.agent.id,
            taskId: context.task.id,
            data: {action}
        });

        try {
            let data: unknown;

            if (action.tool) {
                // 工具调用
                data = await context.tools.execute(action.tool, action.parameters);
            } else {
                // Agent 内部处理
                data = await agent.act(context, action);
            }

            return {
                success: true,
                data,
                metadata: {actionType: action.type}
            };

        } catch (error) {
            return {
                success: false,
                error: {
                    code: (error as Error).name || 'ACTION_ERROR',
                    message: (error as Error).message,
                    retryable: this.recovery.canRecover(error as Error)
                }
            };
        }
    }

    /**
     * Observe：观察结果
     */
    private async observe(
        agent: AgentImplementation,
        context: ExecutionContext,
        result: Result
    ): Promise<Observation> {
        const observation = await agent.observe(context, result);

        this.monitor.record(context.trace, {
            type: 'observe',
            timestamp: new Date().toISOString(),
            agentId: context.agent.id,
            taskId: context.task.id,
            data: {
                quality: observation.quality,
                needsImprovement: observation.needsImprovement
            }
        });

        return observation;
    }

    /**
     * Reflect：反思
     */
    private async reflect(
        agent: AgentImplementation,
        context: ExecutionContext,
        observation: Observation
    ): Promise<Reflection> {
        const reflection = await agent.reflect(context, observation);

        this.monitor.record(context.trace, {
            type: 'reflect',
            timestamp: reflection.timestamp,
            agentId: context.agent.id,
            taskId: context.task.id,
            data: {
                improvements: reflection.improvements,
                quality: reflection.quality
            }
        });

        return reflection;
    }

    /**
     * 决策：是否继续执行
     */
    private async shouldContinue(
        _agent: AgentImplementation,
        context: ExecutionContext,
        reflection: Reflection
    ): Promise<boolean> {
        // 检查质量是否达标
        const targetQuality = context.task.targetQuality || 0.8;
        if (reflection.quality >= targetQuality) {
            console.log(`[AgentHarness] Quality target reached: ${reflection.quality} >= ${targetQuality}`);
            context.task.done = true;
            return false;
        }

        // 检查是否有需要执行的改进
        const hasImprovements = reflection.improvements.some(imp => imp.priority === 'high');
        if (!hasImprovements && reflection.quality > 0.6) {
            console.log(`[AgentHarness] No critical improvements, current quality: ${reflection.quality}`);
            context.task.done = true;
            return false;
        }

        // 检查最大迭代次数
        const maxIterations = 50;
        if (context.state.iteration >= maxIterations) {
            console.log(`[AgentHarness] Max iterations reached`);
            return false;
        }

        return true;
    }

    /**
     * 决策下一步行动
     */
    private async decideAction(
        agent: AgentImplementation,
        context: ExecutionContext
    ): Promise<Action> {
        return await agent.decide(context);
    }

    /**
     * 记录思考
     */
    private recordThink(_trace: ExecutionTrace, _thought: Thought): void {
        // 思考已经在 think() 方法中通过 monitor.record() 记录
    }

    /**
     * 记录观察
     */
    private recordObservation(_trace: ExecutionTrace, _result: Result, _observation: Observation): void {
        // 观察已经在 observe() 方法中通过 monitor.record() 记录
    }

    /**
     * 记录反思
     */
    private recordReflection(_trace: ExecutionTrace, _reflection: Reflection): void {
        // 反思已经在 reflect() 方法中通过 monitor.record() 记录
    }

    /**
     * 前置验证
     */
    private validatePreconditions(agent: AgentConfig, task: Task): void {
        // 验证 Agent 配置
        if (!agent.id || !agent.name) {
            throw new Error('Invalid agent configuration: missing id or name');
        }

        if (!agent.tools || agent.tools.length === 0) {
            console.warn(`[AgentHarness] Agent ${agent.id} has no tools registered`);
        }

        // 验证任务配置
        if (!task.id || !task.type) {
            throw new Error('Invalid task: missing id or type');
        }

        console.log(`[AgentHarness] Preconditions validated for agent ${agent.id}`);
    }

    /**
     * 后置验证
     */
    private validatePostconditions(result: AgentResult, task: Task): void {
        // 验证结果
        if (!result.trace || !result.trace.id) {
            throw new Error('Invalid result: missing trace');
        }

        // 验证质量评分
        if (result.quality < 0 || result.quality > 1) {
            console.warn(`[AgentHarness] Invalid quality score: ${result.quality}`);
        }

        // 验证 Token 使用
        if (task.tokenBudget && result.tokensUsed > task.tokenBudget * 1.1) {
            console.warn(`[AgentHarness] Token budget exceeded: ${result.tokensUsed}/${task.tokenBudget}`);
        }

        console.log(`[AgentHarness] Postconditions validated, quality: ${result.quality}`);
    }

    /**
     * 获取监控统计
     */
    getStats(agentId?: string) {
        return this.monitor.getStats(agentId);
    }

    /**
     * 清理旧数据
     */
    cleanup(maxAge: number = 3600000): void {
        this.monitor.cleanup(maxAge);
    }
}

/**
 * Agent 实现接口
 */
export interface AgentImplementation {
    /** Agent 配置 */
    config: AgentConfig;

    /** 思考：分析当前状态并决定下一步 */
    think(context: ExecutionContext): Promise<Thought>;

    /** 行动：执行具体操作 */
    act(context: ExecutionContext, action: Action): Promise<unknown>;

    /** 观察：评估行动结果 */
    observe(context: ExecutionContext, result: Result): Promise<Observation>;

    /** 反思：总结经验并生成改进建议 */
    reflect(context: ExecutionContext, observation: Observation): Promise<Reflection>;

    /** 决策：选择下一步行动 */
    decide(context: ExecutionContext): Promise<Action>;

    /** 获取工具处理函数 */
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
}

/**
 * 创建 Agent 执行器实例
 */
export function createAgentHarness(): AgentHarness {
    return new AgentHarness();
}
