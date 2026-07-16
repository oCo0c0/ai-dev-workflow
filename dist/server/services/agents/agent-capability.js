"use strict";
/**
 * @file Agent能力注册系统
 * @description 定义Agent能力接口和能力注册表，支持动态Agent发现和选择
 *
 * 核心功能：
 * 1. AgentCapability - Agent能力声明接口
 * 2. canHandle - 置信度评分（0-1），评估Agent是否适合处理任务
 * 3. AgentRegistry - 能力注册表，支持运行时查询和选择
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAgentRegistry = getAgentRegistry;
exports.registerAgentCapability = registerAgentCapability;
/**
 * Agent能力注册表（单例）
 */
class AgentRegistry {
    static instance;
    capabilities = new Map();
    constructor() {
    }
    static getInstance() {
        if (!AgentRegistry.instance) {
            AgentRegistry.instance = new AgentRegistry();
        }
        return AgentRegistry.instance;
    }
    /**
     * 注册Agent能力
     */
    register(capability) {
        this.capabilities.set(capability.agentId, capability);
    }
    /**
     * 批量注册Agent能力
     */
    registerBatch(capabilities) {
        capabilities.forEach(cap => this.register(cap));
    }
    /**
     * 选择最适合的Agent
     * @param taskDescription 任务描述
     * @param context 上下文信息
     * @param minConfidence 最低置信度阈值（默认0.3）
     * @returns 最佳Agent或null
     */
    selectBestAgent(taskDescription, context, minConfidence = 0.3) {
        let bestAgent = null;
        let bestScore = minConfidence;
        for (const capability of this.capabilities.values()) {
            const score = capability.canHandle(taskDescription, context);
            // 考虑优先级：相同分数时，优先级高的胜出
            const adjustedScore = score + (capability.priority || 0) * 0.01;
            if (adjustedScore > bestScore) {
                bestScore = adjustedScore;
                bestAgent = capability;
            }
        }
        if (!bestAgent) {
            return null;
        }
        return {
            agentId: bestAgent.agentId,
            agentName: bestAgent.name,
            confidence: bestAgent.canHandle(taskDescription, context),
            reasoning: bestAgent.description
        };
    }
    /**
     * 获取所有适合的Agent（按置信度排序）
     */
    getCandidates(taskDescription, context, minConfidence = 0.3) {
        const candidates = [];
        for (const capability of this.capabilities.values()) {
            const confidence = capability.canHandle(taskDescription, context);
            if (confidence >= minConfidence) {
                candidates.push({
                    agentId: capability.agentId,
                    agentName: capability.name,
                    confidence,
                    reasoning: capability.description
                });
            }
        }
        // 按置信度+优先级排序
        candidates.sort((a, b) => {
            const capabilityA = this.capabilities.get(a.agentId);
            const capabilityB = this.capabilities.get(b.agentId);
            const scoreA = a.confidence + (capabilityA.priority || 0) * 0.01;
            const scoreB = b.confidence + (capabilityB.priority || 0) * 0.01;
            return scoreB - scoreA;
        });
        return candidates;
    }
    /**
     * 获取所有已注册的Agent
     */
    getAllAgents() {
        return Array.from(this.capabilities.values());
    }
    /**
     * 检查Agent是否已注册
     */
    has(agentId) {
        return this.capabilities.has(agentId);
    }
    /**
     * 清空注册表（主要用于测试）
     */
    clear() {
        this.capabilities.clear();
    }
}
/**
 * 获取Agent注册表实例
 */
function getAgentRegistry() {
    return AgentRegistry.getInstance();
}
/**
 * 注册Agent能力的便捷函数
 */
function registerAgentCapability(capability) {
    getAgentRegistry().register(capability);
}
//# sourceMappingURL=agent-capability.js.map