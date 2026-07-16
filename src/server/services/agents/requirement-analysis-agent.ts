/**
 * @file Requirement Analysis Agent
 * @description 需求分析 Agent - 深度分析需求，识别歧义，生成验收标准
 *
 * 核心功能：
 * 1. 需求分析 - 识别需求类型、复杂度、优先级
 * 2. 歧义检测 - 发现需求中的不明确、矛盾、缺失之处
 * 3. 验收标准生成 - 基于需求生成可测试的验收标准
 * 4. 技术建议 - 提供实现方案和技术选型建议
 * 5. 工作量评估 - 估算开发时间和复杂度
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
import {RequirementAnalysisResult} from './types.js';

/**
 * 需求分析 Agent 实现
 */
export class RequirementAnalysisAgent implements AgentImplementation {
    config = {
        id: 'requirement-analysis-agent',
        name: 'Requirement Analysis Agent',
        description: 'Deep analysis of requirements, identifying ambiguities and generating acceptance criteria',
        tools: [
            {
                name: 'analyze-requirement',
                description: 'Analyze requirement content and structure',
                parameters: {
                    requirement: {type: 'string', description: 'Requirement text to analyze'}
                },
                retryable: true,
                timeout: 10000
            },
            {
                name: 'detect-ambiguities',
                description: 'Detect ambiguities, contradictions, and missing information',
                parameters: {
                    text: {type: 'string', description: 'Text to analyze for ambiguities'}
                },
                retryable: true,
                timeout: 8000
            },
            {
                name: 'generate-criteria',
                description: 'Generate acceptance criteria from requirements',
                parameters: {
                    requirement: {type: 'string', description: 'Requirement description'},
                    type: {type: 'string', description: 'Requirement type'}
                },
                retryable: true,
                timeout: 10000
            }
        ],
        maxExecutionTime: 120000,
        maxRetries: 3
    };

    /**
     * Think：分析当前状态并决定下一步
     */
    async think(context: ExecutionContext): Promise<Thought> {
        const {state, task} = context;
        const iteration = state.iteration;

        // 第一次迭代：分析需求
        if (iteration === 0) {
            return {
                content: 'Starting requirement analysis. First, analyze the requirement structure and type.',
                nextAction: {
                    type: 'analyze',
                    tool: 'analyze-requirement',
                    parameters: {
                        requirement: task.input.requirement
                    }
                },
                confidence: 0.9
            };
        }

        // 第二次迭代：检测歧义
        if (iteration === 1) {
            return {
                content: 'Requirement analyzed. Now detecting ambiguities and missing information.',
                nextAction: {
                    type: 'detect-ambiguities',
                    tool: 'detect-ambiguities',
                    parameters: {
                        text: task.input.requirement
                    }
                },
                confidence: 0.85
            };
        }

        // 第三次迭代：生成验收标准
        if (iteration === 2) {
            return {
                content: 'Ambiguities detected. Now generating acceptance criteria.',
                nextAction: {
                    type: 'generate-criteria',
                    tool: 'generate-criteria',
                    parameters: {
                        requirement: task.input.requirement,
                        type: (state.history[0]?.result.data as any)?.type || 'feature'
                    }
                },
                confidence: 0.8
            };
        }

        // 完成分析
        return {
            content: 'Analysis complete. Compiling final result.',
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
            case 'analyze':
                return await this.analyzeRequirement(action.parameters as { requirement: string });
            case 'detect-ambiguities':
                return await this.detectAmbiguities(action.parameters as { text: string });
            case 'generate-criteria':
                return await this.generateAcceptanceCriteria(action.parameters as {
                    requirement: string;
                    type?: string
                });
            case 'complete':
                return await this.compileFinalResult(context);
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    /**
     * Observe：观察行动结果
     */
    async observe(_context: ExecutionContext, result: Result): Promise<Observation> {
        if (!result.success) {
            return {
                result,
                quality: 0,
                needsImprovement: true
            };
        }

        // 评估结果质量
        const quality = this.assessResultQuality(result.data);
        const needsImprovement = quality < 0.8;

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
                description: 'Result quality needs improvement',
                action: {
                    type: 'refine',
                    parameters: {}
                }
            });
        }

