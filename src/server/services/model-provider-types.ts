/**
 * @module model-provider-types
 * @description 模型供应商配置的类型定义与常量
 *
 * 定义本项目自有模型供应商配置体系的核心数据结构，供
 * model-provider-store（存储）、model-provider-import（导入）、
 * 以及路由层共同使用。避免循环依赖。
 */

/** 模型供应商种类 */
export type ModelProviderKind = 'claude' | 'codex' | 'pi' | 'custom';

/** 记录来源：external=外部 CLI 导入 / manual=用户手动添加 / builtin=内置 */
export type ModelProviderSource = 'external' | 'manual' | 'builtin';

/**
 * 单个模型供应商配置记录
 *
 * 统一承载 API Key、Base URL、可用模型列表等字段。
 * apiKey 在磁盘上为密文，内存中（读取出）为明文，序列化输出到 API 时会被脱敏。
 */
export interface ModelProviderRecord {
    /** 唯一标识。claude/codex 直接使用 kind，pi 使用 `pi:<provider>`，custom 可自定义 */
    id: string;
    /** 供应商种类 */
    kind: ModelProviderKind;
    /** 显示名称 */
    label: string;
    /** 是否启用 */
    enabled: boolean;
    /** API Key（磁盘密文，内存明文） */
    apiKey?: string;
    /** API Base URL */
    baseUrl?: string;
    /** 额外环境变量（如中转代理、组织 ID 等） */
    env?: Record<string, string>;
    /** 可用模型列表 */
    models: string[];
    /** 默认模型 */
    defaultModel?: string;
    /** 记录来源 */
    source: ModelProviderSource;
    /** 外部导入来源描述（如 ~/.claude/settings.json） */
    importedFrom?: string;
    /** 导入时间（ISO 8601） */
    importedAt?: string;
    /** 最后更新时间（ISO 8601） */
    updatedAt: string;
}

/** models.json 文件根结构 */
export interface ModelProvidersFile {
    /** 文件结构版本，便于未来迁移 */
    version: 1;
    /** 供应商记录数组 */
    providers: ModelProviderRecord[];
}

/**
 * 供应商可写输入（创建/更新时）。
 *
 * models / env 为可选：值为 undefined 表示「不修改该字段」，由 store.upsert 保留旧值，
 * 避免 API 部分更新误清空已有配置；创建时缺省分别回落为 [] / 不设置。
 */
export type ModelProviderInput = Omit<ModelProviderRecord, 'models' | 'env' | 'updatedAt'> & {
    models?: string[];
    env?: Record<string, string>;
    updatedAt?: string;
};

/** 外部数据源标识 */
export type ExternalSourceId = 'claude' | 'codex' | 'pi';

/**
 * 外部数据源检测结果
 */
export interface ExternalSourceStatus {
    /** 数据源标识 */
    source: ExternalSourceId;
    /** 显示名称 */
    label: string;
    /** 是否可用（目录/文件存在且内容合法） */
    available: boolean;
    /** 检测到的配置文件路径 */
    paths: string[];
    /** 解析出的供应商数量 */
    providerCount?: number;
    /** 不可用时的原因 */
    error?: string;
}

/**
 * 导入结果摘要
 */
export interface ImportSummary {
    /** 成功导入/更新的记录 ID */
    imported: string[];
    /** 跳过的数据源（不存在或不合法） */
    skipped: ExternalSourceId[];
    /** 导入后自有配置文件中的供应商总数 */
    total: number;
}

/**
 * 外部数据源导入优先级（高 → 低）
 * 高优先级覆盖低优先级的同名配置项。
 */
export const IMPORT_PRIORITY: readonly ExternalSourceId[] = ['claude', 'codex', 'pi'];
