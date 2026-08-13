/**
 * @module model-provider-store
 * @description 自有模型供应商配置存储服务
 *
 * 本项目独立的模型供应商配置入口，统一读写 `~/.ai-dev-workbench/models.json`。
 * 参考 pi 项目的 CredentialStore / ModelsStore 模式（JSON 文件后端 + 按 provider 键索引），
 * 但简化为单文件、单表结构，并额外负责：
 * - API Key 的 AES-256-GCM 加密落盘 / 解密读取
 * - 外部 CLI 配置的自动导入（增量叠加、高优先级覆盖低优先级）
 * - 对外输出的脱敏（listSafe/getSafe 不返回明文 API Key）
 */

import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';
import {
    decryptSecret,
    encryptSecret,
    getOrCreateSecretKeyFromFile,
    isEncrypted,
} from '../utils/crypto-utils.js';
import {
    detectExternalSources,
    mergeExternalProviders,
    readExternalProviders,
} from './model-provider-import.js';
import type {
    ExternalSourceStatus,
    ImportSummary,
    ModelProviderInput,
    ModelProviderRecord,
    ModelProvidersFile,
} from './model-provider-types.js';

/** 对外暴露的安全视图：apiKey 被脱敏为布尔标记 + 掩码 */
export interface SafeModelProviderRecord {
    id: string;
    kind: ModelProviderRecord['kind'];
    label: string;
    enabled: boolean;
    /** 是否已配置 API Key */
    hasApiKey: boolean;
    /** API Key 掩码（如 sk-…abcd），未配置时为 undefined */
    apiKeyMasked?: string;
    baseUrl?: string;
    env?: Record<string, string>;
    models: string[];
    defaultModel?: string;
    source: ModelProviderRecord['source'];
    importedFrom?: string;
    importedAt?: string;
    updatedAt: string;
}

