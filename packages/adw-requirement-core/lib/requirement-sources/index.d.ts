/**
 * @module requirement-sources
 * @description 需求源适配器注册表（热插拔）
 *
 * 管理所有需求源适配器的注册、查询和自动路由。
 * 与 cli-providers 同构：strategy + registry + 工厂注册。
 *
 * 扩展方式：调用 registerRequirementSource(() => new YourAdapter()) 注册一行，
 * 无需修改 MCPBridgeService、路由或前端。
 *
 * 适配器路由规则（resolveAdapter）：
 * 1. 按 serverName 精确绑定（bindServer 显式指定，优先级最高）
 * 2. 按注册顺序询问各适配器 matchServer(config) 自动认领
 * 3. 都不认领 → generic 兜底适配器
 */
import type { MCPServerConfig } from '../mcp-config.js';
import type { RequirementSourceAdapter } from './types.js';
/** 适配器工厂：返回适配器实例（适配器应保持无状态，可安全共享） */
type AdapterFactory = () => RequirementSourceAdapter;
/**
 * 注册一个需求源适配器
 * @param factory - 返回适配器实例的工厂函数
 */
export declare function registerRequirementSource(factory: AdapterFactory): void;
/**
 * 显式绑定 MCP server 到适配器
 * @description 优先级最高：用于自动认领误判时的人工纠偏
 */
export declare function bindServer(serverName: string, adapterId: string): void;
/** 解除显式绑定 */
export declare function unbindServer(serverName: string): void;
/**
 * 获取指定 id 的适配器（含 generic）
 */
export declare function getAdapter(id: string): RequirementSourceAdapter | undefined;
/**
 * 列出所有已注册适配器（含 generic，按注册顺序）
 */
export declare function listAdapters(): RequirementSourceAdapter[];
/**
 * 列出源目录适配器（不含 generic 兜底）
 * @description 目录是平台能力的外显：前端源选择器只展示这些，
 *   generic 是运行时对未知 server 的容错，不作为可选源推荐。
 */
export declare function listCatalogAdapters(): RequirementSourceAdapter[];
/**
 * 为 MCP server 配置解析适配器
 * @description 路由规则见模块注释；config 为空时返回 generic
 */
export declare function resolveAdapter(serverName: string, config: MCPServerConfig | undefined): RequirementSourceAdapter;
export type { RequirementSourceAdapter, Requirement, RequirementDetail, Attachment, RelatedIssue, AttachmentImageService, ToolCapability, EnvKeySpec, SourceInstallTemplate, } from './types.js';
export { mapJsonToRequirement, mapJsonToDetailBase, parseMarkdownRequirementList } from './parsers.js';
//# sourceMappingURL=index.d.ts.map