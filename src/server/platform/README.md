# 平台层（Platform）

引擎无关的 agent 平台内核。本目录的代码**不依赖任何具体引擎**（Claude/Codex/Pi），
各引擎的专属概念由 `services/cli-providers/` 下的适配层翻译。

## 设计原则

1. **平台中立**：内核类型（工具/分类）不出现任何引擎的工具名、事件名。
2. **单一事实来源**：MCP 清单来自 `MCPRegistryService`（`~/.ai-dev-workbench/mcp-servers.json`），
   会话存于 `~/.ai-dev-workbench/pi-sessions/`，均不侵入各引擎自己的配置目录。
3. **一份定义，多引擎投影**：工具只定义一次（`PlatformToolDefinition`），
   按引擎投影（pi → customTools；Claude → MCP 网关聚合端点）。

## 模块

| 模块 | 职责 |
| --- | --- |
| `types.ts` | 内核类型：`ToolCategory` / `PlatformToolDefinition` / `PlatformToolSchema` / `PlatformToolResult` |
| `tool-catalog.ts` | 工具名 → 分类目录（`classifyToolName` / `isStepWorthyTool`），编排层按分类决策，不硬编码引擎工具名 |
| `tool-registry.ts` | 平台原生工具注册表 + pi 投影（`toPiCustomTool`） |
| `mcp-gateway.ts` | MCP 聚合网关：上游连接管理（懒连接/崩溃重连）、HTTP 暴露（Streamable HTTP 无状态）、引擎投影 |

## MCP 统一管理（网关）

```
MCPRegistryService（清单）          PlatformToolRegistry（原生工具）
        │                                    │
        ▼                                    ▼
   ┌────────────── McpGateway ──────────────┐
   │  上游连接池（stdio spawn、懒连接、重连）  │
   └──────────┬──────────────────┬──────────┘
              │                  │
   HTTP /api/mcp（Claude）  /api/platform REST（pi）
   （Streamable HTTP，        （模型直接调用，
    server 白名单经 query      工具执行回流平台）
    ?servers=a,b 过滤）
```

- **Claude 引擎消费**：`resolveMcpServerMap()` 优先返回
  `{adw-platform: {type:'http', url}}`，SDK 以 HTTP MCP client 挂载；
  pipeline 的 per-phase 选择语义由 `?servers=` 白名单保留。
  网关未启动（测试环境）时回退旧的 stdio 直挂。
- **pi 引擎消费**：pi 以 RPC 子进程形态接入（`cli-providers/pi-rpc-process.ts`），
  `resources/pi-extensions/adw-platform.ts` 在子进程内经
  `GET /api/platform/tools` 拉取工具目录并 `pi.registerTool()` 注册，
  执行时 `POST /api/platform/call` 回流网关（统一超时/熔断/重连）。
  `asPiCustomTools()` 投影为旧 SDK 嵌入形态保留（当前无调用方）。
- **pi 权限协议**：扩展 `tool_call` + `ui.confirm` → RPC
  `extension_ui_request(confirm)` ↔ `extension_ui_response`，
  由 `PiProvider` 与前端弹窗协议互转；调用方未接权限回调时
  `ADW_PERMISSION_MODE=auto-allow` 自动放行（对齐 Claude bridge 语义）。
- **Windows 兼容**：上游 spawn 统一经 `cmd /c` 归一化（`normalizeWindowsCommand`）。

## 扩展指南

- **新增平台原生工具**：实现 `PlatformToolDefinition` 并注册到
  `getPlatformToolRegistry()`，两个引擎立即可用。
- **新增引擎**：实现 `CLIProvider` 接口并在 `cli-providers/index.ts` 注册；
  MCP 消费方式二选一（HTTP 挂载或工具投影），权限走 `onPermissionRequest` /
  `confirmPermission` 协议。
- **新增工具分类**：在 `tool-catalog.ts` 的映射表补充工具名，
  编排层（步骤面板/权限策略）按分类自动生效。
