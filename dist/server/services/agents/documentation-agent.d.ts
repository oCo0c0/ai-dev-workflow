/**
 * @file Documentation Agent
 * @description 文档生成 Agent - 自动生成高质量文档
 *
 * 核心功能：
 * 1. 代码文档 - 从代码生成API文档、注释文档
 * 2. README生成 - 自动生成项目README
 * 3. 用户指南 - 生成用户使用指南
 * 4. API文档 - 生成API接口文档
 * 5. 质量优化 - 使用质量循环优化文档质量
 */
import { AgentImplementation } from '../agent';
import { ExecutionContext, Thought, Action, Result, Observation, Reflection } from '../agent';
/**
 * 文档生成 Agent 实现
 */
export declare class DocumentationAgent implements AgentImplementation {
    config: {
        id: string;
        name: string;
        description: string;
        tools: ({
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
                projectInfo?: undefined;
                features?: undefined;
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
                language?: undefined;
                projectInfo?: undefined;
                features?: undefined;
            };
            retryable: boolean;
            timeout: number;
        } | {
            name: string;
            description: string;
            parameters: {
                projectInfo: {
                    type: string;
                    description: string;
                };
                features: {
                    type: string;
                    description: string;
                };
                code?: undefined;
                language?: undefined;
            };
            retryable: boolean;
            timeout: number;
        })[];
        maxExecutionTime: number;
        maxRetries: number;
    };
    think(context: ExecutionContext): Promise<Thought>;
    act(context: ExecutionContext, action: Action): Promise<unknown>;
    observe(context: ExecutionContext, result: Result): Promise<Observation>;
    reflect(_context: ExecutionContext, observation: Observation): Promise<Reflection>;
    decide(context: ExecutionContext): Promise<Action>;
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined;
    /**
     * 分析代码结构
     */
    private analyzeCode;
    /**
     * 生成API文档
     */
    private generateAPIDoc;
    /**
     * 生成README文档
     */
    private generateREADME;
    /**
     * 编译最终结果
     */
    private compileFinalResult;
    /**
     * 评估文档质量
     */
    private assessDocQuality;
}
/**
 * 创建文档生成 Agent 实例
 */
export declare function createDocumentationAgent(): DocumentationAgent;
//# sourceMappingURL=documentation-agent.d.ts.map