"use strict";
/**
 * @file Agents Service
 * @description 专业 Agent 系统统一入口 - 管理和执行专业 Agent
 *
 * 功能：
 * 1. Agent 管理 - 注册和管理专业 Agent
 * 2. 任务执行 - 执行单个 Agent 任务
 * 3. 工作流执行 - 执行多 Agent 协作工作流
 * 4. 集成服务 - 与 Agent Harness 和 Loop System 集成
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCodeReviewAgent = exports.CodeReviewAgent = exports.createTestAgent = exports.TestAgent = exports.createCodeGenerationAgent = exports.CodeGenerationAgent = exports.createRequirementAnalysisAgent = exports.RequirementAnalysisAgent = exports.AgentsService = void 0;
exports.createAgentsService = createAgentsService;
const agent_1 = require("../agent");
const requirement_analysis_agent_js_1 = require("./requirement-analysis-agent.js");
const code_generation_agent_js_1 = require("./code-generation-agent.js");
const test_agent_js_1 = require("./test-agent.js");
const code_review_agent_js_1 = require("./code-review-agent.js");
const documentation_agent_js_1 = require("./documentation-agent.js");
/**
 * Agent 系统全局实例
 */
class AgentSystem {
    static harness = null;
    static agents = new Map();
    /**
     * 获取或创建 Agent Harness
     */
    static getHarness() {
        if (!this.harness) {
            this.harness = (0, agent_1.createAgentHarness)();
        }
        return this.harness;
    }
    /**
     * 获取或创建 Agent 实例
     */
    static getAgent(type) {
        if (!this.agents.has(type)) {
            let agent;
            switch (type) {
                case 'requirement-analysis':
                    agent = (0, requirement_analysis_agent_js_1.createRequirementAnalysisAgent)();
                    break;
                case 'code-generation':
                    agent = (0, code_generation_agent_js_1.createCodeGenerationAgent)();
                    break;
                case 'test':
                    agent = (0, test_agent_js_1.createTestAgent)();
                    break;
                case 'code-review':
                    agent = (0, code_review_agent_js_1.createCodeReviewAgent)();
                    break;
                case 'documentation':
                    agent = (0, documentation_agent_js_1.createDocumentationAgent)();
                    break;
                default:
                    throw new Error(`Unknown agent type: ${type}`);
            }
            this.agents.set(type, agent);
            this.getHarness().registerAgent(agent);
        }
        return this.agents.get(type);
    }
    /**
     * 重置系统
     */
    static reset() {
        this.harness = null;
        this.agents.clear();
    }
}
/**
 * Agent 管理服务
 */
