/**
 * @module model-provider-import
 * @description 外部 CLI 配置检测与导入模块
 *
 * 按优先级（Claude > Codex > Pi）自动检测用户本地的 CLI 配置目录/文件，
 * 读取其中的模型供应商信息（API Key / Base URL / 模型列表），并生成
 * 可供自有配置体系使用的 ModelProviderRecord。
 *
 * 检测规则：
 * - 目录/文件存在且内容合法 → 读取
 * - 不存在或不合法 → 跳过，不影响其他数据源
 * - 多数据源并存 → 高优先级覆盖低优先级同名配置项
 *
 * 只读：本模块绝不写入或删除外部 CLI 的原始配置文件。
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    IMPORT_PRIORITY,
    type ExternalSourceId,
    type ExternalSourceStatus,
    type ModelProviderRecord,
} from './model-provider-types.js';

// === 路径常量 ===

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const CODEX_DIR = path.join(HOME, '.codex');
const CODEX_CONFIG = path.join(CODEX_DIR, 'config.toml');
const CODEX_AUTH = path.join(CODEX_DIR, 'auth.json');
const PI_AGENT_DIR = path.join(HOME, '.pi', 'agent');
const PI_AUTH = path.join(PI_AGENT_DIR, 'auth.json');
const PI_MODELS_STORE = path.join(PI_AGENT_DIR, 'models-store.json');

/** 现在时间（ISO 8601），用于导入/更新时间戳 */
function now(): string {
    return new Date().toISOString();
}

/** 读取并解析 JSON 文件，失败返回 null */
function readJson(file: string): unknown | null {
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return null;
    }
}

// === 最小 TOML 解析（仅用于读取 Codex config.toml） ===

interface TomlSection {
    /** 顶层键值 */
    top: Record<string, unknown>;
    /** [section] 表 */
    tables: Record<string, Record<string, unknown>>;
}

function parseToml(content: string): TomlSection {
    const result: TomlSection = {top: {}, tables: {}};
    let currentSection: Record<string, unknown> | null = null;

    for (const rawLine of content.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        // 数组表头 [[x]] 本场景用不到，跳过
        const tableMatch = line.match(/^\[([^\]]+)\]$/);
        if (tableMatch) {
            const key = tableMatch[1].trim();
            currentSection = result.tables[key] ?? (result.tables[key] = {});
            continue;
        }

        const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.+)$/);
        if (!kvMatch) continue;
        const [, key, rawVal] = kvMatch;
        const val = parseTomlValue(rawVal.trim());
        if (currentSection) currentSection[key] = val;
        else result.top[key] = val;
    }
    return result;
}

function parseTomlValue(raw: string): unknown {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    const dq = raw.match(/^"(.*)"$/);
    if (dq) return dq[1];
    const sq = raw.match(/^'(.*)'$/);
    if (sq) return sq[1];
    return raw;
}

