/**
 * @file model-provider-types.ts
 * @description 模型供应商配置的前端类型定义
 *
 * 与后端 `src/server/services/model-provider-types.ts` 对应，
 * 但只包含前端需要的「脱敏安全视图」与接口响应结构。
 * API Key 明文绝不从后端下发，前端仅拿到 hasApiKey + apiKeyMasked。
 */

/** 模型供应商种类 */
export type ModelProviderKind = 'claude' | 'codex' | 'pi' | 'custom';

/** 记录来源 */
export type ModelProviderSource = 'external' | 'manual' | 'builtin';

/**
 * 供应商记录的脱敏安全视图（后端下发格式）
 */
export interface SafeModelProviderRecord {
    id: string;
    kind: ModelProviderKind;
    label: string;
    enabled: boolean;
    /** 是否已配置 API Key */
    hasApiKey: boolean;
    /** API Key 掩码（如 sk-…abcd） */
    apiKeyMasked?: string;
    baseUrl?: string;
    env?: Record<string, string>;
    models: string[];
    defaultModel?: string;
    source: ModelProviderSource;
    importedFrom?: string;
    importedAt?: string;
    updatedAt: string;
}

/** 外部数据源标识 */
export type ExternalSourceId = 'claude' | 'codex' | 'pi';

/** 外部数据源检测结果 */
export interface ExternalSourceStatus {
    source: ExternalSourceId;
    label: string;
    available: boolean;
    paths: string[];
    providerCount?: number;
    error?: string;
}

/** 导入结果摘要 */
export interface ImportSummary {
    imported: string[];
    skipped: ExternalSourceId[];
    total: number;
}

/** GET /model-providers 响应 */
export interface ModelProvidersListResponse {
    providers: SafeModelProviderRecord[];
    file: string;
}

/** GET /model-providers/detect 响应 */
export interface DetectResponse {
    sources: ExternalSourceStatus[];
}

/** POST /model-providers/import 响应 */
export interface ImportResponse {
    success: boolean;
    summary: ImportSummary;
    providers: SafeModelProviderRecord[];
}

/** POST /model-providers 响应 */
export interface UpsertResponse {
    success: boolean;
    provider: SafeModelProviderRecord;
}
