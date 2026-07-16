# Professional Agents System

完整的专业化 Agent 系统（Phase 3）。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                   Agents Service                               │
│              (统一管理 - 任务执行、工作流编排)                    │
└─────────────────────────────────────────────────────────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────┐ ┌──────────────┐
│ Requirement     │ │   Code         │ │    Test      │ │  Code Review │
│ Analysis Agent  │ │ Generation     │ │   Agent      │ │   Agent      │
│ (需求分析)       │ │   Agent        │ │  (测试)       │ │  (代码审查)    │
└─────────────────┘ └───────────────┘ └─────────────┘ └──────────────┘
```

## 专业 Agent

### 1. Requirement Analysis Agent（需求分析 Agent）

**功能：**
- 深度分析需求内容和结构
- 识别需求中的歧义、矛盾、缺失信息
- 生成可测试的验收标准
- 提供技术建议和实现方案
- 评估复杂度和工作量

**使用示例：**
```typescript
const service = createAgentsService();

const result = await service.executeAgent({
    agentType: 'requirement-analysis',
    taskId: 'req-001',
    inputData: {
        requirement: 'Implement user authentication with JWT tokens',
        title: 'User Authentication'
    },
    options: {
        targetQuality: 0.85,
        tokenBudget: 8000
    }
});

console.log(result.result);
// {
//   requirementId: 'req-001',
//   analysis: {
//     type: 'feature',
//     complexity: 'medium',
//     recommendedPriority: 'high',
//     estimatedHours: 16
//   },
//   ambiguities: [...],
//   acceptanceCriteria: [...]
// }
```

### 2. Code Generation Agent（代码生成 Agent）

**功能：**
- 根据需求生成高质量代码
- 遵循项目规范和最佳实践
- 使用质量循环优化代码
- 自动生成单元测试
- 生成代码文档

**使用示例：**
```typescript
const result = await service.executeAgent({
    agentType: 'code-generation',
    taskId: 'code-001',
    inputData: {
        requirement: 'Create a user authentication handler',
        language: 'typescript',
        filePath: 'src/auth/AuthHandler.ts'
    },
    options: {
        targetQuality: 0.9,
        tokenBudget: 15000
    }
});

console.log(result.result);
// {
//   code: 'class AuthHandler { ... }',
//   filePath: 'src/auth/AuthHandler.ts',
//   quality: {
//     completeness: 0.85,
//     conventionAdherence: 0.9
//   },
//   tests: [...],
//   documentation: '...'
// }
```

### 3. Test Agent（测试 Agent）

**功能：**
- 自动生成测试用例
- 执行测试并收集结果
- 分析代码覆盖率
- 生成测试报告
- 优化测试质量

**使用示例：**
```typescript
const result = await service.executeAgent({
    agentType: 'test',
    taskId: 'test-001',
    inputData: {
        code: 'class UserHandler { ... }',
        language: 'typescript',
        suiteName: 'UserHandler Tests'
    },
    options: {
        targetQuality: 0.85,
        tokenBudget: 10000
    }
});

console.log(result.result);
// {
//   suiteName: 'UserHandler Tests',
//   testCases: [...],
//   coverage: {
//     statements: 85,
//     branches: 78,
//     functions: 90,
//     lines: 85
//   },
//   stats: {
//     total: 12,
//     passed: 10,
//     failed: 2
//   }
// }
```

### 4. Code Review Agent（代码审查 Agent）

**功能：**
- 检查代码质量
- 检测安全漏洞
- 验证最佳实践
- 提供改进建议
- 生成审查报告

**使用示例：**
```typescript
const result = await service.executeAgent({
    agentType: 'code-review',
    taskId: 'review-001',
    inputData: {
        code: 'class Handler { ... }',
        language: 'typescript'
    },
    options: {
        targetQuality: 0.8,
        tokenBudget: 5000
    }
});