/** 取字符串值 */
function asString(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

// === Claude ===

function readClaudeExternal(): ModelProviderRecord | undefined {
    const settings = readJson(CLAUDE_SETTINGS) as { env?: Record<string, string> } | null;
    const env: Record<string, string> = {};
    if (settings?.env && typeof settings.env === 'object') {
        for (const [k, v] of Object.entries(settings.env)) {
            if (typeof v === 'string') env[k] = v;
        }
    }

    // API Key 优先从 settings.json env，其次从进程环境变量（CLI 常见注入方式）
    const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || undefined;
    const baseUrl = env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || undefined;

    // 模型列表：三个档位 + 显式 model
    const models: string[] = [];
    for (const key of ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL']) {
        const m = asString(env[key]);
        if (m && !models.includes(m)) models.push(m);
    }
    const explicit = asString(env.ANTHROPIC_MODEL);
    if (explicit && !models.includes(explicit)) models.push(explicit);

    // 判断是否「合法」：至少要有 API Key 或模型/Base URL 之一
    const hasContent = apiKey || baseUrl || models.length > 0;
    if (!hasContent) return undefined;

    return {
        id: 'claude',
        kind: 'claude',
        label: 'Claude Code',
        enabled: true,
        apiKey,
        baseUrl,
        models,
        defaultModel: models[0],
        source: 'external',
        importedFrom: CLAUDE_SETTINGS,
        importedAt: now(),
        updatedAt: now(),
    };
}

// === Codex ===

function readCodexExternal(): ModelProviderRecord | undefined {
    let toml: TomlSection | null = null;
    if (fs.existsSync(CODEX_CONFIG)) {
        try {
            toml = parseToml(fs.readFileSync(CODEX_CONFIG, 'utf-8'));
        } catch {
            toml = null;
        }
    }

    const top = toml?.top ?? {};
    const model = asString(top.model);
    const modelProvider = asString(top.model_provider) ?? asString(top.modelProvider) ?? 'openai';

    // base_url / env_key 可能定义在 [model_providers.<name>] 段
    let baseUrl: string | undefined;
    let envKey: string | undefined;
    const providerTable = toml?.tables[`model_providers.${modelProvider}`];
    if (providerTable) {
        baseUrl = asString(providerTable.base_url) ?? asString(providerTable.baseUrl);
        envKey = asString(providerTable.env_key) ?? asString(providerTable.envKey);
    }
    if (!baseUrl) baseUrl = process.env.OPENAI_BASE_URL || undefined;

    // API Key：优先环境变量（配置的 env_key 或通用 OPENAI_API_KEY），其次 auth.json
    let apiKey: string | undefined;
    if (envKey) apiKey = process.env[envKey];
    if (!apiKey) apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        const auth = readJson(CODEX_AUTH) as Record<string, unknown> | null;
        if (auth) {
            const direct = auth.OPENAI_API_KEY;
            if (typeof direct === 'string' && direct) apiKey = direct;
            // Codex 新版 auth.json 用 {tokens: {...}}，尝试提取第一个字符串 token
            if (!apiKey && auth.tokens && typeof auth.tokens === 'object') {
                const tokens = auth.tokens as Record<string, unknown>;
                const first = Object.values(tokens).find((v): v is string => typeof v === 'string' && !!v);
                if (first) apiKey = first;
            }
        }
    }

    const models: string[] = [];
    if (model && !models.includes(model)) models.push(model);

    const hasContent = apiKey || baseUrl || models.length > 0;
    if (!hasContent) return undefined;

    return {
        id: 'codex',
        kind: 'codex',
        label: 'OpenAI Codex',
        enabled: true,
        apiKey,
        baseUrl,
        models,
        defaultModel: model,
        source: 'external',
        importedFrom: CODEX_CONFIG,
        importedAt: now(),
        updatedAt: now(),
    };
}

// === Pi ===

function readPiExternal(): ModelProviderRecord[] {
    const auth = readJson(PI_AUTH) as Record<string, unknown> | null;
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return [];

    // 读取 models-store.json 中按 provider 缓存的模型目录
    const modelsStore = readJson(PI_MODELS_STORE) as Record<string, {
        models?: Array<{ id?: string; name?: string }>
    }> | null;

    const records: ModelProviderRecord[] = [];

    for (const [providerId, rawCred] of Object.entries(auth)) {
        if (!rawCred || typeof rawCred !== 'object' || Array.isArray(rawCred)) continue;
        const cred = rawCred as { type?: string; key?: string; env?: Record<string, string> };
        // 仅导入带明文 key 的 api_key 凭据；oauth 或命令型 key 不导入
        if (cred.type !== 'api_key' || typeof cred.key !== 'string' || !cred.key.trim()) continue;

        const modelList = (modelsStore?.[providerId]?.models ?? [])
            .map((m) => m.id ?? m.name ?? '')
            .filter((id): id is string => !!id);

        records.push({
            id: `pi:${providerId}`,
            kind: 'pi',
            label: providerId,
            enabled: true,
            apiKey: cred.key,
            baseUrl: undefined,
            models: modelList,
            defaultModel: modelList[0],
            source: 'external',
            importedFrom: PI_AUTH,
            importedAt: now(),
            updatedAt: now(),
        });
    }

    return records;
}

// === 检测与读取 ===

/**
 * 检测外部 CLI 配置源
 * 对每个数据源做存在性 + 合法性检查，返回检测结果。
 */
