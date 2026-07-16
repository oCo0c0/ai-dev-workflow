/**
 * @file 协调Agent（CoordinatorAgent）
 * @description 项目经理Agent，负责分析需求、规划步骤、协调执行
 *
 * 核心职责：
 * 1. 需求分析 → 理解用户要做什么
 * 2. 任务规划 → 决定需要哪些Agent、按什么顺序执行
 * 3. 协调执行 → 调用专业Agent、处理异常、用户交互
 * 4. 结果整合 → 汇总各Agent成果、返回最终结果
 */

import { getAgentRegistry } from './agent-capability.js';
import { AgentsService } from './agents-service.js';
import { broadcast } from '../../websocket.js';

/**
 * 添加Agent日志（简化版）
 */
function addAgentLog(message: string): void {
    console.log(`[Agent] ${message}`);
}

/**
 * 执行步骤
 */
export interface ExecutionStep {
    /** 步骤序号 */
    order: number;
    /** Agent ID */
    agentId: string;
    /** Agent名称 */
    agentName: string;
    /** 为什么需要这个Agent */
    reasoning: string;
    /** 置信度 */
    confidence: number;
    /** 依赖的前置步骤序号 */
    dependencies: number[];
    /** 状态 */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    /** 执行结果 */
    result?: any;
    /** 错误信息 */
    error?: string;
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
    /** 计划ID */
    planId: string;
    /** 需求描述 */
    requirement: string;
    /** 工作区路径 */
    workspace: string;
    /** 执行步骤 */
    steps: ExecutionStep[];
    /** 总体策略说明 */
    strategy: string;
    /** 预估token消耗 */
    estimatedTokens: number;
    /** 暂停请求标志 */
    pauseRequested?: boolean;
    /** 用户问题队列 */
    userQuestions?: Array<{question: string; answer?: string}>;
}

/**
 * 执行结果
 */
export interface CoordinatorResult {
    /** 是否成功 */
    success: boolean;
    /** 执行计划 */
    plan: ExecutionPlan;
    /** 最终结果 */
    finalResult?: any;
    /** 总耗时 */
    totalDuration: number;
    /** 总token消耗 */
    totalTokens: number;
    /** 错误信息 */
    errors: string[];
}

/**
 * 协调Agent配置
 */
export interface CoordinatorConfig {
    /** 是否允许用户交互（遇到问题时询问） */
    allowUserInteraction?: boolean;
    /** 超时时间（毫秒） */
    timeout?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 进度回调 */
    onProgress?: (step: ExecutionStep, plan: ExecutionPlan) => void;
    /** 用户问题回调 */
    onUserQuestion?: (question: string) => Promise<string>;
}

/**
 * 协调Agent
 */
export class CoordinatorAgent {
    private agentsService: AgentsService;
    private config: CoordinatorConfig;

    constructor(
        agentsService?: AgentsService,
        config: CoordinatorConfig = {}
    ) {
        this.agentsService = agentsService || new AgentsService();
        this.config = {
            allowUserInteraction: true,
            timeout: 300000, // 5分钟
            maxRetries: 3,
            ...config
        };
    }

    /**
     * 执行任务（主入口）
     * @param requirement 需求描述
     * @param workspace 工作区路径
     * @param context 额外上下文
     * @param options 执行选项
     */
    async execute(
        requirement: string,
        workspace: string,
        context: any = {},
        options: { planOnly?: boolean; skipConfirmation?: boolean } = {}
    ): Promise<CoordinatorResult> {
        const startTime = Date.now();
        const errors: string[] = [];

        try {
            // 1. 分析需求，制定执行计划
            const plan = await this.plan(requirement, workspace, context);

            // 如果只生成计划，直接返回
            if (options.planOnly) {
                return {
                    success: true,
                    plan,
                    totalDuration: Date.now() - startTime,
                    totalTokens: 0,
                    errors: []
                };
            }

            // 2. 执行计划
            const executionResult = await this.executePlan(plan, context);

            return {
                success: executionResult.success,
                plan,
                finalResult: executionResult.finalResult,
                totalDuration: Date.now() - startTime,
                totalTokens: executionResult.totalTokens,
                errors: executionResult.errors
            };
        } catch (error) {
            return {
                success: false,
                plan: this.createEmptyPlan(requirement, workspace),
                totalDuration: Date.now() - startTime,
                totalTokens: 0,
                errors: [error instanceof Error ? error.message : 'Unknown error']
            };
        }
    }

