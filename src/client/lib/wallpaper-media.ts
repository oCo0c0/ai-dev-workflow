/**
 * @file wallpaper-media.ts
 * @description 壁纸媒体处理工具 —— 客户端缩略图生成 + 视频错误人话翻译
 *
 * 缩略图全部在前端 canvas 生成（图片降采样 / 视频抽帧），服务端零原生依赖
 * （不引 ffmpeg / sharp）。视频抽帧跳过开头（避开黑场首帧），失败返回 null
 * 由 UI 回退占位 —— 不影响上传与播放本身。
 */

/** 缩略图最大边长（px） */
const THUMB_MAX_DIM = 480;

/** 把 dataURL 存到 <img> 可用所需的最小包装：直接返回 dataURL */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
    // JPEG 体积小；透明图会变黑底 —— 用 PNG 兜底判断成本高，统一 JPEG 0.82
    return canvas.toDataURL('image/jpeg', 0.82);
}

/** 图片缩略图：降采样画到 canvas */
function imageThumb(file: File): Promise<string | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, THUMB_MAX_DIM / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('no 2d ctx');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvasToDataUrl(canvas));
            } catch {
                resolve(null);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

/** 视频缩略图：加载 → seek 到 10%（约 1s）→ 抽帧 */
function videoThumb(file: File): Promise<string | null> {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        let settled = false;
        const done = (v: string | null) => {
            if (settled) return;
            settled = true;
            URL.revokeObjectURL(url);
            video.removeAttribute('src');
            try { video.load(); } catch { /* ignore */ }
            resolve(v);
        };
        const timeout = setTimeout(() => done(null), 10_000);
        video.muted = true;
        video.preload = 'auto';
        video.onloadedmetadata = () => {
            try {
                // 跳过开头约 1 秒（或 10%），避开黑场/淡入
                video.currentTime = Math.min(1.2, (video.duration || 2) * 0.1);
            } catch {
                done(null);
            }
        };
        video.onseeked = () => {
            try {
                const scale = Math.min(1, THUMB_MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
                canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('no 2d ctx');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                clearTimeout(timeout);
                done(canvasToDataUrl(canvas));
            } catch {
                clearTimeout(timeout);
                done(null);
            }
        };
        video.onerror = () => { clearTimeout(timeout); done(null); };
        video.src = url;
    });
}

/**
 * 为上传文件生成缩略图 dataURL（失败返回 null，不抛异常）
 */
export async function generateThumb(file: File): Promise<string | null> {
    const type = file.type;
    try {
        if (type.startsWith('image/')) return await imageThumb(file);
        if (type.startsWith('video/')) return await videoThumb(file);
    } catch { /* ignore */ }
    return null;
}

/**
 * 把 <video> 的 MediaError 翻译成可读文案（参考 dsh-wallpaper-engine #84 的做法：
 * 播放失败必须说人话并给建议，不能让用户面对一个冻住的壁纸）
 */
export function videoErrorText(video: HTMLVideoElement | null): string {
    const err = video?.error;
    if (!err) return '';
    switch (err.code) {
        case 4:
            return '浏览器无法解码这段视频（建议改用 H.264 编码的 MP4 或 WEBM）';
        case 3:
            return '视频解码失败（文件可能已损坏）';
        case 2:
            return '视频读取失败（文件可能已被移动或删除）';
        default:
            return '视频加载失败';
    }
}
