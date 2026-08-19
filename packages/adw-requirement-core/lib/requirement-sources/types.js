/**
 * @module requirement-sources/types
 * @description 需求源适配器抽象接口（热插拔）
 *
 * 每个外部需求管理系统（ONES / GitHub Issues / Jira / ...）实现一个适配器，
 * 声明自己的输入方言、MCP 工具解析规则、响应格式解析和附件认证策略。
 * MCP 传输层（MCPBridgeService）只负责连接与调用，所有语义由适配器提供。
 *
 * 扩展方式：实现本接口 + 在 index.ts 注册一行工厂，无需修改任何调用方。
 */
export {};
//# sourceMappingURL=types.js.map