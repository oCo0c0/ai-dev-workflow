/**
 * @file WallpaperLayer.tsx
 * @description 壁纸层 —— 渲染在界面后方的固定图层（z-index:-2）+ 可读性遮罩（z-index:-1）
 *
 * 架构参考 dsh-wallpaper-engine（MIT）的 behind-body layer 设计：
 * - 壁纸层与遮罩层 portal 到 <body>，负 z-index 恰好落在根画布背景之上、
 *   全部应用内容之下 —— 界面各玻璃面板透出壁纸；
 * - <video autoplay muted loop playsinline> 静音自动播放（loopback 场景合法）；
 * - 播放控制语义「可重试 + 不说谎」（dsh-wallpaper-engine #84）：
 *     · settings.playing 是用户意图，元素真实在播是另一回事；
 *     · play() 被拒（自动播放策略/编码不支持）记录在元素 dataset，UI 如实显示，
 *       只有用户显式点「播放」才清除重试；
 *     · AbortError（被换源打断）属瞬时失败，媒体就绪后自动补播自愈；
 * - 释放纪律：切换/卸载前 pause + removeAttribute('src') + load() ——
 *   播放中的 <video> 是 GC 根，否则每次切换泄漏一个后台解码器；
 * - 遮挡暂停三档（页面隐藏/失焦/电池）在 store 里聚合成 occluded，暂停即解码归零。
 *
 * StrictMode 双挂载安全：副作用全部幂等（src 换源 effect 的 cleanup 释放旧源，
 * 重挂载时重新设置）。
 */
import {useEffect, useRef} from 'react';
import {createPortal} from 'react-dom';
import {useWallpaperStore} from '../../stores/wallpaper-store';

/**
 * 有效播放意图 = 用户意图 && 未被遮挡 && 有选中壁纸。
 * 单独的选择器函数：occluded 或 playing 变化都会触发重渲染。
 */
function selectEffectivePlaying(s: {
    settings: { playing: boolean; selectedId: string | null };
    occluded: boolean;
}): boolean {
    return s.settings.playing && !s.occluded && Boolean(s.settings.selectedId);
}

export default function WallpaperLayer() {
    const selectedId = useWallpaperStore(s => s.settings.selectedId);
    const list = useWallpaperStore(s => s.list);
    const objectFit = useWallpaperStore(s => s.settings.playback.objectFit);
    const effectivePlaying = useWallpaperStore(selectEffectivePlaying);
    const rate = useWallpaperStore(s => s.settings.playback.rate);
    const syncVideoState = useWallpaperStore(s => s.syncVideoState);
    const setPlaying = useWallpaperStore(s => s.setPlaying);

    const videoRef = useRef<HTMLVideoElement>(null);
    const meta = list.find(w => w.id === selectedId);
    const isVideo = meta ? meta.type === 'video' : true; // 清单未加载时按视频容错
    const mediaUrl = selectedId ? `/api/wallpapers/${selectedId}/media` : null;

    // applyPlayback 的最新闭包（事件监听器与 effect 共用，避免监听器过期）
    const applyPlaybackRef = useRef<() => void>(() => undefined);
    applyPlaybackRef.current = () => {
        const video = videoRef.current;
        if (!video) return;
        try {
            if (video.playbackRate !== rate) video.playbackRate = rate;
        } catch { /* 个别编码不支持该倍速 */ }
        if (!effectivePlaying) {
            try { video.pause(); } catch { /* ignore */ }
            syncVideoState(video);
            return;
        }
        if (video.paused || video.ended) {
            const p = video.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err: unknown) => {
                    // 记录拒绝性质：AbortError = 被 pause()/load()/换源打断的瞬时失败
                    //（不算真拒绝，媒体就绪后自动补播）；其余等用户显式点「播放」
                    const name = err instanceof DOMException ? err.name : typeof err === 'object' && err ? String((err as {name?: string}).name ?? 'Error') : 'Error';
                    video.dataset.wePlayRefused = name;
                    syncVideoState(video);
                });
            }
        }
    };

    // 换源：设置 src + 释放旧解码器（cleanup 在换源/卸载/StrictMode 重挂载时都会跑）
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.dataset.wePlayRefused = '';
        if (mediaUrl) video.src = mediaUrl;
        return () => {
            // 播放中的 <video> 是 GC 根：先停再清 src，否则后台解码器泄漏
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch { /* ignore */ }
        };
    }, [mediaUrl]);

    // 播放意图 / 倍速变化 → 立即应用（含同一壁纸持续播放中的倍速热更新）
    useEffect(() => {
        applyPlaybackRef.current();
    }, [effectivePlaying, rate, mediaUrl]);

    // 元素事件：真实态回写 + 就绪自动补播（一次性挂载，读 applyPlaybackRef 取最新闭包）
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        const onState = () => syncVideoState(video);
        const onReady = () => {
            // 换源打断留下的 AbortError 标记：媒体就绪即自愈，清除后补播
            if (video.dataset.wePlayRefused === 'AbortError') {
                delete video.dataset.wePlayRefused;
            }
            applyPlaybackRef.current();
        };
        const events = ['play', 'playing', 'pause', 'ended', 'error', 'emptied'] as const;
        for (const t of events) video.addEventListener(t, onState);
        for (const t of ['loadeddata', 'canplay'] as const) video.addEventListener(t, onReady);
        return () => {
            for (const t of events) video.removeEventListener(t, onState);
            for (const t of ['loadeddata', 'canplay'] as const) video.removeEventListener(t, onReady);
        };
    }, [syncVideoState]);

    // 页面失焦视频卡住兜底：visibilitychange 恢复可见时若意图为播则补一次 play
    useEffect(() => {
        const onVisible = () => {
            if (!document.hidden && effectivePlaying) applyPlaybackRef.current();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [effectivePlaying]);

    if (!mediaUrl) return null;

    const layer = (
        <div className="wp-layer" aria-hidden>
            {isVideo ? (
                <video
                    ref={videoRef}
                    className="wp-media wp-media--fit"
                    autoPlay
                    muted
                    loop
                    playsInline
                />
            ) : (
                <img className="wp-media wp-media--fit" src={mediaUrl} alt=""/>
            )}
        </div>
    );

    const scrim = <div className="wp-scrim" aria-hidden/>;

    return createPortal(
        <>
            {layer}
            {scrim}
        </>,
        document.body
    );
}

/** 导出给设置页：把「元素真实态」收敛为用户可操作的播放意图切换 */
export {selectEffectivePlaying};
export function useWallpaperPlaybackToggle(): () => void {
    const setPlaying = useWallpaperStore(s => s.setPlaying);
    const playing = useWallpaperStore(s => s.settings.playing);
    return () => setPlaying(!playing);
}
