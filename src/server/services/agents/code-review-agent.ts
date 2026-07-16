/**
 * @file Code Review Agent
 * @description 代码审查 Agent - 审查代码质量、安全和最佳实践
 *
 * 核心功能：
 * 1. 代码审查 - 检查代码质量、安全性和最佳实践
 * 2. 问题检测 - 识别 bug、安全漏洞、性能问题
 * 3. 最佳实践验证 - 验证代码是否遵循最佳实践
 * 4. 改进建议 - 提供具体的改进建议
 * 5. 审查报告 - 生成详细的审查报告
 */

import {AgentImplementation} from '../agent';
import {ExecutionContext, Thought, Action, Result, Observation, Reflection} from '../agent';
import {CodeReviewResult} from './types.js';

/**
 * 代码审查 Agent 实现
 */
export class CodeReviewAgent implements AgentImplementation {
    config = {
        id: 'code-review-agent',
        name: 'Code Review Agent',
        description: 'Review code quality, security, and best practices',
        tools: [
            {
                name: 'analyze-quality',
                description: 'Analyze code quality metrics',
                parameters: {
                    code: {type: 'string', description: 'Code to review'},
                    language: {type: 'string', description: 'Programming language'}
                },
                retryable: true,
                timeout: 15000
            },
            {
                name: 'check-security',
                description: 'Check for security vulnerabilities',
                parameters: {
                    code: {type: 'string', description: 'Code to check'}
                },
                retryable: true,
                timeout: 10000
            },
            {
                name: 'verify-best-practices',
                description: 'Verify adherence to best practices',
                parameters: {
                    code: {type: 'string', description: 'Code to verify'},
                    language: {type: 'string', description: 'Programming language'}
                },
                retryable: true,
                timeout: 12000
            }
        ],
        maxExecutionTime: 90000,
        maxRetries: 3
    };