class AgentsService {
    harness;
    constructor() {
        this.harness = AgentSystem.getHarness();
    }
    /**
     * 执行 Agent 任务
     */
    async executeAgent(input) {
        const startTime = Date.now();
        try {
            // 获取 Agent
            const agent = AgentSystem.getAgent(input.agentType);
            // 创建任务
            const task = {
                id: input.taskId,
                type: input.agentType,
                input: input.inputData,
                targetQuality: input.options?.targetQuality || 0.8,
                tokenBudget: input.options?.tokenBudget || 10000,
                priority: input.options?.priority || 'medium'
            };
            // 执行 Agent
            const result = await this.harness.execute(agent.config.id, task);
            return {
                agentType: input.agentType,
                taskId: input.taskId,
                success: result.success,
                result: result.data,
                quality: result.quality,
                duration: result.duration,
                tokensUsed: result.tokensUsed
            };
        }
        catch (error) {
            return {
                agentType: input.agentType,
                taskId: input.taskId,
                success: false,
                duration: Date.now() - startTime,
                tokensUsed: 0,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
    /**
     * 执行 Agent 工作流
     */
    async executeWorkflow(config) {
        const startTime = Date.now();
        const agentResults = [];
        const errors = [];
        let currentData = {};
        // 按 order 排序 Agent
        const sortedAgents = [...config.agents].sort((a, b) => a.order - b.order);
        for (const agentConfig of sortedAgents) {
            try {
                // 准备输入
                const inputData = this.prepareInputData(agentConfig, currentData, config.globalConfig);
                // 执行 Agent
                const result = await this.executeAgent({
                    agentType: agentConfig.type,
                    taskId: `${config.workflowId}-${agentConfig.type}`,
                    inputData,
                    options: config.globalConfig
                });
                agentResults.push(result);
                // 如果 Agent 必须但失败，终止工作流
                if (agentConfig.required && !result.success) {
                    errors.push(`Required agent ${agentConfig.type} failed: ${result.error}`);
                    break;
                }
                // 更新数据用于下一个 Agent
                if (result.success && result.result) {
                    currentData = this.updateOutputData(agentConfig, result.result, currentData);
                }
            }
            catch (error) {
                const errorMsg = `Agent ${agentConfig.type} execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                errors.push(errorMsg);
                if (agentConfig.required) {
                    break;
                }
            }
        }
        const success = errors.length === 0;
        return {
            workflowId: config.workflowId,
            success,
            agentResults,
            totalDuration: Date.now() - startTime,
            totalTokensUsed: agentResults.reduce((sum, r) => sum + r.tokensUsed, 0),
            errors
        };
    }
    /**
     * 准备输入数据
     */
    prepareInputData(agentConfig, currentData, _globalConfig // 预留参数，未来用于全局配置传递
    ) {
        let inputData = { ...currentData };
        // 应用输入映射
        if (agentConfig.inputMapping) {
            inputData = {};
            for (const [key, sourceKey] of Object.entries(agentConfig.inputMapping)) {
                inputData[key] = currentData[sourceKey];
            }
        }
        return inputData;
    }
    /**
     * 更新输出数据
     */
    updateOutputData(agentConfig, result, currentData) {
        let updatedData = { ...currentData };
        // 应用输出映射
        if (agentConfig.outputMapping) {
            for (const [key, value] of Object.entries(result)) {
                const mappedKey = agentConfig.outputMapping[value] || value;
                updatedData[mappedKey] = result[key];
            }
        }
        else {
            updatedData = { ...updatedData, ...result };
        }
        return updatedData;
    }
    /**
     * 列出可用的Agent
     */
    listAgents() {
        return [
            { id: 'requirement-analysis', name: '需求分析Agent', description: '分析需求文档，提取关键信息和变更点' },
            { id: 'code-generation', name: '代码生成Agent', description: '根据需求生成高质量代码' },
            { id: 'test', name: '测试Agent', description: '生成和执行测试用例' },
            { id: 'code-review', name: '代码审查Agent', description: '审查代码质量、安全性和最佳实践' },
            { id: 'documentation', name: '文档生成Agent', description: '生成技术文档和API文档' }
        ];
    }
    /**
     * 获取系统统计
     */
    getStats() {
        return {
            availableAgents: ['requirement-analysis', 'code-generation', 'test', 'code-review'],
            harnessStats: this.harness.getStats()
        };
    }
}
exports.AgentsService = AgentsService;
/**
 * 创建 Agent 服务实例
 */
function createAgentsService() {
    return new AgentsService();
}
// 导出所有 Agent
var requirement_analysis_agent_js_2 = require("./requirement-analysis-agent.js");
Object.defineProperty(exports, "RequirementAnalysisAgent", { enumerable: true, get: function () { return requirement_analysis_agent_js_2.RequirementAnalysisAgent; } });
Object.defineProperty(exports, "createRequirementAnalysisAgent", { enumerable: true, get: function () { return requirement_analysis_agent_js_2.createRequirementAnalysisAgent; } });
var code_generation_agent_js_2 = require("./code-generation-agent.js");
Object.defineProperty(exports, "CodeGenerationAgent", { enumerable: true, get: function () { return code_generation_agent_js_2.CodeGenerationAgent; } });
Object.defineProperty(exports, "createCodeGenerationAgent", { enumerable: true, get: function () { return code_generation_agent_js_2.createCodeGenerationAgent; } });
var test_agent_js_2 = require("./test-agent.js");
Object.defineProperty(exports, "TestAgent", { enumerable: true, get: function () { return test_agent_js_2.TestAgent; } });
Object.defineProperty(exports, "createTestAgent", { enumerable: true, get: function () { return test_agent_js_2.createTestAgent; } });
var code_review_agent_js_2 = require("./code-review-agent.js");
Object.defineProperty(exports, "CodeReviewAgent", { enumerable: true, get: function () { return code_review_agent_js_2.CodeReviewAgent; } });
Object.defineProperty(exports, "createCodeReviewAgent", { enumerable: true, get: function () { return code_review_agent_js_2.createCodeReviewAgent; } });
// 导出类型
__exportStar(require("./types.js"), exports);
//# sourceMappingURL=agents-service.js.map