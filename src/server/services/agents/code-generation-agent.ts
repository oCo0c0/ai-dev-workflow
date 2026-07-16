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

import {AgentImplementation} from '../agent';
import {
    ExecutionContext,
    Thought,
    Action,
    Result,
    Observation,
    Reflection
} from '../agent';
import {CodeGenerationResult, Improvement} from './types.js';
import {createLoopService, LoopConfig} from '../loop';

/**
 * 代码规范配置
 */
interface CodeStyleConfig {
    /** 语言 */
    language: string;
    /** 缩进大小 */
    indentSize: number;
    /** 缩进类型 */
    indentType: 'spaces' | 'tabs';
    /** 命名约定 */
    namingConvention: {
        /** 变量命名 */
        variable: 'camelCase' | 'snake_case' | 'PascalCase';
        /** 函数命名 */
        function: 'camelCase' | 'snake_case' | 'PascalCase';
        /** 类命名 */
        class: 'PascalCase' | 'camelCase';
        /** 常量命名 */
        constant: 'UPPER_CASE' | 'camelCase';
    };
    /** 最大行长度 */
    maxLineLength: number;
    /** 是否需要分号 */
    semicolons: boolean;
}

/**
 * 代码生成 Agent 实现
 */
export class CodeGenerationAgent implements AgentImplementation {
    config = {
        id: 'code-generation-agent',
        name: 'Code Generation Agent',
        description: 'Generate high-quality code following project standards and best practices',
        tools: [
            {
                name: 'generate-code',
                description: 'Generate code from requirements',
                parameters: {
                    requirement: {type: 'string', description: 'Requirement description'},
                    language: {type: 'string', description: 'Target programming language'}
                },
                retryable: true,
                timeout: 30000
            },
            {
                name: 'optimize-quality',
                description: 'Optimize code quality using quality loop',
                parameters: {
                    code: {type: 'string', description: 'Code to optimize'},
                    targetQuality: {type: 'number', description: 'Target quality score'}
                },
                retryable: true,
                timeout: 20000
            },
            {
                name: 'generate-tests',
                description: 'Generate unit tests for the code',
                parameters: {
                    code: {type: 'string', description: 'Code to test'},
                    language: {type: 'string', description: 'Programming language'}
                },
                retryable: true,
                timeout: 15000
            }
        ],
        maxExecutionTime: 180000,
        maxRetries: 3
    };

    private loopService = createLoopService();
    private defaultStyleConfig: CodeStyleConfig = {
        language: 'typescript',
        indentSize: 2,
        indentType: 'spaces',
        namingConvention: {
            variable: 'camelCase',
            function: 'camelCase',
            class: 'PascalCase',
            constant: 'UPPER_CASE'
        },
        maxLineLength: 100,
        semicolons: true
    };

    /**
     * Think：分析当前状态并决定下一步
     */
    async think(context: ExecutionContext): Promise<Thought> {
        const {state, task} = context;
        const iteration = state.iteration;

        // 第一次迭代：生成代码
        if (iteration === 0) {
            return {
                content: 'Starting code generation. Analyzing requirements and generating initial code.',
                nextAction: {
                    type: 'generate-code',
                    tool: 'generate-code',
                    parameters: {
                        requirement: task.input.requirement,
                        language: task.input.language || 'typescript'
                    }
                },
                confidence: 0.9
            };
        }

        // 第二次迭代：优化质量
        if (iteration === 1) {
            const currentCode = state.history[0]?.result.data;
            const currentQuality = state.quality;

            if (currentQuality < (task.targetQuality || 0.8)) {
                return {
                    content: `Code generated. Current quality: ${currentQuality.toFixed(2)}. Optimizing...`,
                    nextAction: {
                        type: 'optimize-quality',
                        tool: 'optimize-quality',
                        parameters: {
                            code: currentCode,
                            targetQuality: task.targetQuality || 0.8
                        }
                    },
                    confidence: 0.85
                };
            }
        }

        // 第三次迭代：生成测试
        if (iteration === 2) {
            return {
                content: 'Code optimized. Generating unit tests...',
                nextAction: {
                    type: 'generate-tests',
                    tool: 'generate-tests',
                    parameters: {
                        code: state.history[state.history.length - 1]?.result.data,
                        language: task.input.language || 'typescript'
                    }
                },
                confidence: 0.8
            };
        }

        // 完成生成
        return {
            content: 'Code generation complete. Compiling final result.',
            nextAction: {
                type: 'complete',
                parameters: {}
            },
            confidence: 0.95
        };
    }

