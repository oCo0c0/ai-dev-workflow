/**
 * @module @along/adw-requirement-core
 * @description adw 需求获取内核（自 ai-dev-workbench 抽取，ESM）：
 *   agent 中介需求拉取（标准 MCP 消费模式，零源硬编码）+ MCP 桥接（纯传输层）
 *   + MCP 配置（自管）+ 需求存储 + 引擎门面。
 *   零 DSH 依赖 —— dsh-adw 插件与 adw 本体共用同一份语义。
 */
export { RequirementEngine, renderDevPrompt, type FetchOptions, type EngineOptions } from './engine.js';
export { RequirementStore, mergeParsedIntoDescription, parseMarker, type ExecutionLink, type SavedRequirement, type ParsedAttachment } from './store.js';
export { AgentFetchService, buildFetchPrompt, buildSearchPrompt, type AgentLlm, type AgentChat, type AgentContentBlock, type AgentToolDef, type AgentTurnResult, type AgentFetchOptions, } from './agent-fetch.js';
export { MCPBridgeService, type BridgeCallOptions, type MCPConfigSource, type ServerToolInfo } from './mcp-bridge.js';
export { MCPConfigService, type MCPServerConfig } from './mcp-config.js';
export { createAttachmentImageService } from './ones-image-service.js';
export { MinerUClient, type MinerUBackend, type MinerUParseMethod, type MinerUParseOptions, type MinerUParseResult, type MinerUTaskStatus, type MinerUTaskSubmitResult, } from './mineru-client.js';
export type { Requirement, RequirementDetail, Attachment, RelatedIssue, AttachmentImageService } from './requirement-sources/index.js';
export { mapJsonToRequirement, mapJsonToDetailBase, parseStringArray, parseAttachments, parseRelatedIssues, } from './requirement-sources/index.js';
export { getErrorMessage } from './error-utils.js';
export { TIMEOUTS } from './constants.js';
//# sourceMappingURL=index.d.ts.map