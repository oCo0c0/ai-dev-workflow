/**
 * @file ModelProviderStore 单元测试
 * @description 测试自有模型供应商配置体系的存储与融合逻辑：
 *              1. API Key 加密落盘 / 解密读取
 *              2. 对外脱敏视图（listSafe / getSafe）
 *              3. CRUD 与 upsert 的 apiKey 保留语义
 *              4. 外部配置融合（增量叠加、高优先级覆盖低优先级）
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {ModelProviderStore} from './model-provider-store.js';
import {mergeExternalProviders} from './model-provider-import.js';
import type {ModelProviderInput, ModelProviderRecord} from './model-provider-types.js';

/** 构造测试记录 */
function makeRecord(overrides: Partial<ModelProviderRecord> = {}): ModelProviderRecord {
    return {
        id: 'claude',
        kind: 'claude',
        label: 'Claude Code',
        enabled: true,
        models: [],
        source: 'external',
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

describe('ModelProviderStore', () => {
    let tempDir: string;
    let store: ModelProviderStore;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-provider-test-'));
        store = new ModelProviderStore(tempDir);
    });

    afterEach(() => {
        fs.rmSync(tempDir, {recursive: true, force: true});
    });

    it('encrypts apiKey at rest', () => {
        store.upsert(makeRecord({id: 'claude', apiKey: 'sk-test-1234567890'}));

        const raw = JSON.parse(fs.readFileSync(store.getFile(), 'utf-8'));
        expect(raw.providers[0].apiKey).toMatch(/^enc:v1:/);
        expect(raw.providers[0].apiKey).not.toContain('sk-test');
    });

    it('decrypts apiKey back to plaintext on get', () => {
        store.upsert(makeRecord({id: 'claude', apiKey: 'sk-test-1234567890'}));

        const rec = store.get('claude');
        expect(rec?.apiKey).toBe('sk-test-1234567890');
    });

    it('masks apiKey in safe view', () => {
        store.upsert(makeRecord({id: 'claude', apiKey: 'sk-test-1234567890', models: ['m1']}));

        const safe = store.listSafe();
        expect(safe[0].hasApiKey).toBe(true);
        expect((safe[0] as unknown as Record<string, unknown>).apiKey).toBeUndefined();
        expect(safe[0].apiKeyMasked).toContain('…');
        expect(safe[0].apiKeyMasked).not.toContain('1234567890');
    });

    it('keeps existing apiKey when upserting with empty apiKey', () => {
        store.upsert(makeRecord({id: 'claude', apiKey: 'sk-original'}));
        store.upsert(makeRecord({id: 'claude', label: 'Renamed'}));

        expect(store.get('claude')?.apiKey).toBe('sk-original');
        expect(store.get('claude')?.label).toBe('Renamed');
    });

    it('preserves existing models/env when upserting without them (partial update)', () => {
        store.upsert(makeRecord({id: 'claude', apiKey: 'k1', models: ['m1', 'm2'], env: {A: '1'}}));
        // 部分更新：不传 models/env（undefined），应保留旧值，避免误清空
        store.upsert({
            ...makeRecord({id: 'claude', label: 'Renamed'}),
            models: undefined,
            env: undefined,
        } as ModelProviderInput);

        const rec = store.get('claude')!;
        expect(rec.label).toBe('Renamed');
        expect(rec.apiKey).toBe('k1');
        expect(rec.models).toEqual(['m1', 'm2']);
        expect(rec.env).toEqual({A: '1'});
    });

    it('deletes a record', () => {
        store.upsert(makeRecord({id: 'claude'}));
        expect(store.delete('claude')).toBe(true);
        expect(store.get('claude')).toBeUndefined();
    });

    it('returns empty list when file does not exist', () => {
        expect(store.list()).toEqual([]);
        expect(store.listSafe()).toEqual([]);
    });
});

describe('mergeExternalProviders', () => {
    it('incrementally merges distinct providers', () => {
        const existing = [makeRecord({id: 'claude'})];
        const incoming = [makeRecord({id: 'codex', kind: 'codex', label: 'Codex'})];

        const merged = mergeExternalProviders(existing, incoming);
        expect(merged.map((r) => r.id).sort()).toEqual(['claude', 'codex']);
    });

    it('higher priority wins for the same id', () => {
        // incoming 已按优先级（高→低）排序，同 id 先到者胜出
        const incoming = [
            makeRecord({id: 'shared', apiKey: 'high-priority-key'}),
            makeRecord({id: 'shared', apiKey: 'low-priority-key'}),
        ];

        const merged = mergeExternalProviders([], incoming);
        expect(merged).toHaveLength(1);
        expect(merged[0].apiKey).toBe('high-priority-key');
    });

    it('keeps stale external records that are no longer detected', () => {
        const existing = [makeRecord({id: 'pi:anthropic', kind: 'pi'})];

        const merged = mergeExternalProviders(existing, []);
        expect(merged.map((r) => r.id)).toEqual(['pi:anthropic']);
    });

    it('refreshes existing external record with fresh data', () => {
        const existing = [makeRecord({id: 'claude', apiKey: 'old-key', baseUrl: undefined})];
        const incoming = [makeRecord({id: 'claude', apiKey: 'new-key', baseUrl: 'https://proxy.example.com'})];

        const merged = mergeExternalProviders(existing, incoming);
        expect(merged).toHaveLength(1);
        expect(merged[0].apiKey).toBe('new-key');
        expect(merged[0].baseUrl).toBe('https://proxy.example.com');
    });

    it('keeps existing fields when incoming detection is partial (no data loss)', () => {
        const existing = [makeRecord({id: 'claude', apiKey: 'sk-old', baseUrl: 'https://a', models: ['m1']})];
        // 本次检测未拿到 apiKey / baseUrl（环境变量缺失），只更新到模型列表 → 不应清空已有字段
        const incoming = [makeRecord({id: 'claude', apiKey: undefined, baseUrl: undefined, models: ['m1', 'm2']})];

        const merged = mergeExternalProviders(existing, incoming);
        expect(merged).toHaveLength(1);
        expect(merged[0].apiKey).toBe('sk-old');
        expect(merged[0].baseUrl).toBe('https://a');
        expect(merged[0].models).toEqual(['m1', 'm2']);
    });
});