export function detectExternalSources(): ExternalSourceStatus[] {
    const results: ExternalSourceStatus[] = [];

    for (const source of IMPORT_PRIORITY) {
        if (source === 'claude') {
            const record = readClaudeExternal();
            results.push({
                source: 'claude',
                label: 'Claude CLI',
                available: !!record,
                paths: fs.existsSync(CLAUDE_SETTINGS) ? [CLAUDE_SETTINGS] : [],
                providerCount: record ? 1 : 0,
                error: record ? undefined : '未检测到合法配置（~/.claude/settings.json 或环境变量）',
            });
        } else if (source === 'codex') {
            const record = readCodexExternal();
            results.push({
                source: 'codex',
                label: 'Codex CLI',
                available: !!record,
                paths: fs.existsSync(CODEX_CONFIG) ? [CODEX_CONFIG] : [],
                providerCount: record ? 1 : 0,
                error: record ? undefined : '未检测到合法配置（~/.codex/config.toml）',
            });
        } else {
            const records = readPiExternal();
            results.push({
                source: 'pi',
                label: 'Pi CLI',
                available: records.length > 0,
                paths: fs.existsSync(PI_AUTH) ? [PI_AUTH] : [],
                providerCount: records.length,
                error: records.length > 0 ? undefined : '未检测到合法配置（~/.pi/agent/auth.json）',
            });
        }
    }

    return results;
}

/**
 * 读取所有外部数据源，按优先级（高 → 低）返回供应商记录。
 * apiKey 为明文，由存储层负责加密后落盘。
 */
export function readExternalProviders(): ModelProviderRecord[] {
    const records: ModelProviderRecord[] = [];

    for (const source of IMPORT_PRIORITY) {
        if (source === 'claude') {
            const r = readClaudeExternal();
            if (r) records.push(r);
        } else if (source === 'codex') {
            const r = readCodexExternal();
            if (r) records.push(r);
        } else {
            records.push(...readPiExternal());
        }
    }

    return records;
}

/**
 * 同 id 外部记录融合：仅用本次检测到的非空字段覆盖旧值。
 *
 * 外部检测是「部分视图」——某次启动时可能因环境变量/配置文件不完整而检测不到
 * apiKey / baseUrl / models，直接 {...prev, ...inc} 会用 undefined / 空数组
 * 把已有配置清空。因此只对非空字段做覆盖，空字段保留旧值（不删除既有数据）。
 */
function mergeExternalRecord(prev: ModelProviderRecord, inc: ModelProviderRecord): ModelProviderRecord {
    return {
        ...prev,
        ...inc,
        apiKey: inc.apiKey && inc.apiKey.trim() !== '' ? inc.apiKey : prev.apiKey,
        baseUrl: inc.baseUrl && inc.baseUrl.trim() !== '' ? inc.baseUrl : prev.baseUrl,
        defaultModel: inc.defaultModel && inc.defaultModel.trim() !== ''
            ? inc.defaultModel
            : prev.defaultModel,
        models: inc.models && inc.models.length > 0 ? inc.models : prev.models,
        env: inc.env && Object.keys(inc.env).length > 0 ? {...prev.env, ...inc.env} : prev.env,
        // 保留本次导入时间戳与来源
        importedAt: inc.importedAt ?? prev.importedAt,
        importedFrom: inc.importedFrom ?? prev.importedFrom,
        updatedAt: now(),
    };
}

/**
 * 融合外部导入记录到已有外部记录中。
 *
 * 融合策略：
 * - 增量叠加：不同 id 的记录全部保留
 * - 高优先级覆盖低优先级：incoming 已按优先级排序，同 id 先到者（高优先级）胜出，
 *   后到者（低优先级）不覆盖已声明的字段
 * - 已有但本次未重新检测到的外部记录保留（不删除）
 * - 同 id 更新仅覆盖本次检测到的非空字段，避免部分检测清空已有配置
 *
 * @param existing - 文件中已有的外部（source === 'external'）记录
 * @param incoming - 本次检测到的外部记录（已按优先级高→低排序）
 */
export function mergeExternalProviders(
    existing: ModelProviderRecord[],
    incoming: ModelProviderRecord[],
): ModelProviderRecord[] {
    const map = new Map<string, ModelProviderRecord>();

    // 先放入已有外部记录（保留历史，避免删除）
    for (const rec of existing) {
        map.set(rec.id, rec);
    }

    // 本次导入已声明的 id（用于实现「高优先级覆盖低优先级」）
    const claimed = new Set<string>();

    for (const inc of incoming) {
        if (claimed.has(inc.id)) continue; // 已被更高优先级数据源声明
        claimed.add(inc.id);

        const prev = map.get(inc.id);
        map.set(inc.id, prev ? mergeExternalRecord(prev, inc) : inc);
    }

    return Array.from(map.values());
}