/** 掩码显示：保留前 4 位与后 4 位，其余用 … 替代 */
function maskApiKey(key: string): string {
    if (key.length <= 8) return `${key.slice(0, 2)}…`;
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * 模型供应商配置存储服务
 */
export class ModelProviderStore {
    /** 自有配置文件绝对路径 */
    private readonly file: string;
    /** 加密密钥文件绝对路径 */
    private readonly secretFile: string;

    /**
     * @param configDir - 可选，配置目录，默认为 ~/.ai-dev-workbench
     */
    constructor(configDir?: string) {
        const dir = configDir ?? APP_DATA_DIR;
        this.file = path.join(dir, 'models.json');
        this.secretFile = path.join(dir, '.secret-key');
    }

    /** 配置文件路径 */
    getFile(): string {
        return this.file;
    }

    /** 确保目录存在 */
    private ensureDir(): void {
        const dir = path.dirname(this.file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
    }

    /** 读取密钥（不存在则创建） */
    private getKey(): Buffer {
        return getOrCreateSecretKeyFromFile(this.secretFile);
    }

    /** 加载整份文件，容错返回空结构 */
    private loadFile(): ModelProvidersFile {
        if (!fs.existsSync(this.file)) return {version: 1, providers: []};
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as ModelProvidersFile;
            if (!parsed || !Array.isArray(parsed.providers)) return {version: 1, providers: []};
            return parsed;
        } catch {
            return {version: 1, providers: []};
        }
    }

    /** 保存整份文件 */
    private saveFile(data: ModelProvidersFile): void {
        this.ensureDir();
        fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf-8');
    }

    /** 将磁盘记录（apiKey 密文）解密为内存记录（apiKey 明文） */
    private decryptRecord(rec: ModelProviderRecord): ModelProviderRecord {
        if (rec.apiKey && isEncrypted(rec.apiKey)) {
            try {
                return {...rec, apiKey: decryptSecret(rec.apiKey, this.getKey())};
            } catch {
                // 密钥缺失/损坏时降级：apiKey 置空，避免运行时使用错误密钥
                return {...rec, apiKey: undefined};
            }
        }
        return rec;
    }

    /** 将内存记录（apiKey 明文）加密为磁盘记录（apiKey 密文） */
    private encryptRecord(rec: ModelProviderRecord): ModelProviderRecord {
        if (rec.apiKey && !isEncrypted(rec.apiKey)) {
            return {...rec, apiKey: encryptSecret(rec.apiKey, this.getKey())};
        }
        return rec;
    }

    /**
     * 列出所有供应商记录（apiKey 解密为明文）。
     * 仅用于内部逻辑，不要直接暴露给 API。
     */
    list(): ModelProviderRecord[] {
        return this.loadFile().providers.map((r) => this.decryptRecord(r));
    }

    /** 列出脱敏后的安全视图（用于 API 响应） */
    listSafe(): SafeModelProviderRecord[] {
        return this.list().map(toSafeRecord);
    }

    /** 按 id 获取记录（apiKey 明文），不存在返回 undefined */
    get(id: string): ModelProviderRecord | undefined {
        const rec = this.loadFile().providers.find((r) => r.id === id);
        return rec ? this.decryptRecord(rec) : undefined;
    }

    /** 按 id 获取脱敏记录 */
    getSafe(id: string): SafeModelProviderRecord | undefined {
        const rec = this.get(id);
        return rec ? toSafeRecord(rec) : undefined;
    }

    /**
     * 创建或更新一条供应商记录。
     *
     * - 若新记录的 apiKey 为空且已存在旧记录，则保留旧记录的 apiKey（避免误删）
     * - models / env 缺省（undefined）时保留旧值，避免 API 部分更新误清空已有配置
     * - apiKey 会被加密后落盘
     * - 自动更新 updatedAt
     */
    upsert(input: ModelProviderInput): ModelProviderRecord {
        const data = this.loadFile();
        const idx = data.providers.findIndex((r) => r.id === input.id);

        let next: ModelProviderRecord;
        if (idx >= 0) {
            const prev = this.decryptRecord(data.providers[idx]);
            // apiKey 为空视为「不修改」，保留旧值
            const apiKey = input.apiKey !== undefined && input.apiKey !== ''
                ? input.apiKey
                : prev.apiKey;
            next = {
                ...prev,
                ...input,
                apiKey,
                // models/env 缺省（undefined）时保留旧值，避免 API 部分更新误清空已有配置
                models: input.models !== undefined ? input.models : prev.models,
                env: input.env !== undefined ? input.env : prev.env,
                updatedAt: new Date().toISOString(),
            };
            data.providers[idx] = this.encryptRecord(next);
        } else {
            next = {
                ...input,
                models: input.models ?? [],
                updatedAt: new Date().toISOString(),
            };
            data.providers.push(this.encryptRecord(next));
        }

        this.saveFile(data);
        return next;
    }

    /**
     * 删除指定 id 的记录
     * @returns 是否删除成功
     */
    delete(id: string): boolean {
        const data = this.loadFile();
        const idx = data.providers.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        data.providers.splice(idx, 1);
        this.saveFile(data);
        return true;
    }

    /**
     * 检测外部 CLI 配置源（不落盘，仅检测）
     */
    detectExternal(): ExternalSourceStatus[] {
        return detectExternalSources();
    }

    /**
     * 自动导入外部 CLI 配置到自有配置文件。
     *
     * 融合策略：
     * - 只更新 source === 'external' 的记录（手动/内置记录不受影响）
     * - 增量叠加：不同供应商全部保留
     * - 高优先级覆盖低优先级同名配置项
     *
     * @returns 导入结果摘要
     */
    importExternal(): ImportSummary {
        const incoming = readExternalProviders();
        const data = this.loadFile();

        const externalExisting = data.providers.filter((r) => r.source === 'external');
        const others = data.providers.filter((r) => r.source !== 'external');

        const merged = mergeExternalProviders(
            externalExisting.map((r) => this.decryptRecord(r)),
            incoming,
        );

        // 加密落盘
        const nextFile: ModelProvidersFile = {
            version: 1,
            providers: [...others, ...merged.map((r) => this.encryptRecord(r))],
        };
        this.saveFile(nextFile);

        const skipped = detectExternalSources()
            .filter((s) => !s.available)
            .map((s) => s.source);

        return {
            imported: merged.filter((r) => r.source === 'external').map((r) => r.id),
            skipped,
            total: nextFile.providers.length,
        };
    }
}

/** 转为脱敏安全视图 */
function toSafeRecord(rec: ModelProviderRecord): SafeModelProviderRecord {
    return {
        id: rec.id,
        kind: rec.kind,
        label: rec.label,
        enabled: rec.enabled,
        hasApiKey: !!rec.apiKey,
        apiKeyMasked: rec.apiKey ? maskApiKey(rec.apiKey) : undefined,
        baseUrl: rec.baseUrl,
        env: rec.env,
        models: rec.models,
        defaultModel: rec.defaultModel,
        source: rec.source,
        importedFrom: rec.importedFrom,
        importedAt: rec.importedAt,
        updatedAt: rec.updatedAt,
    };
}
