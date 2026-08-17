/**
 * @file model-providers.ts
 * @description 模型供应商配置路由模块
 *
 * 提供本项目自有模型供应商配置体系的 REST API：
 * - GET    /api/model-providers            列出所有供应商（脱敏）
 * - GET    /api/model-providers/detect     检测外部 CLI 配置源
 * - POST   /api/model-providers/import     自动导入外部 CLI 配置
 * - POST   /api/model-providers            手动创建/更新供应商
 * - DELETE /api/model-providers/:id        删除供应商
 *
 * 安全约定：所有读接口均返回脱敏视图（apiKey 仅布尔标记 + 掩码），
 * 明文 API Key 只在写入时由客户端提交，服务端加密后立即落盘。
 */

import {Router} from 'express';
import {ModelProviderStore} from '../services/model-provider-store.js';
import type {ModelProviderInput} from '../services/model-provider-types.js';
import {getErrorMessage} from '../utils/error-utils.js';

/** 允许的 kind 值 */
const VALID_KINDS = ['claude', 'codex', 'pi', 'dsh', 'custom'] as const;
/** 允许的 source 值 */
const VALID_SOURCES = ['external', 'manual', 'builtin'] as const;

/**
 * 校验并规整客户端提交的供应商记录。
 * 返回错误消息，或 null 表示通过。
 */
function normalizeRecordInput(body: Record<string, unknown>): {record: ModelProviderInput} | {error: string} {
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
    if (!id) return {error: 'id is required'};

    const kind = typeof body.kind === 'string' ? body.kind : undefined;
    if (!kind || !(VALID_KINDS as readonly string[]).includes(kind)) {
        return {error: `kind must be one of: ${VALID_KINDS.join(', ')}`};
    }

    const source = typeof body.source === 'string' ? body.source : 'manual';
    if (!(VALID_SOURCES as readonly string[]).includes(source)) {
        return {error: `source must be one of: ${VALID_SOURCES.join(', ')}`};
    }

    const label = typeof body.label === 'string' && body.label.trim()
        ? body.label.trim()
        : id;

    const record: ModelProviderInput = {
        id,
        kind: kind as ModelProviderInput['kind'],
        label,
        enabled: body.enabled !== false,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        baseUrl: typeof body.baseUrl === 'string' && body.baseUrl ? body.baseUrl : undefined,
        env: body.env && typeof body.env === 'object' && !Array.isArray(body.env)
            ? (body.env as Record<string, string>)
            : undefined,
        // 缺省字段保持 undefined（而非空数组/空对象），由 store.upsert 判断保留旧值，避免部分更新误清空
        models: Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string') : undefined,
        defaultModel: typeof body.defaultModel === 'string' && body.defaultModel ? body.defaultModel : undefined,
        source: source as ModelProviderInput['source'],
        importedFrom: typeof body.importedFrom === 'string' ? body.importedFrom : undefined,
        importedAt: typeof body.importedAt === 'string' ? body.importedAt : undefined,
        updatedAt: new Date().toISOString(),
    };

    return {record};
}

/**
 * 创建模型供应商配置路由
 * @param store - 模型供应商存储服务实例
 */
export function createModelProviderRoutes(store: ModelProviderStore): Router {
    const router = Router();

    // GET / - 列出所有供应商（脱敏）
    router.get('/', (_req, res) => {
        try {
            res.json({providers: store.listSafe(), file: store.getFile()});
        } catch (err) {
            res.status(500).json({code: 'MODEL_PROVIDER_LIST_ERROR', message: getErrorMessage(err)});
        }
    });

    // GET /detect - 检测外部 CLI 配置源
    router.get('/detect', (_req, res) => {
        try {
            res.json({sources: store.detectExternal()});
        } catch (err) {
            res.status(500).json({code: 'MODEL_PROVIDER_DETECT_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /import - 自动导入外部 CLI 配置
    router.post('/import', (_req, res) => {
        try {
            const summary = store.importExternal();
            res.json({success: true, summary, providers: store.listSafe()});
        } catch (err) {
            res.status(500).json({code: 'MODEL_PROVIDER_IMPORT_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /models/fetch - 用表单当前凭据向端点拉取可用模型清单
    // （对齐 dsh Models 页哲学：用“正在填写、尚未保存”的 key 询问端点，
    //   只返回候选清单，绝不背后写配置；拉取失败由前端就地展示并可手填。）
    router.post('/models/fetch', async (req, res) => {
        const body = (req.body ?? {}) as {apiKey?: unknown; baseUrl?: unknown; id?: unknown; kind?: unknown};
        const kind = typeof body.kind === 'string' ? body.kind : '';
        let apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
        // 编辑已有记录时未重填 key：退回已存凭据
        if (!apiKey && typeof body.id === 'string' && body.id) {
            try {
                apiKey = store.get(body.id)?.apiKey ?? '';
            } catch { /* 记录不存在时按无 key 处理 */ }
        }
        if (!apiKey) {
            res.status(400).json({code: 'API_KEY_REQUIRED', message: '请先填写 API Key（或选择已配置 Key 的记录）'});
            return;
        }
        const base = (baseUrlRaw
            || (kind === 'claude' ? 'https://api.anthropic.com' : 'https://api.deepseek.com')
        ).replace(/\/+$/, '');
        // Anthropic 风格：/v1/models + x-api-key；OpenAI 兼容风格：/models + Bearer
        const modelsPath = kind === 'claude' ? '/v1/models' : '/models';
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const resp = await fetch(`${base}${modelsPath}`, {
                headers: {Authorization: `Bearer ${apiKey}`, 'x-api-key': apiKey},
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!resp.ok) {
                const detail = resp.status === 401 ? 'API Key 无效或已过期' : `端点返回 HTTP ${resp.status}`;
                res.status(resp.status === 401 ? 401 : 502).json({code: 'MODELS_FETCH_FAILED', message: detail});
                return;
            }
            const data = (await resp.json()) as {data?: Array<{id?: unknown}>, models?: Array<{id?: unknown}>};
            const list = Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []);
            const models = list.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean);
            res.json({models: [...new Set(models)].sort()});
        } catch (err) {
            res.status(502).json({code: 'MODELS_FETCH_FAILED', message: `无法访问 ${base}${modelsPath}：${getErrorMessage(err)}`});
        }
    });

    // POST / - 手动创建/更新供应商
    router.post('/', (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const result = normalizeRecordInput(body);
        if ('error' in result) {
            res.status(400).json({code: 'INVALID_MODEL_PROVIDER', message: result.error});
            return;
        }
        try {
            const saved = store.upsert(result.record);
            res.json({success: true, provider: store.getSafe(saved.id)});
        } catch (err) {
            res.status(500).json({code: 'MODEL_PROVIDER_UPSERT_ERROR', message: getErrorMessage(err)});
        }
    });

    // DELETE /:id - 删除供应商
    router.delete('/:id', (req, res) => {
        const id = req.params.id;
        if (!id) {
            res.status(400).json({code: 'INVALID_ID', message: 'id is required'});
            return;
        }
        try {
            const deleted = store.delete(id);
            if (!deleted) {
                res.status(404).json({code: 'MODEL_PROVIDER_NOT_FOUND', message: `Provider "${id}" not found`});
                return;
            }
            res.json({success: true});
        } catch (err) {
            res.status(500).json({code: 'MODEL_PROVIDER_DELETE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
