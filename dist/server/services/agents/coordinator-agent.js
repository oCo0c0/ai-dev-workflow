"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoordinatorAgent = void 0;
exports.createCoordinatorAgent = createCoordinatorAgent;
const agent_capability_js_1 = require("./agent-capability.js");
const agents_service_js_1 = require("./agents-service.js");
const websocket_js_1 = require("../../websocket.js");
/**
 * 添加Agent日志（简化版）
 */
function addAgentLog(message) {
    console.log(`[Agent] ${message}`);
}
/**
 * 协调Agent
 */
class CoordinatorAgent {
    agentsService;
    config;
    constructor(agentsService, config = {}) {
        this.agentsService = agentsService || new agents_service_js_1.AgentsService();
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
    async execute(requirement, workspace, context = {}, options = {}) {
        const startTime = Date.now();
        const errors = [];
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
        }
        catch (error) {
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
    async plan(requirement, workspace, context) {
        // 分析需求，提取关键任务
        const tasks = this.analyzeRequirement(requirement);
        // 为每个任务选择最佳Agent
        const steps = [];
        let estimatedTokens = 0;
        tasks.forEach((task, index) => {
            const selection = (0, agent_capability_js_1.getAgentRegistry)().selectBestAgent(task.description, context);
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
            }
            else {
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
    analyzeRequirement(requirement) {
        const tasks = [];
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
            tasks.push({ description: '需求分析' }, { description: '代码生成', dependencies: [0] }, { description: '测试', dependencies: [1] });
        }
        return tasks;
    }
    /**
     * 生成策略说明
     */
    generateStrategy(steps) {
        if (steps.length === 0) {
            return '暂无可用Agent处理此需求';
        }
        const stepDescriptions = steps.map(step => `${step.order}. ${step.agentName}（${step.reasoning}）`).join('\n');
        return `执行策略：\n${stepDescriptions}`;
    }
    /**
     * 执行计划
     */
    async executePlan(plan, context) {
        const errors = [];
        let finalResult = {};
        let totalTokens = 0;
        // 按顺序执行步骤
        for (const step of plan.steps) {
            // 检查是否暂停请求
            if (plan.pauseRequested) {
                // 保存当前状态并返回
                return {
                    success: false,
                    finalResult: { paused: true, currentStep: step.order },
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
                    agentType: step.agentId,
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
                    if (result.result?.userQuestion && this.config.allowUserInteraction) {
                        const question = result.result.userQuestion || '请提供更多信息';
                        const answer = await this.askUser(question, plan);
                        if (answer === '[SKIP]') {
                            addAgentLog(`用户跳过问题: ${question}`);
                        }
                        else {
                            // 将用户回答添加到上下文中
                            context.userAnswer = answer;
                            addAgentLog(`用户回答: ${answer}`);
                        }
                    }
                    // 通知步骤完成
                    if (this.config.onProgress) {
                        this.config.onProgress(step, plan);
                    }
                }
                else {
                    step.status = 'failed';
                    step.error = result.error;
                    errors.push(`步骤${step.order}失败: ${result.error}`);
                    // 如果是关键步骤失败，终止执行
                    if (this.isCriticalStep(step)) {
                        break;
                    }
                }
            }
            catch (error) {
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
    async askUser(question, plan) {
        // 初始化问题队列
        if (!plan.userQuestions) {
            plan.userQuestions = [];
        }
        // 添加问题到队列
        plan.userQuestions.push({ question, answer: undefined });
        // 广播问题给前端
        (0, websocket_js_1.broadcast)({
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
    checkDependencies(step, plan) {
        return step.dependencies.every(depOrder => {
            const depStep = plan.steps.find(s => s.order === depOrder);
            return depStep?.status === 'completed';
        });
    }
    /**
     * 准备输入数据
     */
    prepareInputData(step, plan, context) {
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
    isCriticalStep(step) {
        // 需求分析和代码生成是关键步骤
        return step.agentId === 'requirement-analysis' || step.agentId === 'code-generation';
    }
    /**
     * 汇总结果
     */
    aggregateResults(plan) {
        const results = {
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
    createEmptyPlan(requirement, workspace) {
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
exports.CoordinatorAgent = CoordinatorAgent;
/**
 * 创建协调Agent实例
 */
function createCoordinatorAgent(agentsService, config) {
    return new CoordinatorAgent(agentsService, config);
}
//# sourceMappingURL=coordinator-agent.js.map