console.log(result.result);
// {
//   score: 85,
//   status: 'needs-changes',
//   findings: [...],
//   stats: {
//     total: 8,
//     bySeverity: { critical: 0, high: 2, medium: 4, low: 2 }
//   },
//   recommendations: [...]
// }
```

## Agent 工作流

多 Agent 协作完成复杂任务：

```typescript
const workflowConfig: AgentWorkflowConfig = {
    workflowId: 'feature-development',
    name: 'Feature Development Workflow',
    agents: [
        {
            type: 'requirement-analysis',
            order: 1,
            required: true,
            outputMapping: {
                analysis: 'requirementAnalysis',
                acceptanceCriteria: 'acceptanceCriteria'
            }
        },
        {
            type: 'code-generation',
            order: 2,
            required: true,
            inputMapping: {
                requirement: 'acceptanceCriteria'
            }
        },
        {
            type: 'test',
            order: 3,
            required: true,
            inputMapping: {
                code: 'generatedCode'
            }
        },
        {
            type: 'code-review',
            order: 4,
            required: false,
            inputMapping: {
                code: 'generatedCode'
            }
        }
    ],
    globalConfig: {
        targetQuality: 0.85,
        tokenBudget: 30000
    }
};

const workflowResult = await service.executeWorkflow(workflowConfig);

console.log(`Workflow ${workflowResult.workflowId}:`);
console.log(`Success: ${workflowResult.success}`);
console.log(`Duration: ${workflowResult.totalDuration}ms`);
console.log(`Tokens: ${workflowResult.totalTokensUsed}`);
```

## Agent 能力对比

| Agent | 输入 | 输出 | Token 消耗 | 执行时间 |
|-------|------|------|-----------|---------|
| Requirement Analysis | 需求文本 | 分析报告、验收标准 | ~3000 | 10-15s |
| Code Generation | 需求描述 | 代码、测试、文档 | ~8000 | 20-30s |
| Test | 代码 | 测试用例、覆盖率报告 | ~5000 | 15-20s |
| Code Review | 代码 | 审查报告、改进建议 | ~2000 | 10-15s |

## 集成 Phase 1 和 Phase 2

所有专业 Agent 都集成了：
- **Phase 1（Harness Engineering）**：可靠的执行、错误恢复、监控
- **Phase 2（Loop Engineering）**：质量循环、成本优化、自适应策略

### 质量循环集成

```typescript
// Code Generation Agent 自动使用质量循环优化代码
const config: LoopConfig = {
    targetQuality: 0.9,
    tokenBudget: 10000,
    qualityEvaluator: async (code) => assessCodeQuality(code)
};

const optimizedCode = await loopService.executeQualityLoop(
    config,
    async (improvements) => applyImprovements(code, improvements)
);
```

### 成本优化集成

```typescript
// 自动选择最具成本效益的策略
const result = await loopService.executeCostOptimization(
    { targetQuality: 0.8, tokenBudget: 5000 },
    async (plan) => executePlan(plan)
);
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Agent System                                │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Agent Harness (Phase 1)                │     │
│  │  - Reliable execution                               │     │
│  │  - Error recovery                                   │     │
│  │  - Monitoring and tracing                           │     │
│  └────────────────────────────────────────────────────┘     │
│                            │                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │              Loop System (Phase 2)                   │     │
│  │  - Quality optimization                             │     │
│  │  - Cost optimization                                │     │
│  │  - Adaptive strategies                              │     │
│  └────────────────────────────────────────────────────┘     │
│                            │                                  │
│  ┌────────────────────────────────────────────────────┐     │
│  │         Professional Agents (Phase 3)               │     │
│  │  - Requirement Analysis                             │     │
│  │  - Code Generation                                  │     │
│  │  - Test                                             │     │
│  │  - Code Review                                      │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────┘
```

## 下一步

### 集成现有服务
- 与 MCP Bridge 集成（外部工具调用）
- 与 Workspace Service 集成（项目管理）
- 与 CLI Runner 集成（代码执行）

### 扩展 Agent 类型
- Documentation Agent（文档生成）
- Refactoring Agent（代码重构）
- Performance Optimization Agent（性能优化）
- Security Audit Agent（安全审计）

## API 文档

完整类型定义见 `types.ts`。
