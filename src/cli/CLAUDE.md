[根目录](../../CLAUDE.md) > [src](./) > **cli**

# CLI 模块

## 模块职责

命令行入口模块，负责加载配置、查找端口、启动 HTTP/WebSocket 服务。`adw` 命令即为此模块编译后的产物。

## 入口与启动

- **入口**：`index.ts` -- `startCLI()` 异步主函数
- **编译**：由 `tsconfig.server.json` 编译，输出到 `dist/cli/`
- **bin 命令**：`package.json` 中 `"bin": { "adw": "./dist/cli/index.js" }`

## 启动流程

1. `ensureConfigDir()` -- 确保 `~/.ai-dev-workbench/` 目录存在
2. `loadConfig()` -- 从 `~/.ai-dev-workbench/config.json` 读取端口配置
3. `findAvailablePort({preferredPort})` -- 查找可用端口（支持端口偏好）
4. `createServer(port)` -- 创建并启动 Express + WebSocket 服务（来自 `server/index.ts`）
5. `printBanner(port, version)` -- 打印启动横幅
6. 注册 SIGINT/SIGTERM 优雅关闭

## 对外接口

无对外导出。仅作为 CLI 启动入口。

## 关键依赖与配置

- 依赖 `server/index.ts` 的 `createServer()` 函数
- 配置目录：`~/.ai-dev-workbench/`
- 端口默认：自动查找可用端口（优先使用配置文件中的 `server.port`）

## 相关文件清单

```
src/cli/
  index.ts        # CLI 入口主函数
  banner.ts       # 启动横幅打印
  port-finder.ts  # 可用端口查找
```

## 变更记录 (Changelog)

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-07-21 | 创建 | 初始化模块文档 |
