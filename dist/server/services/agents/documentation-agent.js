"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentationAgent = void 0;
exports.createDocumentationAgent = createDocumentationAgent;
/**
 * 文档生成 Agent 实现
 */
class DocumentationAgent {
    config = {
        id: 'documentation-agent',
        name: 'Documentation Agent',
        description: 'Generate high-quality documentation from code and requirements',
        tools: [
            {
                name: 'analyze-code',
                description: 'Analyze code structure for documentation',
                parameters: {
                    code: { type: 'string', description: 'Code to analyze' },
                    language: { type: 'string', description: 'Programming language' }
                },
                retryable: true,
                timeout: 15000
            },
            {
                name: 'generate-api-doc',
                description: 'Generate API documentation',
                parameters: {
                    code: { type: 'string', description: 'Code with API definitions' }
                },
                retryable: true,
                timeout: 20000
            },
            {
                name: 'generate-readme',
                description: 'Generate README documentation',
                parameters: {
                    projectInfo: { type: 'object', description: 'Project information' },
                    features: { type: 'array', description: 'Feature list' }
                },
                retryable: true,
                timeout: 15000
            }
        ],
        maxExecutionTime: 120000,
        maxRetries: 3
    };
    async think(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                content: 'Starting documentation generation. Analyzing code structure...',
                nextAction: {
                    type: 'analyze-code',
                    tool: 'analyze-code',
                    parameters: {
                        code: task.input.code,
                        language: task.input.language || 'typescript'
                    }
                },
                confidence: 0.9
            };
        }
        if (iteration === 1) {
            return {
                content: 'Code analyzed. Generating documentation based on analysis...',
                nextAction: {
                    type: task.input.docType || 'generate-readme',
                    tool: task.input.docType || 'generate-readme',
                    parameters: task.input.parameters || {}
                },
                confidence: 0.85
            };
        }
        return {
            content: 'Documentation generation complete.',
            nextAction: { type: 'complete', parameters: {} },
            confidence: 0.95
        };
    }
    async act(context, action) {
        switch (action.type) {
            case 'analyze-code':
                return await this.analyzeCode(action.parameters);
            case 'generate-api-doc':
                return await this.generateAPIDoc(action.parameters);
            case 'generate-readme':
                return await this.generateREADME(action.parameters);
            case 'complete':
                return await this.compileFinalResult(context);
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }
    async observe(context, result) {
        if (!result.success) {
            return { result, quality: 0, needsImprovement: true };
        }
        const quality = await this.assessDocQuality(result.data);
        const needsImprovement = quality < (context.task.targetQuality || 0.8);
        return { result, quality, needsImprovement };
    }
    async reflect(_context, observation) {
        const improvements = [];
        if (observation.needsImprovement) {
            improvements.push({
                type: 'enhance-documentation',
                priority: 'high',
                description: 'Documentation quality needs improvement',
                action: { type: 'improve', parameters: {} }
            });
        }
        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Documentation quality: ${observation.quality.toFixed(2)}.`,
            improvements,
            quality: observation.quality
        };
    }
    async decide(context) {
        const { state, task } = context;
        const iteration = state.iteration;
        if (iteration === 0) {
            return {
                type: 'analyze-code',
                tool: 'analyze-code',
                parameters: {
                    code: task.input.code,
                    language: task.input.language || 'typescript'
                }
            };
        }
        if (iteration === 1) {
            return {
                type: task.input.docType || 'generate-readme',
                tool: task.input.docType || 'generate-readme',
                parameters: task.input.parameters || {}
            };
        }
        return { type: 'complete', parameters: {} };
    }
    getToolHandler(toolName) {
        switch (toolName) {
            case 'analyze-code':
                return (params) => this.analyzeCode(params);
            case 'generate-api-doc':
                return (params) => this.generateAPIDoc(params);
            case 'generate-readme':
                return (params) => this.generateREADME(params);
            default:
                return undefined;
        }
    }
    /**
     * 分析代码结构
     */
    async analyzeCode(params) {
        const { code, language = 'typescript' } = params;
        const structure = {
            language,
            lines: code.split('\n').length,
            hasClasses: code.includes('class '),
            hasFunctions: code.includes('function ') || code.includes('=> '),
            hasExports: code.includes('export'),
            hasTypes: code.includes('interface ') || code.includes('type ')
        };
        const exports = [];
        const exportMatches = code.match(/export\s+(?:class|function|interface|type|const)\s+(\w+)/g);
        if (exportMatches) {
            exports.push(...exportMatches.map((match, name) => ({ type: match, name })));
        }
        const classes = [];
        const classMatches = code.match(/class\s+(\w+)/g);
        if (classMatches) {
            classes.push(...classMatches.map((name) => ({ name })));
        }
        const functions = [];
        if (language === 'typescript' || language === 'javascript') {
            const functionMatches = code.match(/(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*=>)/g);
            if (functionMatches) {
                functions.push(...functionMatches.filter(f => f).map((name) => ({ name })));
            }
        }
        let complexity = 'low';
        if (classes.length > 5 || functions.length > 10)
            complexity = 'medium';
        if (classes.length > 10 || functions.length > 20)
            complexity = 'high';
        return { structure, exports, classes, functions, complexity };
    }
    /**
     * 生成API文档
     */
    async generateAPIDoc(params) {
        const { code } = params;
        let doc = `# API Documentation\n\n`;
        doc += `Generated by Documentation Agent\n\n`;
        // 提取API定义
        if (code.includes('export') && (code.includes('function') || code.includes('class'))) {
            doc += `## Available APIs\n\n`;
            // 简单的API提取逻辑
            const apiMatches = code.match(/export\s+(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+))/g);
            if (apiMatches) {
                for (const match of apiMatches) {
                    const name = match.replace(/export\s+/, '').trim();
                    doc += `### ${name}\n\n`;
                    doc += `**Description:** Exported ${name.includes('class') ? 'class' : 'function'}\n\n`;
                    doc += `\`\`\`typescript\n// Usage example\nimport { ${name} } from './module';\n\`\`\`\n\n`;
                }
            }
        }
        // 添加类型定义
        if (code.includes('interface')) {
            doc += `## Type Definitions\n\n`;
            const interfaceMatches = code.match(/interface\s+(\w+)\s*{([^}]*)}/g);
            if (interfaceMatches) {
                for (const match of interfaceMatches) {
                    const name = match[1];
                    doc += `### ${name}\n\n`;
                    doc += `\`\`\`typescript\n${name} ${match[2]}\n\`\`\`\n\n`;
                }
            }
        }
        return doc;
    }
    /**
     * 生成README文档
     */
    async generateREADME(params) {
        const { projectInfo = {}, features = [] } = params;
        let readme = `# ${projectInfo.name || 'Project'}\n\n`;
        readme += `${projectInfo.description || 'Project description'}\n\n`;
        if (features.length > 0) {
            readme += `## Features\n\n`;
            for (const feature of features) {
                readme += `- ${feature.name || feature}: ${feature.description || 'Feature description'}\n`;
            }
            readme += '\n';
        }
        readme += `## Installation\n\n`;
        readme += `\`\`\`bash\nnpm install\n\`\`\`\n\n`;
        readme += `## Usage\n\n`;
        readme += `\`\`\`typescript\nimport { MyModule } from './module';\n\n// Usage example\nconst instance = new MyModule();\ninstance.doSomething();\n\`\`\`\n\n`;
        readme += `## Documentation\n\n`;
        readme += `For more detailed documentation, please see the [API Documentation](./docs/API.md).\n\n`;
        readme += `## License\n\n`;
        readme += `MIT\n`;
        return readme;
    }
    /**
     * 编译最终结果
     */
    async compileFinalResult(context) {
        const { state } = context;
        const lastResult = state.history[state.history.length - 1]?.result.data;
        return {
            success: true,
            documentation: lastResult || 'Documentation generated successfully',
            format: 'markdown',
            quality: state.quality,
            sections: ['Overview', 'Installation', 'Usage', 'API', 'License']
        };
    }
    /**
     * 评估文档质量
     */
    async assessDocQuality(data) {
        if (!data)
            return 0;
        let score = 0.5;
        // 检查必需章节
        const sections = ['Installation', 'Usage', 'API', 'License'];
        const hasSections = sections.filter(section => data.toLowerCase().includes(section.toLowerCase()));
        score += (hasSections.length / sections.length) * 0.3;
        // 检查代码示例
        if (data.includes('```'))
            score += 0.2;
        // 检查标题层级
        const headings = (data.match(/#+\s/g) || []).length;
        if (headings >= 3)
            score += 0.2;
        // 检查链接
        if (data.includes('[') && data.includes(']'))
            score += 0.1;
        // 检查长度
        if (data.length > 200)
            score += 0.1;
        if (data.length > 500)
            score += 0.1;
        return Math.min(score, 1.0);
    }
}
exports.DocumentationAgent = DocumentationAgent;
/**
 * 创建文档生成 Agent 实例
 */
function createDocumentationAgent() {
    return new DocumentationAgent();
}
//# sourceMappingURL=documentation-agent.js.map