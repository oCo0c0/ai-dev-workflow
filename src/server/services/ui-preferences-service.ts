/**
 * @file ui-preferences-service.ts
 * @description UI 偏好服务端持久化 —— 主题/配色/字体/透明度/吉祥物/背景照片等
 *
 * 动机（对齐 dsh-wallpaper-engine v0.4.0 的「设置持久化到宿主端文件」）：
 * 这些偏好原先只存 localStorage，而 localStorage 按 origin 隔离 ——
 * dev:desktop（localhost:5173）、生产 electron（随机端口）、浏览器（3000 等）
 * 是三个互不相通的存储空间；尤其桌面版生产模式每次 findAvailablePort 可能换端口，
 * 设置看起来就像「随机丢失」。改存 `~/.ai-dev-workbench/ui-preferences.json`
 * 后与端口无关，任何来源启动都收敛到同一份偏好。
 *
 * 壁纸库设置（wallpaper-store-service）此前已走同一模式。
 */
import fs from 'fs';
import path from 'path';
import {APP_DATA_DIR} from '../utils/constants.js';

export interface UiPreferencesFile {
    version: 1;
    updatedAt: string;
    prefs: Record<string, unknown>;
}

export class UiPreferencesService {
    private readonly file: string;

    constructor(file?: string) {
        this.file = file ?? path.join(APP_DATA_DIR, 'ui-preferences.json');
    }

    /** 读取偏好（文件缺失/损坏返回空对象，不阻塞启动） */
    load(): Record<string, unknown> {
        if (!fs.existsSync(this.file)) return {};
        try {
            const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<UiPreferencesFile>;
            if (parsed && typeof parsed === 'object' && parsed.prefs && typeof parsed.prefs === 'object') {
                return parsed.prefs;
            }
        } catch { /* ignore */ }
        return {};
    }

    /** 保存偏好（整体覆盖写；客户端负责合并语义） */
    save(prefs: Record<string, unknown>): void {
        const dir = path.dirname(this.file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
        const payload: UiPreferencesFile = {
            version: 1,
            updatedAt: new Date().toISOString(),
            prefs,
        };
        fs.writeFileSync(this.file, JSON.stringify(payload, null, 2), 'utf-8');
    }
}