        if (context.state.iteration < 3 && observation.quality < 0.9) {
            improvements.push({
                type: 'continue-analysis',
                priority: 'medium',
                description: 'Continue with next analysis step',
                action: {
                    type: 'continue',
                    parameters: {}
                }
            });
        }

        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Analysis quality: ${observation.quality.toFixed(2)}. ${improvements.length} improvements identified.`,
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

        // 最多3次迭代
        if (iteration >= 3) {
            return {
                type: 'complete',
                parameters: {}
            };
        }

        if (iteration === 0) {
            return {
                type: 'analyze',
                tool: 'analyze-requirement',
                parameters: {requirement: task.input.requirement}
            };
        }

        if (iteration === 1) {
            return {
                type: 'detect-ambiguities',
                tool: 'detect-ambiguities',
                parameters: {text: task.input.requirement}
            };
        }

        if (iteration === 2) {
            return {
                type: 'generate-criteria',
                tool: 'generate-criteria',
                parameters: {requirement: task.input.requirement}
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
            case 'analyze-requirement':
                return (params) => this.analyzeRequirement(params);
            case 'detect-ambiguities':
                return (params) => this.detectAmbiguities(params);
            case 'generate-criteria':
                return (params) => this.generateAcceptanceCriteria(params);
            default:
                return undefined;
        }
    }

    /**
     * 分析需求
     */
    private async analyzeRequirement(params: { requirement: string }): Promise<{
        type: 'feature' | 'bugfix' | 'enhancement' | 'refactoring';
        complexity: 'low' | 'medium' | 'high';
        recommendedPriority: 'low' | 'medium' | 'high';
        estimatedHours: number;
        technologies: string[];
        risks: string[];
    }> {
        const requirement = params.requirement.toLowerCase();

        // 分析需求类型
        let type: 'feature' | 'bugfix' | 'enhancement' | 'refactoring' = 'feature';
        if (requirement.includes('bug') || requirement.includes('fix') || requirement.includes('error')) {
            type = 'bugfix';
        } else if (requirement.includes('improve') || requirement.includes('enhance') || requirement.includes('optimize')) {
            type = 'enhancement';
        } else if (requirement.includes('refactor') || requirement.includes('restructure') || requirement.includes('reorganize')) {
            type = 'refactoring';
        }

        // 评估复杂度
        let complexity: 'low' | 'medium' | 'high' = 'medium';
        const text = params.requirement;
        if (text.length < 100) {
            complexity = 'low';
        } else if (text.length > 500 || text.includes('complex') || text.includes('integrate')) {
            complexity = 'high';
        }

        // 建议优先级
        let recommendedPriority: 'low' | 'medium' | 'high' = 'medium';
        if (type === 'bugfix' || requirement.includes('urgent') || requirement.includes('critical')) {
            recommendedPriority = 'high';
        } else if (type === 'enhancement' && complexity === 'low') {
            recommendedPriority = 'low';
        }

        // 估算时间
        const baseHours = complexity === 'low' ? 4 : complexity === 'medium' ? 16 : 40;
        const estimatedHours = type === 'bugfix' ? baseHours * 0.7 : baseHours;

        // 识别技术栈
        const technologies = this.identifyTechnologies(params.requirement);

        // 识别风险
        const risks = this.identifyRisks(params.requirement, complexity, type);

        return {
            type,
            complexity,
            recommendedPriority,
            estimatedHours,
            technologies,
            risks
        };
    }

    /**
     * 检测歧义
     */
    private async detectAmbiguities(params: { text: string }): Promise<Array<{
        content: string;
        type: 'unclear' | 'missing' | 'contradictory' | 'incomplete';
        questions: string[];
    }>> {
        const text = params.text;
        const ambiguities: Array<{ content: string; type: any; questions: string[] }> = [];

        // 检测不清晰的术语
        const unclearPatterns = [
            {pattern: /good|better|improved|fast|slow/i},
            {pattern: /user-friendly|easy to use|intuitive/i},
            {pattern: /appropriate|suitable|reasonable/i}
        ];

        for (const {pattern} of unclearPatterns) {
            const matches = text.match(pattern);
            if (matches) {
                ambiguities.push({
                    content: matches[0],
                    type: 'unclear',
                    questions: [
                        `What are the specific criteria for "${matches[0]}"?`,
                        `How will "${matches[0]}" be measured or tested?`
                    ]
                });
            }
        }

        // 检测缺失信息
        if (!text.includes('when') && !text.includes('condition')) {
            ambiguities.push({
                content: 'Preconditions or trigger conditions',
                type: 'missing',
                questions: [
                    'What conditions trigger this requirement?',
                    'Are there any preconditions?'
                ]
            });
        }

        if (!text.includes('error') && !text.includes('fail')) {
            ambiguities.push({
                content: 'Error handling',
                type: 'missing',
                questions: [
                    'How should errors be handled?',
                    'What happens when the operation fails?'
                ]
            });
        }

        // 检测矛盾（简单示例）
        if (text.includes('fast') && text.includes('comprehensive')) {
            ambiguities.push({
                content: 'Performance vs. completeness trade-off',
                type: 'contradictory',
                questions: [
                    'Is speed or completeness more important?',
                    'What are the acceptable performance metrics?'
                ]
            });
        }

        return ambiguities;
    }

    /**
     * 生成验收标准
     */
    private async generateAcceptanceCriteria(params: {
        requirement: string;
        type?: string;
    }): Promise<string[]> {
        const {requirement: _requirement, type = 'feature'} = params;
        const criteria: string[] = [];

        // 基础验收标准
        criteria.push(`Given the system is in the initial state`);
        criteria.push(`When the user action described in the requirement is performed`);
        criteria.push(`Then the expected outcome should be achieved`);

        // 根据类型添加特定标准
        if (type === 'bugfix') {
            criteria.push('The bug is fixed and no longer occurs');
            criteria.push('No side effects are introduced');
            criteria.push('The fix is tested with edge cases');
        } else if (type === 'feature') {
            criteria.push('The feature works as specified');
            criteria.push('User interface is responsive and user-friendly');
            criteria.push('Data persistence is correct');
        } else if (type === 'enhancement') {
            criteria.push('Performance is improved measurably');
            criteria.push('Existing functionality remains intact');
            criteria.push('User experience is enhanced');
        }

        // 添加质量标准
        criteria.push('Code quality meets team standards');
        criteria.push('Test coverage is at least 80%');
        criteria.push('Documentation is updated');

        return criteria;
    }

    /**
     * 编译最终结果
     */
    private async compileFinalResult(context: ExecutionContext): Promise<RequirementAnalysisResult> {
        const {task, state} = context;

        // 从历史中提取结果
        const analysis = state.history[0]?.result.data as any;
        const ambiguities = (state.history[1]?.result.data as any[]) || [];
        const acceptanceCriteria = (state.history[2]?.result.data as string[]) || [];

        // 生成技术建议
        const technicalSuggestions = this.generateTechnicalSuggestions(task.input.requirement as string, analysis);

        // 识别依赖项
        const dependencies = this.identifyDependencies(task.input.requirement as string);

        return {
            requirementId: task.id,
            title: (task.input.title as string) || 'Untitled Requirement',
            description: (task.input.requirement as string) || '',
            analysis: analysis || {
                type: 'feature',
                complexity: 'medium',
                recommendedPriority: 'medium',
                estimatedHours: 16,
                technologies: [],
                risks: []
            },
            ambiguities: ambiguities || [],
            acceptanceCriteria: acceptanceCriteria || [],
            technicalSuggestions,
            dependencies
        };
    }

    /**
     * 识别技术栈
     */
    private identifyTechnologies(text: string): string[] {
        const technologies: string[] = [];
        const techKeywords = {
            'frontend': ['react', 'vue', 'angular', 'typescript', 'javascript', 'css', 'html'],
            'backend': ['node', 'python', 'java', 'go', 'rust', 'api', 'server'],
            'database': ['sql', 'mongodb', 'postgres', 'redis', 'database', 'orm'],
            'cloud': ['aws', 'azure', 'docker', 'kubernetes', 'cloud']
        };

        const lowerText = text.toLowerCase();

        for (const [tech, keywords] of Object.entries(techKeywords)) {
            if (keywords.some(keyword => lowerText.includes(keyword))) {
                technologies.push(tech);
            }
        }

        return technologies;
    }

    /**
     * 识别风险
     */
    private identifyRisks(text: string, complexity: string, type: string): string[] {
        const risks: string[] = [];

        if (complexity === 'high') {
            risks.push('High complexity may lead to extended development time');
            risks.push('Increased risk of bugs and integration issues');
        }

        if (text.includes('integration') || text.includes('api')) {
            risks.push('Integration risks with external systems');
            risks.push('API compatibility and versioning concerns');
        }

        if (text.includes('performance') || text.includes('scale')) {
            risks.push('Performance may not meet requirements under load');
            risks.push('Scalability challenges may arise');
        }

        if (type === 'bugfix') {
            risks.push('Fix may introduce side effects');
            risks.push('Root cause may not be fully addressed');
        }

        return risks;
    }

    /**
     * 生成技术建议
     */
    private generateTechnicalSuggestions(requirement: string, analysis: any): string[] {
        const suggestions: string[] = [];

        // 基于需求内容生成特定建议
        if (requirement.toLowerCase().includes('performance')) {
            suggestions.push('Consider performance monitoring and profiling tools');
            suggestions.push('Implement caching mechanisms for frequently accessed data');
        }

        if (requirement.toLowerCase().includes('security') || requirement.toLowerCase().includes('authentication')) {
            suggestions.push('Implement proper authentication and authorization mechanisms');
            suggestions.push('Use HTTPS and secure coding practices');
            suggestions.push('Add input validation and sanitization');
        }

        if (requirement.toLowerCase().includes('api') || requirement.toLowerCase().includes('integration')) {
            suggestions.push('Design RESTful API with proper versioning');
            suggestions.push('Implement API documentation and examples');
            suggestions.push('Add rate limiting and error handling');
        }

        if (analysis?.technologies?.includes('frontend')) {
            suggestions.push('Consider using component-based architecture for better maintainability');
            suggestions.push('Implement responsive design for cross-device compatibility');
        }

        if (analysis?.technologies?.includes('backend')) {
            suggestions.push('Implement proper error handling and logging');
            suggestions.push('Use caching strategies for performance optimization');
        }

        if (analysis?.complexity === 'high') {
            suggestions.push('Consider breaking down into smaller, manageable tasks');
            suggestions.push('Implement comprehensive testing strategy');
        }

        suggestions.push('Follow SOLID principles for code organization');
        suggestions.push('Implement CI/CD pipeline for automated testing and deployment');

        return suggestions;
    }

    /**
     * 识别依赖项
     */
    private identifyDependencies(text: string): string[] {
        const dependencies: string[] = [];

        // 简单依赖检测（实际实现会更复杂）
        if (text.includes('API') || text.includes('service')) {
            dependencies.push('External API or service integration');
        }

        if (text.includes('database') || text.includes('data')) {
            dependencies.push('Database schema and migrations');
        }

        if (text.includes('authentication') || text.includes('authorization')) {
            dependencies.push('Authentication and authorization system');
        }

        return dependencies;
    }

    /**
     * 评估结果质量
     */
    private assessResultQuality(data: any): number {
        if (!data) return 0;

        let score = 0.5;

        // 检查必需字段
        if (data.type) score += 0.1;
        if (data.complexity) score += 0.1;
        if (data.estimatedHours) score += 0.1;
        if (Array.isArray(data.technologies)) score += 0.1;
        if (Array.isArray(data.risks)) score += 0.1;

        return Math.min(score, 1.0);
    }
}

/**
 * 创建需求分析 Agent 实例
 */
export function createRequirementAnalysisAgent(): RequirementAnalysisAgent {
    return new RequirementAnalysisAgent();
}