    /**
     * 制定执行计划
     */
    private async plan(
        requirement: string,
        workspace: string,
        context: any
    ): Promise<ExecutionPlan> {
        // 分析需求，提取关键任务
        const tasks = this.analyzeRequirement(requirement);

        // 为每个任务选择最佳Agent
        const steps: ExecutionStep[] = [];
        let estimatedTokens = 0;

        tasks.forEach((task, index) => {
            const selection = getAgentRegistry().selectBestAgent(task.description, context);

            if (selection) {
                steps.push({
                    order: index + 1,
                    agentId: selection.agentId,
                    agentName: selection.agentName,
                    reasoning: selection.reasoning,
                    confidence: selection.confidence,
                    dependencies: task.dependencies || [],
                    status: 'pending'
                });
                estimatedTokens += 10000; // 粗略估算
            } else {
                // 没有合适的Agent，标记为需要用户介入
                console.warn(`No suitable agent found for task: ${task.description}`);
            }
        });

        return {
            planId: `plan-${Date.now()}`,
            requirement,
            workspace,
            steps,
            strategy: this.generateStrategy(steps),
            estimatedTokens
        };
    }

    /**
     * 分析需求，提取关键任务
     */
    private analyzeRequirement(requirement: string): Array<{description: string; dependencies?: number[]}> {
        const tasks: Array<{description: string; dependencies?: number[]}> = [];

        // 简单的关键词匹配（未来可以用LLM分析）
        const keywords = {
            '需求分析': ['需求', '分析', '理解', '明确'],
            '代码生成': ['实现', '开发', '生成代码', '编写'],
            '测试': ['测试', '验证', '检查'],
            '代码审查': ['审查', 'review', '优化'],
            '文档': ['文档', '说明', '注释']
        };

        // 检测任务类型
        for (const [taskType, taskKeywords] of Object.entries(keywords)) {
            const hasKeyword = taskKeywords.some(kw => requirement.includes(kw));
            if (hasKeyword) {
                tasks.push({ description: taskType });
            }
        }

        // 如果没有检测到具体任务，添加默认流程
        if (tasks.length === 0) {
            tasks.push(
                { description: '需求分析' },
                { description: '代码生成', dependencies: [0] },
                { description: '测试', dependencies: [1] }
            );
        }

        return tasks;
    }

    /**
     * 生成策略说明
     */
    private generateStrategy(steps: ExecutionStep[]): string {
        if (steps.length === 0) {
            return '暂无可用Agent处理此需求';
        }

        const stepDescriptions = steps.map(step =>
            `${step.order}. ${step.agentName}（${step.reasoning}）`
        ).join('\n');

        return `执行策略：\n${stepDescriptions}`;
    }

