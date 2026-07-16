# Agent Harness Framework

完整的 Agent 可靠性工程框架（Phase 1）。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent Harness                           │
│  (Agent 执行器 - 生命周期管理、执行循环、协调服务)              │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Tool Executor  │  │  Agent Monitor  │  │ Error Recovery  │
│  (工具执行器)    │  │  (监控系统)      │  │  (错误恢复)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## 核心功能

### 1. Agent Harness (agent-harness.ts)
- Agent 生命周期管理
- Think → Act → Observe → Reflect 执行循环
- 状态管理和验证
- 协调所有服务

### 2. Tool Executor (tool-executor.ts)
- 工具注册和执行
- 重试机制（指数退避）
- 超时控制（默认 30 秒）
- 降级策略（fallback）

### 3. Agent Monitor (agent-monitor.ts)
- 执行轨迹记录
- 事件日志（think、action、error、complete）
- Token 跟踪
- 性能监控和统计

### 4. Error Recovery (error-recovery.ts)
- 错误分类（临时性、永久性、逻辑、资源）
- 恢复策略（重试、回滚、降级、跳过）
- 自动恢复和人工介入

## 使用示例

### 创建简单 Agent

```typescript
import {AgentImplementation, createAgentService, Task, ExecutionContext} from './services/agent/index.js';

// 1. 定义 Agent 实现
class MyAgent implements AgentImplementation {
  config = {
    id: 'my-agent',
    name: 'My Agent',
    description: 'A simple agent',
    tools: []
  };

  async think(context: ExecutionContext) {
    return {
      content: 'Analyzing current state...',
      confidence: 0.8
    };
  }

  async act(context: ExecutionContext, action: Action) {
    return { success: true, data: 'Action completed' };
  }

  async observe(context: ExecutionContext, result: Result) {
    return {
      result,
      quality: 0.9,
      needsImprovement: false
    };
  }

  async reflect(context: ExecutionContext, observation: Observation) {
    return {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      content: 'Task completed successfully',
      improvements: [],
      quality: observation.quality
    };
  }

  async decide(context: ExecutionContext): Promise<Action> {
    return {
      type: 'complete',
      parameters: {}
    };
  }

  getToolHandler(toolName: string) {
    return undefined;
  }
}

// 2. 使用 Agent
const service = createAgentService();
service.registerAgent(new MyAgent());

const result = await service.executeAgent('my-agent', {
  id: 'task-1',
  type: 'test',
  input: { message: 'Hello' },
  targetQuality: 0.8
});

console.log(`Success: ${result.success}, Quality: ${result.quality}`);
```

### 注册工具

```typescript
service.registerTool({
  name: 'search',
  description: 'Search the web',
  parameters: {
    query: { type: 'string', description: 'Search query' }
  },
  retryable: true,
  timeout: 10000,
  handler: async (params) => {
    // 实现搜索逻辑
    return { results: [] };
  }
});
```

## 执行循环

Agent 执行遵循 **Think → Act → Observe → Reflect** 循环：

1. **Think**：Agent 分析当前状态，决定下一步行动
2. **Act**：执行行动（调用工具或内部处理）
3. **Observe**：观察结果并评估质量
4. **Reflect**：反思经验，生成改进建议

循环持续直到：
- 质量达到目标阈值
- Token 预算耗尽
- 达到最大迭代次数
- 任务标记为完成

## 错误恢复

系统自动分类错误并执行恢复策略：

| 错误类型 | 恢复策略 |
|---------|---------|
| 临时性（网络超时） | 重试（指数退避） |
| 逻辑错误（参数错误） | 回滚状态 |
| 资源错误（内存不足） | 降级执行 |
| 超时错误 | 跳过或使用默认值 |
| 永久性（认证失败） | 人工介入 |

## 监控和调试

```typescript
// 获取统计信息
const stats = service.getStats('my-agent');
console.log(stats);
// {
//   totalTraces: 10,
//   completedTraces: 9,
//   failedTraces: 1,
//   totalTokensUsed: 45000,
//   averageQuality: 0.85,
//   averageDuration: 5234
// }

// 清理旧数据（1 小时前）
service.cleanup(3600000);
```

## 下一步

### Phase 2: Loop Engineering
- 自适应循环（根据质量调整策略）
- 成本优化循环
- 质量评估循环

### Phase 3: 专业 Agent 实现
- 需求分析 Agent
- 代码生成 Agent
- 测试 Agent
- Code Review Agent

## API 文档

完整类型定义见 `types.ts`。
