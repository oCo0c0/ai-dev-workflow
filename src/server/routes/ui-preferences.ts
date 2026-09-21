/**
 * @file ui-preferences.ts
 * @description UI 偏好持久化路由（端口无关，见 ui-preferences-service.ts）
 *
 * 端点：
 * - GET /api/ui-preferences  读取偏好（无则 {}）
 * - PUT /api/ui-preferences  整体覆盖保存（客户端防抖合并后全量 PUT）
 */

import {Router} from 'express';
import {UiPreferencesService} from '../services/ui-preferences-service.js';

export function createUiPreferencesRoutes(service: UiPreferencesService): Router {
    const router = Router();

    router.get('/', (_req, res) => {
        res.json(service.load());
    });

    router.put('/', (req, res) => {
        const body = req.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            res.status(400).json({code: 'VALIDATION_ERROR', message: '请求体必须是偏好对象'});
            return;
        }
        service.save(body as Record<string, unknown>);
        res.json({ok: true});
    });

    return router;
}