    /**
     * 执行计划
     */
    private async executePlan(
        plan: ExecutionPlan,
        context: any
    ): Promise<{success: boolean; finalResult?: any; totalTokens: number; errors: string[]}> {
        const errors: string[] = [];
        let finalResult: any = {};
        let totalTokens = 0;

        // 按顺序执行步骤
        for (const step of plan.steps) {
            // 检查是否暂停请求
            if (plan.pauseRequested) {
                // 保存当前状态并返回
                return {
                    success: false,
                    finalResult: {paused: true, currentStep: step.order},
                    totalTokens,
                    errors: ['执行已暂停']
                };
            }

            // 检查依赖是否满足
            const dependenciesMet = this.checkDependencies(step, plan);
            if (!dependenciesMet) {
                step.status = 'skipped';
                continue;
            }

            try {
                step.status = 'running';

                // 通知进度
                if (this.config.onProgress) {
                    this.config.onProgress(step, plan);
                }

                // 准备输入数据（使用前面步骤的结果）
                const inputData = this.prepareInputData(step, plan, context);

                // 调用Agent
                const result = await this.agentsService.executeAgent({
                    agentType: step.agentId as any,
                    taskId: `${plan.planId}-step${step.order}`,
                    inputData,
                    options: {
                        targetQuality: 0.8,
                        tokenBudget: 10000,
                        priority: 'medium'
                    }
                });

                step.result = result.result;
                totalTokens += result.tokensUsed;

                if (result.success) {
                    step.status = 'completed';

                    // 检查是否需要用户交互（如果Agent返回了userQuestion字段）
                    if ((result.result as any)?.userQuestion && this.config.allowUserInteraction) {
                        const question = (result.result as any).userQuestion || '请提供更多信息';
                        const answer = await this.askUser(question, plan);
                        if (answer === '[SKIP]') {
                            addAgentLog(`用户跳过问题: ${question}`);
                        } else {
                            // 将用户回答添加到上下文中
                            context.userAnswer = answer;
                            addAgentLog(`用户回答: ${answer}`);
                        }
                    }

                    // 通知步骤完成
                    if (this.config.onProgress) {
                        this.config.onProgress(step, plan);
                    }
                } else {
                    step.status = 'failed';
                    step.error = result.error;
                    errors.push(`步骤${step.order}失败: ${result.error}`);

                    // 如果是关键步骤失败，终止执行
                    if (this.isCriticalStep(step)) {
                        break;
                    }
                }
            } catch (error) {
                step.status = 'failed';
                step.error = error instanceof Error ? error.message : 'Unknown error';
                errors.push(`步骤${step.order}异常: ${step.error}`);

                if (this.isCriticalStep(step)) {
                    break;
                }
            }
        }

        // 汇总结果
        finalResult = this.aggregateResults(plan);

        return {
            success: errors.length === 0,
            finalResult,
            totalTokens,
            errors
        };
    }

    /**
     * 向用户提问并等待回答
     */
    private async askUser(question: string, plan: ExecutionPlan): Promise<string> {
        // 初始化问题队列
        if (!plan.userQuestions) {
            plan.userQuestions = [];
        }

        // 添加问题到队列
        plan.userQuestions.push({question, answer: undefined});

        // 广播问题给前端
        broadcast({
            type: 'agent:question',
            data: {
                executionId: plan.planId,
                question
            }
        });

        // 等待回答（通过外部设置answer）
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const q = plan.userQuestions?.find(q => q.question === question);
                if (q && q.answer !== undefined) {
                    clearInterval(checkInterval);
                    resolve(q.answer);
                }
            }, 500);
        });
    }

    /**
     * 检查依赖是否满足
     */
    private checkDependencies(step: ExecutionStep, plan: ExecutionPlan): boolean {
        return step.dependencies.every(depOrder => {
            const depStep = plan.steps.find(s => s.order === depOrder);
            return depStep?.status === 'completed';
        });
    }

    /**
     * 准备输入数据
     */
    private prepareInputData(step: ExecutionStep, plan: ExecutionPlan, context: any): any {
        // 收集依赖步骤的结果
        const dependenciesResults = step.dependencies.map(depOrder => {
            const depStep = plan.steps.find(s => s.order === depOrder);
            return depStep?.result;
        });

        return {
            requirement: plan.requirement,
            workspace: plan.workspace,
            previousResults: dependenciesResults,
            ...context
        };
    }

    /**
     * 判断是否为关键步骤
     */
    private isCriticalStep(step: ExecutionStep): boolean {
        // 需求分析和代码生成是关键步骤
        return step.agentId === 'requirement-analysis' || step.agentId === 'code-generation';
    }

    /**
     * 汇总结果
     */
    private aggregateResults(plan: ExecutionPlan): any {
        const results: any = {
            requirement: plan.requirement,
            workspace: plan.workspace,
            steps: {}
        };

        for (const step of plan.steps) {
            if (step.status === 'completed') {
                results.steps[step.agentId] = step.result;
            }
        }

        return results;
    }

    /**
     * 创建空计划（fallback）
     */
    private createEmptyPlan(requirement: string, workspace: string): ExecutionPlan {
        return {
            planId: `plan-empty-${Date.now()}`,
            requirement,
            workspace,
            steps: [],
            strategy: '暂无可用Agent',
            estimatedTokens: 0
        };
    }
}

/**
 * 创建协调Agent实例
 */
export function createCoordinatorAgent(
    agentsService?: AgentsService,
    config?: CoordinatorConfig
): CoordinatorAgent {
    return new CoordinatorAgent(agentsService, config);
}
