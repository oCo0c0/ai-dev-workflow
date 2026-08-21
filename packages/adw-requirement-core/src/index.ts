/**
 * @module @along/adw-requirement-core
 * @description adw 需求获取内核（自 ai-dev-workbench 抽取，ESM）：
 *   需求源适配器注册表 + MCP 桥接（纯传输层）+ MCP 配置（~/.claude）+ 需求存储 + 引擎门面。
 *   零 DSH 依赖 —— dsh-adw 插件与 adw 本体共用同一份语义。
 */

// === 引擎与存储 ===
export {RequirementEngine, renderDevPrompt, type FetchOptions, type EngineOptions} from './engine.js';
export {RequirementStore, mergeParsedIntoDescription, parseMarker, type ExecutionLink, type SavedRequirement, type ParsedAttachment} from './store.js';

// === 桥接与配置 ===
export {MCPBridgeService, type BridgeCallOptions, type RequirementSourceEntry, type MCPConfigSource} from './mcp-bridge.js';
export {MCPConfigService, type MCPServerConfig} from './mcp-config.js';

// === MinerU 文档解析 ===
export {
    MinerUClient,
    type MinerUBackend,
    type MinerUParseMethod,
    type MinerUParseOptions,
    type MinerUParseResult,
    type MinerUTaskStatus,
    type MinerUTaskSubmitResult,
} from './mineru-client.js';

// === 需求源适配器 ===
export {
    resolveAdapter,
    getAdapter,
    listAdapters,
    listCatalogAdapters,
    bindServer,
    unbindServer,
    registerRequirementSource,
} from './requirement-sources/index.js';
export type {
    RequirementSourceAdapter,
    Requirement,
    RequirementDetail,
    Attachment,
    RelatedIssue,
    AttachmentImageService,
    ToolCapability,
    EnvKeySpec,
    SourceInstallTemplate,
} from './requirement-sources/types.js';

// === 工具 ===
export {getErrorMessage} from './error-utils.js';
export {TIMEOUTS} from './constants.js';
