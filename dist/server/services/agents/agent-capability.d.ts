/**
 * @file Agent能力注册系统
 * @description 定义Agent能力接口和能力注册表，支持动态Agent发现和选择
 *
 * 核心功能：
 * 1. AgentCapability - Agent能力声明接口
 * 2. canHandle - 置信度评分（0-1），评估Agent是否适合处理任务
 * 3. AgentRegistry - 能力注册表，支持运行时查询和选择
 */
/**
 * Agent能力声明
 */
export interface AgentCapability {
    /** Agent唯一标识符 */
    agentId: string;
    /** Agent显示名称 */
    name: string;
    /** Agent功能描述 */
    description: string;
    /** 评估Agent是否适合处理任务，返回置信度0-1 */
    canHandle(taskDescription: string, context?: any): number;
    /** Agent优先级（相同置信度时，优先级高的胜出） */
    priority?: number;
}
/**
 * Agent选择结果
 */
export interface AgentSelection {
    agentId: string;
    agentName: string;
    confidence: number;
    reasoning: string;
}
/**
 * Agent能力注册表（单例）
 */
declare class AgentRegistry {
    private static instance;
    private capabilities;
    private constructor();
    static getInstance(): AgentRegistry;
    /**
     * 注册Agent能力
     */
    register(capability: AgentCapability): void;
    /**
     * 批量注册Agent能力
     */
    registerBatch(capabilities: AgentCapability[]): void;
    /**
     * 选择最适合的Agent
     * @param taskDescription 任务描述
     * @param context 上下文信息
     * @param minConfidence 最低置信度阈值（默认0.3）
     * @returns 最佳Agent或null
     */
    selectBestAgent(taskDescription: string, context?: any, minConfidence?: number): AgentSelection | null;
    /**
     * 获取所有适合的Agent（按置信度排序）
     */
    getCandidates(taskDescription: string, context?: any, minConfidence?: number): AgentSelection[];
    /**
     * 获取所有已注册的Agent
     */
    getAllAgents(): AgentCapability[];
    /**
     * 检查Agent是否已注册
     */
    has(agentId: string): boolean;
    /**
     * 清空注册表（主要用于测试）
     */
    clear(): void;
}
/**
 * 获取Agent注册表实例
 */
export declare function getAgentRegistry(): AgentRegistry;
/**
 * 注册Agent能力的便捷函数
 */
export declare function registerAgentCapability(capability: AgentCapability): void;
export {};
//# sourceMappingURL=agent-capability.d.ts.map