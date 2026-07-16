/**
 * @file Simple Agent Example
 * @description 示例 Agent 实现 - 展示如何使用 Agent Harness 框架
 *
 * 这个 Agent 模拟一个简单的文本处理任务：
 * 1. 接收文本输入
 * 2. 分析文本
 * 3. 执行转换操作
 * 4. 评估结果质量
 * 5. 迭代改进
 */
import { AgentImplementation, ExecutionContext, Thought, Action, Result, Observation, Reflection, AgentConfig } from '../types.js';
/**
 * 简单文本处理 Agent
 */
export declare class SimpleTextAgent implements AgentImplementation {
    config: AgentConfig;
    /**
     * Think：分析当前状态并决定下一步
     */
    think(context: ExecutionContext): Promise<Thought>;
    /**
     * Act：执行行动
     */
    act(context: ExecutionContext, action: Action): Promise<unknown>;
    /**
     * Observe：观察行动结果
     */
    observe(context: ExecutionContext, result: Result): Promise<Observation>;
    /**
     * Reflect：反思并生成改进建议
     */
    reflect(_context: ExecutionContext, observation: Observation): Promise<Reflection>;
    /**
     * Decide：决策下一步行动
     */
    decide(context: ExecutionContext): Promise<Action>;
    /**
     * 获取工具处理函数
     */
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    /**
     * 评估文本质量
     */
    private assessQuality;
    /**
     * 选择改进操作
     */
    private selectImprovementOperation;
    /**
     * 分析文本
     */
    private analyzeText;
    /**
     * 转换文本
     */
    private transformText;
}
/**
 * 使用示例
 */
export declare function runSimpleTextAgentExample(): Promise<void>;
//# sourceMappingURL=simple-agent.d.ts.map