    async think(context: ExecutionContext): Promise<Thought> {
        const {state, task} = context;
        const iteration = state.iteration;

        if (iteration === 0) {
            return {
                content: 'Starting code review. Analyzing code quality...',
                nextAction: {
                    type: 'analyze-quality',
                    tool: 'analyze-quality',
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
                content: 'Quality analyzed. Checking for security issues...',
                nextAction: {
                    type: 'check-security',
                    tool: 'check-security',
                    parameters: {code: task.input.code}
                },
                confidence: 0.85
            };
        }

        if (iteration === 2) {
            return {
                content: 'Security checked. Verifying best practices...',
                nextAction: {
                    type: 'verify-best-practices',
                    tool: 'verify-best-practices',
                    parameters: {
                        code: task.input.code,
                        language: task.input.language || 'typescript'
                    }
                },
                confidence: 0.8
            };
        }

        return {
            content: 'Review complete. Compiling final report.',
            nextAction: {type: 'complete', parameters: {}},
            confidence: 0.95
        };
    }

    async act(context: ExecutionContext, action: Action): Promise<unknown> {
        switch (action.type) {
            case 'analyze-quality':
                return await this.analyzeQuality(action.parameters as { code: string; language?: string });
            case 'check-security':
                return await this.checkSecurity(action.parameters as { code: string });
            case 'verify-best-practices':
                return await this.verifyBestPractices(action.parameters as { code: string; language?: string });
            case 'complete':
                return await this.compileFinalResult(context);
            default:
                throw new Error(`Unknown action type: ${action.type}`);
        }
    }

    async observe(context: ExecutionContext, result: Result): Promise<Observation> {
        if (!result.success) {
            return {result, quality: 0, needsImprovement: true};
        }

        const quality = this.assessReviewQuality(result.data);
        const needsImprovement = quality < (context.task.targetQuality || 0.8);

        return {result, quality, needsImprovement};
    }

    async reflect(_context: ExecutionContext, observation: Observation): Promise<Reflection> {
        const improvements: Reflection['improvements'] = [];

        if (observation.needsImprovement) {
            improvements.push({
                type: 'quality-improvement',
                priority: 'high',
                description: 'Review quality needs improvement',
                action: {type: 'improve', parameters: {}}
            });
        }

        return {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            content: `Review quality: ${observation.quality.toFixed(2)}`,
            improvements,
            quality: observation.quality
        };
    }

    async decide(context: ExecutionContext): Promise<Action> {
        const {state, task} = context;
        const iteration = state.iteration;

        if (iteration === 0) {
            return {
                type: 'analyze-quality',
                tool: 'analyze-quality',
                parameters: {code: task.input.code, language: task.input.language}
            };
        }

        if (iteration === 1) {
            return {
                type: 'check-security',
                tool: 'check-security',
                parameters: {code: task.input.code}
            };
        }

        if (iteration === 2) {
            return {
                type: 'verify-best-practices',
                tool: 'verify-best-practices',
                parameters: {code: task.input.code, language: task.input.language}
            };
        }

        return {type: 'complete', parameters: {}};
    }

    getToolHandler(toolName: string): ((params: any) => Promise<any>) | undefined {
        switch (toolName) {
            case 'analyze-quality':
                return (params) => this.analyzeQuality(params);
            case 'check-security':
                return (params) => this.checkSecurity(params);
            case 'verify-best-practices':
                return (params) => this.verifyBestPractices(params);
            default:
                return undefined;
        }
    }

    private async analyzeQuality(params: { code: string; language?: string }): Promise<any[]> {
        const {code} = params;
        const findings: any[] = [];

        // 检查代码长度
        if (code.length < 50) {
            findings.push({
                type: 'style',
                severity: 'low',
                description: 'Code is very short, may need more implementation',
                location: {file: 'unknown', line: 1}
            });
        }

        // 检查命名规范
        if (/function\s+\d/.test(code)) {
            findings.push({
                type: 'best-practice',
                severity: 'medium',
                description: 'Function names should not start with numbers',
                location: {file: 'unknown'}
            });
        }

        // 检查注释
        if (!code.includes('//') && !code.includes('/**')) {
            findings.push({
                type: 'documentation',
                severity: 'low',
                description: 'Add comments to explain complex logic',
                location: {file: 'unknown'}
            });
        }

        // 检查错误处理
        if (!code.includes('try') && !code.includes('catch')) {
            findings.push({
                type: 'best-practice',
                severity: 'medium',
                description: 'Add error handling with try-catch',
                location: {file: 'unknown'}
            });
        }

        return findings;
    }

    private async checkSecurity(params: { code: string }): Promise<any[]> {
        const {code} = params;
        const findings: any[] = [];

        // 检查常见安全问题
        if (code.includes('eval(')) {
            findings.push({
                type: 'security',
                severity: 'critical',
                description: 'Avoid using eval() - potential security risk',
                location: {file: 'unknown'},
                suggestion: 'Use safer alternatives like JSON.parse() or object notation'
            });
        }

        if (code.includes('innerHTML')) {
            findings.push({
                type: 'security',
                severity: 'high',
                description: 'innerHTML can lead to XSS vulnerabilities',
                location: {file: 'unknown'},
                suggestion: 'Use textContent or sanitize inputs'
            });
        }

        if (code.includes('password') || code.includes('secret')) {
            findings.push({
                type: 'security',
                severity: 'critical',
                description: 'Hardcoded sensitive data detected',
                location: {file: 'unknown'},
                suggestion: 'Use environment variables or secure storage'
            });
        }

        if (code.includes('SQL') || code.includes('query')) {
            findings.push({
                type: 'security',
                severity: 'high',
                description: 'Potential SQL injection risk',
                location: {file: 'unknown'},
                suggestion: 'Use parameterized queries'
            });
        }

        return findings;
    }

    private async verifyBestPractices(params: { code: string; language?: string }): Promise<any[]> {
        const {code, language = 'typescript'} = params;
        const findings: any[] = [];

        // TypeScript/JavaScript 最佳实践
        if (language === 'typescript' || language === 'javascript') {
            if (!code.includes('const') && !code.includes('let')) {
                findings.push({
                    type: 'best-practice',
                    severity: 'medium',
                    description: 'Use const or let instead of var',
                    location: {file: 'unknown'}
                });
            }

            if (code.includes('var ')) {
                findings.push({
                    type: 'best-practice',
                    severity: 'low',
                    description: 'Avoid using var',
                    location: {file: 'unknown'}
                });
            }

            if (code.includes('== ') && !code.includes('===')) {
                findings.push({
                    type: 'best-practice',
                    severity: 'medium',
                    description: 'Use === for strict equality',
                    location: {file: 'unknown'}
                });
            }
        }

        // 通用最佳实践
        if (code.length > 500 && !code.includes('function') && !code.includes('=>')) {
            findings.push({
                type: 'best-practice',
                severity: 'medium',
                description: 'Consider breaking large code into smaller functions',
                location: {file: 'unknown'}
            });
        }

        if (code.includes('console.log') && !code.includes('console.error')) {
            findings.push({
                type: 'style',
                severity: 'low',
                description: 'Remove debug console.log statements',
                location: {file: 'unknown'}
            });
        }

        return findings;
    }

    private assessReviewQuality(data: any): number {
        if (!data || !Array.isArray(data)) return 0;

        let score = 0.5;

        const criticalCount = data.filter((f: any) => f.severity === 'critical').length;
        const highCount = data.filter((f: any) => f.severity === 'high').length;

        if (criticalCount === 0) score += 0.2;
        if (highCount <= 2) score += 0.1;
        if (data.length >= 5) score += 0.1;
        if (data.some((f: any) => f.suggestion)) score += 0.1;

        return Math.min(score, 1.0);
    }

    private async compileFinalResult(context: ExecutionContext): Promise<CodeReviewResult> {
        const {state} = context;

        const qualityFindings = (state.history[0]?.result.data as any[]) || [];
        const securityFindings = (state.history[1]?.result.data as any[]) || [];
        const practiceFindings = (state.history[2]?.result.data as any[]) || [];

        const allFindings = [...qualityFindings, ...securityFindings, ...practiceFindings];

        const criticalCount = allFindings.filter((f: any) => f.severity === 'critical').length;
        const highCount = allFindings.filter((f: any) => f.severity === 'high').length;

        let status: 'approved' | 'needs-changes' | 'rejected' = 'approved';
        if (criticalCount > 0) {
            status = 'rejected';
        } else if (highCount > 2 || criticalCount > 0) {
            status = 'needs-changes';
        }

        const score = Math.max(0, 100 - (criticalCount * 30) - (highCount * 10) - (allFindings.length * 2));

        const bySeverity: Record<string, number> = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0
        };

        const byType: Record<string, number> = {};

        for (const finding of allFindings) {
            bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
            byType[finding.type] = (byType[finding.type] || 0) + 1;
        }

        const positives: string[] = [];
        if (criticalCount === 0) positives.push('No critical security issues found');
        if (bySeverity.high <= 2) positives.push('Few high-severity issues');
        if (bySeverity.medium <= 5) positives.push('Acceptable number of medium-severity issues');

        const recommendations: string[] = [];
        if (criticalCount > 0) recommendations.push('Address critical security issues immediately');
        if (highCount > 2) recommendations.push('Review and fix high-severity issues');
        if (bySeverity.medium > 5) recommendations.push('Consider addressing medium-severity issues');

        return {
            score: Math.round(score),
            status,
            findings: allFindings,
            stats: {
                total: allFindings.length,
                bySeverity,
                byType
            },
            recommendations,
            positives
        };
    }
}

export function createCodeReviewAgent(): CodeReviewAgent {
    return new CodeReviewAgent();
}
