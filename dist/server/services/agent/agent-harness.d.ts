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
import { AgentConfig, Task, AgentResult, ExecutionContext, Action, Result, Reflection } from './types.js';
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
export declare class AgentHarness {
    private toolExecutor;
    private monitor;
    private recovery;
    private agents;
    constructor();
    /**
     * 注册 Agent 实现
     */
    registerAgent(agent: AgentImplementation): void;
    /**
     * 执行 Agent
     */
    execute(agentId: string, task: Task): Promise<AgentResult>;
    /**
     * 创建执行上下文
     */
    private createContext;
    /**
     * 执行循环（Think → Act → Observe → Reflect）
     */
    private executeLoop;
    /**
     * 广播Agent决策过程到前端
     */
    private broadcastProgress;
    /**
     * Think：Agent 思考
     */
    private think;
    /**
     * Act：执行行动
     */
    private act;
    /**
     * Observe：观察结果
     */
    private observe;
    /**
     * Reflect：反思
     */
    private reflect;
    /**
     * 决策：是否继续执行
     */
    private shouldContinue;
    /**
     * 决策下一步行动
     */
    private decideAction;
    /**
     * 记录思考
     */
    private recordThink;
    /**
     * 记录观察
     */
    private recordObservation;
    /**
     * 记录反思
     */
    private recordReflection;
    /**
     * 前置验证
     */
    private validatePreconditions;
    /**
     * 后置验证
     */
    private validatePostconditions;
    /**
     * 获取监控统计
     */
    getStats(agentId?: string): {
        totalTraces: number;
        completedTraces: number;
        failedTraces: number;
        totalTokensUsed: number;
        averageQuality: number;
        averageDuration: number;
    };
    /**
     * 清理旧数据
     */
    cleanup(maxAge?: number): void;
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
export declare function createAgentHarness(): AgentHarness;
export {};
//# sourceMappingURL=agent-harness.d.ts.map