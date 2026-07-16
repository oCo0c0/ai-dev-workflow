/**
 * @file Code Generation Agent
 * @description 代码生成 Agent - 遵循项目规范生成高质量代码
 *
 * 核心功能：
 * 1. 代码生成 - 根据需求生成符合规范的代码
 * 2. 质量优化 - 使用质量循环持续改进代码质量
 * 3. 测试生成 - 自动生成对应的单元测试
 * 4. 文档生成 - 生成代码文档和注释
 * 5. 规范遵循 - 遵循项目代码规范和最佳实践
 */
import { AgentImplementation } from '../agent';
import { ExecutionContext, Thought, Action, Result, Observation, Reflection } from '../agent';
/**
 * 代码生成 Agent 实现
 */
export declare class CodeGenerationAgent implements AgentImplementation {
    config: {
        id: string;
        name: string;
        description: string;
        tools: ({
            name: string;
            description: string;
            parameters: {
                requirement: {
                    type: string;
                    description: string;
                };
                language: {
                    type: string;
                    description: string;
                };
                code?: undefined;
                targetQuality?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                code: {
                    type: string;
                    description: string;
                };
                targetQuality: {
                    type: string;
                    description: string;
                };
                requirement?: undefined;
                language?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                code: {
                    type: string;
                    description: string;
                };
                language: {
                    type: string;
                    description: string;
                };
                requirement?: undefined;
                targetQuality?: undefined;
            };
            retryable: boolean;
            timeout: number;
        })[];
        maxExecutionTime: number;
        maxRetries: number;
    };
    private loopService;
    private defaultStyleConfig;
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
    reflect(context: ExecutionContext, observation: Observation): Promise<Reflection>;
    /**
     * Decide：决策下一步行动
     */
    decide(context: ExecutionContext): Promise<Action>;
    /**
     * 获取工具处理函数
     */
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    /**
     * 生成代码
     */
    private generateCode;
    /**
     * 生成 TypeScript 代码
     */
    private generateTypeScriptCode;
    /**
     * 生成 Python 代码
     */
    private generatePythonCode;
    /**
     * 生成通用代码
     */
    private generateGenericCode;
    /**
     * 优化代码质量
     */
    private optimizeQuality;
    /**
     * 应用改进
     */
    private applyImprovement;
    /**
     * 添加文档
     */
    private addDocumentation;
    /**
     * 改进错误处理
     */
    private improveErrorHandling;
    /**
     * 优化性能
     */
    private optimizePerformance;
    /**
     * 增强可读性
     */
    private enhanceReadability;
    /**
     * 生成测试
     */
    private generateTests;
    /**
     * 生成 TypeScript 测试
     */
    private generateTypeScriptTests;
    /**
     * 生成 Python 测试
     */
    private generatePythonTests;
    /**
     * 编译最终结果
     */
    private compileFinalResult;
    /**
     * 评估代码质量
     */
    private assessCodeQuality;
    /**
     * 格式化代码
     */
    private formatCode;
    /**
     * 生成文档
     */
    private generateDocumentation;
    /**
     * 识别依赖项
     */
    private identifyDependencies;
    /**
     * 生成 TODO 标记
     */
    private generateTodos;
}
/**
 * 创建代码生成 Agent 实例
 */
export declare function createCodeGenerationAgent(): CodeGenerationAgent;
//# sourceMappingURL=code-generation-agent.d.ts.map