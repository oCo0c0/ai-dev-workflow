[根目录](../../CLAUDE.md) > [src](./) > **bridge**

# Bridge 模块

## 模块职责

Claude Agent SDK 桥接进程，作为独立子进程运行。封装 `@anthropic-ai/claude-agent-sdk`，采用持久模式：从 stdin 逐行读取 JSON 请求，向 stdout 逐行写入 JSON 响应。

## 入口与启动

- **入口**：`claude-bridge.mjs` -- ESM 格式，直接由 Node.js 执行
- **启动方式**：由 `ClaudeProvider`（`cli-providers/claude-provider.ts`）通过 `child_process.spawn` 启动
- **构建**：`build:bridge` 脚本直接复制到 `dist/bridge/claude-bridge.mjs`

## 通信协议

### 请求格式（stdin，每行一个 JSON）

```json
{ "requestId": "...", "prompt": "...", "cwd": "...", "sessionId": "...", "maxTurns": 10, "skills": [...], "mcpServers": {...}, "model": "...", "reasoningEffort": "high", "extendedThinking": true }
```

### 响应格式（stdout，每个请求对应多条 JSON 行）

| type | 说明 |
|------|------|
| `ready` | 桥接进程就绪信号（启动时发送一次） |
| `session` | 会话标识（`sessionId`） |
| `output` | AI 输出文本 |
| `thinking` | AI 思考过程 |
| `tool_use` | 工具调用事件（toolName、toolInput、toolUseId） |
| `tool_result` | 工具结果（toolUseId、isError、content） |
| `done` | 请求完成（exitCode: 0） |
| `error` | 错误信息 |

**通知归属**：查询期的所有通知（session/output/thinking/tool_use/tool_result/permission_required）都带
`params.requestId` = 发起该查询的 `agent.execute` 的 JSON-RPC id；`params.sessionId` 为**该次查询**的会话 id
（每次查询局部状态，不再跨查询共享）。父进程按 requestId 精确路由事件，sessionId 仅作兜底；
`agent.abort` 支持 `params.requestId` 按请求粒度中止（缺省中止全部活动查询）。

### 529 限流处理

指数退避重试（1s/2s/4s，封顶 8s），最多 3 次。每次重试会重新启动 Claude CLI 子进程。

## 关键特性

- **会话续接**：通过 `sessionId` 恢复已有对话上下文
- **结构化事件透传**：解析 SDK 的 `thinking`、`tool_use`、`tool_result` 事件并透传给调用方
- **模型/参数配置**：支持 `model`、`reasoningEffort`、`extendedThinking` 参数
- **MCP 服务器注入**：支持通过 `mcpServers` 注入 MCP 服务器配置
- **自动压缩**：通过 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 环境变量控制上下文窗口大小
- **诊断日志**：可选的轻量调试日志写入 `D:\bridge-debug.log`

## 对外接口

无代码导出。通过 stdin/stdout JSON 行协议通信。

## 相关文件清单

```
src/bridge/
  claude-bridge.mjs   # 唯一文件，完整的桥接进程实现
```

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-09-24 | 修复 | 通知作用域化（工具行永久转圈的根因之一）：① 查询期通知统一经 `emitQueryNotification` 附加 `params.requestId`（发起查询的 JSON-RPC id），父进程据此精确路由；② `sessionId` 由模块级全局变量改为**每次查询局部状态**（并发/续接查询不再串线），`waitForRetry` 与查询响应回传该查询的 sessionId；③ 活动查询改为 `activeQueries` 表（requestId → AbortController），`agent.abort` 支持按 requestId 精确中止，`canUseTool` 同样带 requestId。真实 SDK 实测：并行 3 个 Bash → 3 tool_use/3 tool_result 全配对、每条通知带 requestId；被中断的在飞工具 6s 内 0 结果（证实「中断必须由服务端收敛」） |
| 2026-07-21 | 创建 | 初始化模块文档 |