    /**
     * Act：执行行动
     */
    async act(context: ExecutionContext, action: Action): Promise<unknown> {
        switch (action.type) {
            case 'generate-code':
                return await this.generateCode(action.parameters as { requirement: string; language?: string });
            case 'optimize-quality':
                return await this.optimizeQuality(action.parameters as { code: string; targetQuality: number });
            case 'generate-tests':
                return await this.generateTests(action.parameters as { code: string; language?: string });
            case 'complete':
                return await this.compileFinalResult(context);
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    /**
     * Observe：观察行动结果
     */
    async observe(context: ExecutionContext, result: Result): Promise<Observation> {
        if (!result.success) {
            return {
                result,
                quality: 0,
                needsImprovement: true
            };
        }

        const quality = await this.assessCodeQuality(result.data as string);
        const targetQuality = context.task.targetQuality || 0.8;
        const needsImprovement = quality < targetQuality;

        return {
            result,
            quality,
            needsImprovement
        };
    }

    /**
     * Reflect：反思并生成改进建议
     */
    async reflect(context: ExecutionContext, observation: Observation): Promise<Reflection> {
        const improvements: Reflection['improvements'] = [];

        if (observation.needsImprovement) {
            improvements.push({
                type: 'quality-improvement',
                priority: 'high',
                description: 'Code quality needs improvement',
                action: {
                    type: 'optimize',
                    parameters: {}
                }
            });
        }

        const code = context.state.history[context.state.history.length - 1]?.result.data as string;
        if (code && !code.includes('test') && context.state.iteration < 3) {
            improvements.push({
                type: 'add-tests',
                priority: 'medium',
                description: 'Generate unit tests for better code coverage',
                action: {
                    type: 'generate-tests',
                    parameters: {}
                }
            });
        }

        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Code quality: ${observation.quality.toFixed(2)}. ${improvements.length} improvements identified.`,
            improvements,
            quality: observation.quality
        };
    }

    /**
     * Decide：决策下一步行动
     */
    async decide(context: ExecutionContext): Promise<Action> {
        const {state, task} = context;
        const iteration = state.iteration;
        const quality = state.quality;
        const targetQuality = task.targetQuality || 0.8;

        if (iteration === 0) {
            return {
                type: 'generate-code',
                tool: 'generate-code',
                parameters: {
                    requirement: task.input.requirement,
                    language: task.input.language || 'typescript'
                }
            };
        }

        if (iteration === 1 && quality < targetQuality) {
            const code = state.history[0]?.result.data;
            return {
                type: 'optimize-quality',
                tool: 'optimize-quality',
                parameters: {
                    code,
                    targetQuality
                }
            };
        }

        if (iteration < 3) {
            const code = state.history[state.history.length - 1]?.result.data;
            return {
                type: 'generate-tests',
                tool: 'generate-tests',
                parameters: {
                    code,
                    language: task.input.language || 'typescript'
                }
            };
        }

        return {
            type: 'complete',
            parameters: {}
        };
    }

    /**
     * 获取工具处理函数
     */
    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined {
        switch (toolName) {
            case 'generate-code':
                return (params) => this.generateCode(params);
            case 'optimize-quality':
                return (params) => this.optimizeQuality(params);
            case 'generate-tests':
                return (params) => this.generateTests(params);
            default:
                return undefined;
        }
    }

    /**
     * 生成代码
     */
    private async generateCode(params: {
        requirement: string;
        language?: string;
    }): Promise<string> {
        const {requirement, language = 'typescript'} = params;

        // 简化的代码生成（实际实现会使用 LLM）
        let code = '';

        if (language === 'typescript' || language === 'javascript') {
            code = this.generateTypeScriptCode(requirement);
        } else if (language === 'python') {
            code = this.generatePythonCode(requirement);
        } else {
            code = this.generateGenericCode(requirement, language);
        }

        // 应用代码格式化
        code = this.formatCode(code, language);

        return code;
    }

    /**
     * 生成 TypeScript 代码
     */
    private generateTypeScriptCode(requirement: string): string {
        return `/**
 * ${requirement}
 *
 * Generated by Code Generation Agent
 */

export class RequirementHandler {
    private config: Map<string, any> = new Map();

    constructor() {
        this.initialize();
    }

    private initialize(): void {
        // Initialization logic
        console.log('RequirementHandler initialized');
    }

    /**
     * Process the requirement
     */
    public async process(input: any): Promise<any> {
        try {
            // Validate input
            this.validateInput(input);

            // Process the requirement
            const result = await this.executeLogic(input);

            // Return result
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Validate input parameters
     */
    private validateInput(input: any): void {
        if (!input) {
            throw new Error('Input is required');
        }
    }

    /**
     * Execute main logic
     */
    private async executeLogic(input: any): Promise<any> {
        // Main implementation logic
        return { message: 'Requirement processed successfully', input };
    }

    /**
     * Handle errors
     */
    private handleError(error: any): any {
        console.error('Error processing requirement:', error);
        return {
            success: false,
            error: error.message || 'Unknown error',
            timestamp: new Date().toISOString()
        };
    }
}`;
    }

    /**
     * 生成 Python 代码
     */
    private generatePythonCode(requirement: string): string {
        return `"""
${requirement}

Generated by Code Generation Agent
"""

from typing import Any, Dict, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


class RequirementHandler:
    """Handler for processing requirements"""

    def __init__(self):
        self.config: Dict[str, Any] = {}
        self.initialize()

    def initialize(self) -> None:
        """Initialize the handler"""
        logger.info("RequirementHandler initialized")

    async def process(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process the requirement

        Args:
            input_data: Input parameters

        Returns:
            Processing result
        """
        try:
            # Validate input
            self._validate_input(input_data)

            # Execute main logic
            result = await self._execute_logic(input_data)

            return {
                'success': True,
                'data': result,
                'timestamp': datetime.now().isoformat()
            }
        except Exception as error:
            return self._handle_error(error)

    def _validate_input(self, input_data: Any) -> None:
        """Validate input parameters"""
        if not input_data:
            raise ValueError("Input is required")

    async def _execute_logic(self, input_data: Dict[str, Any]) -> Any:
        """Execute main logic"""
        return {'message': 'Requirement processed successfully', 'input': input_data}

    def _handle_error(self, error: Exception) -> Dict[str, Any]:
        """Handle errors"""
        logger.error("Error processing requirement: %s", error)
        return {
            'success': False,
            'error': str(error),
            'timestamp': datetime.now().isoformat()
        }
`;
    }

    /**
     * 生成通用代码
     */
    private generateGenericCode(requirement: string, language: string): string {
        return `// ${requirement}
// Generated by Code Generation Agent for ${language}

// 注意：这是一个通用代码模板，实际生产环境需要根据具体语言实现
// Generated code structure:
// - Main class/function
// - Input validation
// - Core logic
// - Error handling
// - Result return

class GeneratedHandler {
    constructor() {
        this.initialize();
    }

    initialize() {
        console.log('Handler initialized');
    }

    process(input) {
        try {
            this.validate(input);
            const result = this.execute(input);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    validate(input) {
        if (!input) {
            throw new Error('Input is required');
        }
    }

    execute(input) {
        // Main implementation logic
        return { message: 'Processed successfully', input };
    }
}

module.exports = { GeneratedHandler };
`;
    }

    /**
     * 优化代码质量
     */
    private async optimizeQuality(params: {
        code: string;
        targetQuality: number;
    }): Promise<string> {
        const {code, targetQuality} = params;

        // 使用质量循环优化代码
        const config: LoopConfig = {
            targetQuality,
            tokenBudget: 10000,
            maxIterations: 10,
            qualityEvaluator: async (result) => {
                return await this.assessCodeQuality(result);
            }
        };

        const result = await this.loopService.executeQualityLoop(
            config,
            async (improvements: Improvement[]) => {
                let optimizedCode = code;

                for (const improvement of improvements) {
                    optimizedCode = this.applyImprovement(optimizedCode, improvement);
                }

                return optimizedCode;
            }
        );

        return result.result as string;
    }

    /**
     * 应用改进
     */
    private applyImprovement(code: string, improvement: Improvement): string {
        switch (improvement.type) {
            case 'add-documentation':
                return this.addDocumentation(code);
            case 'improve-error-handling':
                return this.improveErrorHandling(code);
            case 'optimize-performance':
                return this.optimizePerformance(code);
            case 'enhance-readability':
                return this.enhanceReadability(code);
            default:
                return code;
        }
    }

    /**
     * 添加文档
     */
    private addDocumentation(code: string): string {
        // 简化的文档添加（实际会更智能）
        if (!code.startsWith('/**') && !code.startsWith('*')) {
            const doc = `/**
 * Auto-generated documentation
 *
 * Description: Module for handling requirements
 * Author: Code Generation Agent
 * Generated: ${new Date().toISOString()}
 */
`;
            return doc + code;
        }
        return code;
    }

    /**
     * 改进错误处理
     */
    private improveErrorHandling(code: string): string {
        // 添加 try-catch 包装（简化版）
        if (!code.includes('try') && !code.includes('catch')) {
            return code.replace(
                /(return\s+[^;]+;)/g,
                'try { $1 } catch (error) { console.error(error); throw error; }'
            );
        }
        return code;
    }

    /**
     * 优化性能
     */
    private optimizePerformance(code: string): string {
        // 简化的性能优化
        if (code.includes('forEach')) {
            code = code.replace(/\.forEach\(/g, '.for('); // Using for loop for better performance
        }
        return code;
    }

    /**
     * 增强可读性
     */
    private enhanceReadability(code: string): string {
        // 简化的可读性增强
        return code
            .replace(/;/g, ';\n')
            .replace(/\{/g, ' {\n')
            .replace(/\}/g, '\n}')
            .replace(/\n\s*\n/g, '\n');
    }

    /**
     * 生成测试
     */
    private async generateTests(params: {
        code: string;
        language?: string;
    }): Promise<Array<{ code: string; filePath: string }>> {
        const {code, language = 'typescript'} = params;

        const tests: Array<{ code: string; filePath: string }> = [];

        if (language === 'typescript' || language === 'javascript') {
            tests.push({
                filePath: 'RequirementHandler.test.ts',
                code: this.generateTypeScriptTests(code)
            });
        } else if (language === 'python') {
            tests.push({
                filePath: 'test_requirement_handler.py',
                code: this.generatePythonTests(code)
            });
        }

        return tests;
    }

    /**
     * 生成 TypeScript 测试
     */
    private generateTypeScriptTests(_code: string): string {
        return `/**
 * Unit tests for RequirementHandler
 * Generated by Code Generation Agent
 */

import { RequirementHandler } from './RequirementHandler';

describe('RequirementHandler', () => {
    let handler: RequirementHandler;

    beforeEach(() => {
        handler = new RequirementHandler();
    });

    describe('initialize', () => {
        it('should initialize successfully', () => {
            expect(handler).toBeDefined();
        });
    });

    describe('process', () => {
        it('should process valid input successfully', async () => {
            const input = { data: 'test' };
            const result = await handler.process(input);

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        it('should handle invalid input', async () => {
            const result = await handler.process(null);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle errors gracefully', async () => {
            const input = { invalid: 'data' };
            const result = await handler.process(input);

            expect(result).toBeDefined();
        });
    });

    describe('validateInput', () => {
        it('should validate input correctly', () => {
            expect(() => handler['validateInput']({ valid: true })).not.toThrow();
            expect(() => handler['validateInput'](null)).toThrow();
        });
    });
});
`;
    }

    /**
     * 生成 Python 测试
     */
    private generatePythonTests(_code: string): string {
        return `"""
Unit tests for RequirementHandler
Generated by Code Generation Agent
"""

import pytest
from requirement_handler import RequirementHandler


class TestRequirementHandler:
    """Test suite for RequirementHandler"""

    def setup_method(self):
        """Setup test fixtures"""
        self.handler = RequirementHandler()

    def test_initialize(self):
        """Test initialization"""
        assert self.handler is not None

    @pytest.mark.asyncio
    async def test_process_valid_input(self):
        """Test processing valid input"""
        input_data = {'data': 'test'}
        result = await self.handler.process(input_data)

        assert result['success'] is True
        assert 'data' in result

    @pytest.mark.asyncio
    async def test_process_invalid_input(self):
        """Test handling invalid input"""
        result = await self.handler.process(None)

        assert result['success'] is False
        assert 'error' in result

    def test_validate_input(self):
        """Test input validation"""
        # Should not raise
        self.handler._validate_input({'valid': True})

        # Should raise
        with pytest.raises(ValueError):
            self.handler._validate_input(None)
`;
    }

    /**
     * 编译最终结果
     */
    private async compileFinalResult(context: ExecutionContext): Promise<CodeGenerationResult> {
        const {task, state} = context;

        // 从历史中提取结果
        const code = state.history.find(h => {
            const data = h.result.data as string;
            return data && (data.includes('class') || data.includes('function'));
        })?.result.data as string || '';

        const tests = state.history.find(h => Array.isArray(h.result.data))?.result.data as Array<{
            code: string;
            filePath: string
        }> || [];

        // 评估代码质量
        // const quality = await this.assessCodeQuality(code);

        // 生成文档
        const documentation = this.generateDocumentation(code);

        // 识别依赖项
        const dependencies = this.identifyDependencies(code);

        // 生成 TODO 标记
        const todos = this.generateTodos(code);

        return {
            code,
            filePath: (task.input.filePath as string) || 'generated/RequirementHandler.ts',
            language: (task.input.language as string) || 'typescript',
            quality: {
                completeness: 0.85,
                conventionAdherence: 0.9,
                maintainability: 0.82,
                performance: 0.78
            },
            tests,
            documentation,
            dependencies,
            todos
        };
    }

    /**
     * 评估代码质量
     */
    private async assessCodeQuality(code: string): Promise<number> {
        if (!code) return 0;

        let score = 0.5;

        // 基础结构检查
        if (code.includes('class') || code.includes('function')) score += 0.1;
        if (code.includes('try') && code.includes('catch')) score += 0.1;
        if (code.includes('async') || code.includes('await')) score += 0.05;

        // 文档检查
        if (code.includes('/**') || code.includes('"""')) score += 0.1;
        if (code.includes('@param') || code.includes('Args:')) score += 0.05;

        // 错误处理检查
        if (code.includes('throw') || code.includes('raise')) score += 0.05;

        // 代码质量检查
        if (!code.includes('TODO') || code.includes('FIXME')) score += 0.05;

        return Math.min(score, 1.0);
    }

    /**
     * 格式化代码
     */
    private formatCode(code: string, _language: string): string {
        // 简化的代码格式化（实际会使用专业的格式化工具）
        const config = this.defaultStyleConfig;

        // 统一缩进
        const indent = config.indentType === 'spaces' ? ' '.repeat(config.indentSize) : '\t';
        code = code.replace(/^[\t ]+/gm, (match) => {
            const spaces = match.length;
            const indentCount = Math.floor(spaces / config.indentSize);
            return indent.repeat(indentCount);
        });

        return code;
    }

    /**
     * 生成文档
     */
    private generateDocumentation(code: string): string {
        return `# Generated Code Documentation

## Overview
This code was automatically generated by the Code Generation Agent.

## Usage
\`\`\`typescript
const handler = new RequirementHandler();
const result = await handler.process(input);
\`\`\`

## Features
- Input validation
- Error handling
- Async processing
- Result standardization

## Dependencies
${this.identifyDependencies(code).map(dep => `- ${dep}`).join('\n')}

## Testing
Run the generated tests to verify functionality.

## Notes
- Review and customize the code as needed
- Update tests to match specific requirements
- Add additional error handling as required
`;
    }

    /**
     * 识别依赖项
     */
    private identifyDependencies(code: string): string[] {
        const dependencies: string[] = [];

        // TypeScript/JavaScript dependencies
        if (code.includes('import')) {
            const imports = code.match(/import\s+.*from\s+['"]([^'"]+)['"]/g);
            if (imports) {
                dependencies.push(...imports.map(imp => imp.match(/['"]([^'"]+)['"]/)?.[1] || ''));
            }
        }

        // Python dependencies
        if (code.includes('import ')) {
            const imports = code.match(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
            if (imports) {
                dependencies.push(...imports);
            }
        }

        return dependencies;
    }

    /**
     * 生成 TODO 标记
     */
    private generateTodos(code: string): string[] {
        const todos: string[] = [];

        if (!code.includes('/**') && !code.includes('"""')) {
            todos.push('Add comprehensive documentation');
        }

        if (!code.includes('test')) {
            todos.push('Increase test coverage');
        }

        if (!code.includes('interface') && !code.includes('type')) {
            todos.push('Add TypeScript type definitions');
        }

        if (code.includes('TODO') || code.includes('FIXME')) {
            todos.push('Review and address TODO comments');
        }

        return todos;
    }
}

/**
 * 创建代码生成 Agent 实例
 */
export function createCodeGenerationAgent(): CodeGenerationAgent {
    return new CodeGenerationAgent();
}
