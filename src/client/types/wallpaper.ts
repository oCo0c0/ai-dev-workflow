/**
 * @file wallpaper.ts
 * @description 壁纸功能前端数据模型（与服务端 wallpaper-store-service 契约一致）
 */

/** 壁纸元数据（服务端 meta.json 条目） */
export interface WallpaperMeta {
    id: string;
    title: string;
    type: 'image' | 'video';
    fileName: string;
    mimeType: string;
    size: number;
    addedAt: string;
    /** 软删除标记：隐藏后不出现在默认网格 */
    hidden: boolean;
    hasThumb: boolean;
}

/** 效果参数（八滑杆） */
export interface WallpaperEffects {
    /** 壁纸模糊 0-60 px */
    wallpaperBlur: number;
    /** 亮度 40-160 % */
    brightness: number;
    /** 对比度 40-200 % */
    contrast: number;
    /** 饱和度 0-200 % */
    saturate: number;
    /** 壁纸透明度 0-90 %（越大越透） */
    wallpaperOpacity: number;
    /** 暗化 0-0.9 */
    dim: number;
    /** 边框增强 0-0.9 */
    border: number;
    /** 玻璃模糊半径 0-60 px */
    glassBlur: number;
}

/** 播放参数 */
export interface WallpaperPlayback {
    rate: number;
    flip: boolean;
    objectFit: 'cover' | 'contain' | 'center' | 'fill';
}

/** 遮挡暂停三档 */
export interface WallpaperOcclusion {
    pauseOnHidden: boolean;
    pauseOnBlur: boolean;
    pauseOnBattery: boolean;
}

/** 全部持久化设置 */
export interface WallpaperSettings {
    selectedId: string | null;
    playing: boolean;
    effects: WallpaperEffects;
    playback: WallpaperPlayback;
    occlusion: WallpaperOcclusion;
}

/** 深层部分补丁类型 */
export type WallpaperSettingsPatch = {
    selectedId?: string | null;
    playing?: boolean;
    effects?: Partial<WallpaperEffects>;
    playback?: Partial<WallpaperPlayback>;
    occlusion?: Partial<WallpaperOcclusion>;
};

/** 默认设置（与服务端 defaultWallpaperSettings 保持一致） */
export function defaultWallpaperSettings(): WallpaperSettings {
    return {
        selectedId: null,
        playing: true,
        effects: {
            wallpaperBlur: 0,
            brightness: 100,
            contrast: 100,
            saturate: 100,
            wallpaperOpacity: 0,
            dim: 0.25,
            border: 0.35,
            glassBlur: 16,
        },
        playback: {rate: 1, flip: false, objectFit: 'cover'},
        occlusion: {pauseOnHidden: true, pauseOnBlur: false, pauseOnBattery: false},
    };
}

/** 合并 patch（浅合并各分组） */
export function mergeWallpaperSettings(base: WallpaperSettings, patch: WallpaperSettingsPatch): WallpaperSettings {
    return {
        ...base,
        ...patch,
        effects: {...base.effects, ...(patch.effects ?? {})},
        playback: {...base.playback, ...(patch.playback ?? {})},
        occlusion: {...base.occlusion, ...(patch.occlusion ?? {})},
    };
}
