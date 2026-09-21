/**
 * @file WallpaperPickerModal.tsx
 * @description 壁纸选择弹窗 —— 缩略图网格 + 类型过滤 + 隐藏/恢复（软删除）+ 上传
 *
 * 布局设计参考 dsh-wallpaper-engine 的壁纸选择器：
 * - 网格卡片：缩略图 + 标题 + 类型徽标，选中态高亮描边；
 * - 「已隐藏」页签：软删除的壁纸可单张恢复/彻底删除，不碰正在播放的壁纸；
 * - 上传：图片（JPG/PNG/WEBP）与视频（MP4/WEBM），前端生成缩略图一并入库，
 *   成功后自动选中新壁纸；
 * - a11y：ESC 关闭、Tab 焦点陷阱、卡片可键盘激活（Enter/Space）。
 */
import {useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Eye, EyeOff, Film, Image as ImageIcon, Trash2, Upload, X} from 'lucide-react';
import {cn} from '../../lib/utils';
import {useWallpaperStore} from '../../stores/wallpaper-store';
import type {WallpaperMeta} from '../../types/wallpaper';

/** 类型过滤项 */
type TypeFilter = 'all' | 'image' | 'video';

/** 接受上传的扩展名（与服务端白名单一致） */
const ACCEPT = '.jpg,.jpeg,.png,.webp,.mp4,.webm';

function formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/** 卡片键盘激活（div[role=button] 的 Enter/Space → click） */
function cardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.currentTarget.click();
    }
}

/**
 * 壁纸选择弹窗
 * @param props.open      是否打开
 * @param props.onClose   关闭回调
 */
export function WallpaperPickerModal({open, onClose}: {open: boolean; onClose: () => void}) {
    const {t} = useTranslation();
    const list = useWallpaperStore(s => s.list);
    const selectedId = useWallpaperStore(s => s.settings.selectedId);
    const select = useWallpaperStore(s => s.select);
    const setHidden = useWallpaperStore(s => s.setHidden);
    const remove = useWallpaperStore(s => s.remove);
    const upload = useWallpaperStore(s => s.upload);
    const uploading = useWallpaperStore(s => s.uploading);
    const uploadError = useWallpaperStore(s => s.uploadError);

    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
    const [showHidden, setShowHidden] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<Element | null>(null);

    // 打开时记住触发元素，关闭后焦点归还（a11y）
    useEffect(() => {
        if (open) {
            openerRef.current = document.activeElement;
            // 首焦点落在弹窗容器内
            requestAnimationFrame(() => dialogRef.current?.focus());
        } else if (openerRef.current instanceof HTMLElement) {
            try { openerRef.current.focus(); } catch { /* ignore */ }
        }
    }, [open]);

    // ESC 关闭 + Tab 焦点陷阱
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
                return;
            }
            if (e.key === 'Tab' && dialogRef.current) {
                const nodes = dialogRef.current.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])');
                const focusable = Array.from(nodes).filter(n => !(n as HTMLButtonElement).disabled && n.offsetParent !== null);
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [open, onClose]);

    /** 可见清单：页签 + 类型过滤 */
    const items = useMemo(() => {
        return list.filter(w => {
            if (showHidden) return w.hidden;
            if (w.hidden) return false;
            if (typeFilter !== 'all' && w.type !== typeFilter) return false;
            return true;
        });
    }, [list, typeFilter, showHidden]);

    const hiddenCount = useMemo(() => list.filter(w => w.hidden).length, [list]);

    if (!open) return null;

    const handleFile = async (file: File | undefined) => {
        if (!file) return;
        const ok = await upload(file);
        if (ok) {
            // 上传成功自动选中 → 关闭弹窗露出壁纸
            onClose();
        }
    };

    const card = (w: WallpaperMeta) => {
        const selected = w.id === selectedId;
        return (
            <div
                key={w.id}
                role="button"
                tabIndex={0}
                onKeyDown={cardKeyDown}
                onClick={() => {
                    if (showHidden) return;
                    select(w.id);
                    onClose();
                }}
                className={cn(
                    'group relative cursor-pointer overflow-hidden rounded-xl border bg-card/60 text-left transition-all duration-200 hover:-translate-y-0.5',
                    selected
                        ? 'border-primary ring-2 ring-primary/40'
                        : 'border-border/60 hover:border-primary/40'
                )}
                title={w.title}
            >
                <div className="relative aspect-video w-full overflow-hidden bg-muted/60">
                    {w.hasThumb ? (
                        <img
                            src={`/api/wallpapers/${w.id}/thumb`}
                            alt={w.title}
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            {w.type === 'video' ? <Film className="h-8 w-8 opacity-50"/> : <ImageIcon className="h-8 w-8 opacity-50"/>}
                        </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {w.type === 'video' ? t('settings.wallpaper.badgeVideo') : t('settings.wallpaper.badgeImage')}
                    </span>
                    {w.type === 'video' && selected && !showHidden && (
                        <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                            {t('settings.wallpaper.playingBadge')}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{w.title}</p>
                        <p className="text-[10px] text-muted-foreground">{formatSize(w.size)}</p>
                    </div>
                    {showHidden ? (
                        <div className="flex shrink-0 gap-0.5">
                            <button
                                type="button"
                                title={t('settings.wallpaper.restore')}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setHidden(w.id, false);
                                }}
                            >
                                <Eye className="h-3.5 w-3.5"/>
                            </button>
                            <button
                                type="button"
                                title={t('settings.wallpaper.deleteForever')}
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(t('settings.wallpaper.deleteConfirm', {name: w.title}))) {
                                        remove(w.id);
                                    }
                                }}
                            >
                                <Trash2 className="h-3.5 w-3.5"/>
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            title={t('settings.wallpaper.hide')}
                            className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                            onClick={(e) => {
                                e.stopPropagation();
                                setHidden(w.id, true);
                            }}
                        >
                            <EyeOff className="h-3.5 w-3.5"/>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={t('settings.wallpaper.pickerTitle')}
                tabIndex={-1}
                className="glass-panel flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl outline-none"
            >
                {/* 头部 */}
                <div className="flex items-center gap-3 border-b border-border/50 px-5 py-3.5">
                    <h3 className="flex-1 text-sm font-semibold">{t('settings.wallpaper.pickerTitle')}</h3>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                        {items.length}
                    </span>
                    <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        onClick={onClose}
                        title={t('common.close')}
                    >
                        <X className="h-4 w-4"/>
                    </button>
                </div>

                {/* 工具栏：类型过滤 / 已隐藏页签 / 上传 */}
                <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                    {([
                        ['all', t('settings.wallpaper.filterAll')],
                        ['image', t('settings.wallpaper.filterImage')],
                        ['video', t('settings.wallpaper.filterVideo')],
                    ] as Array<[TypeFilter, string]>).map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            disabled={showHidden}
                            className={cn(
                                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                                !showHidden && typeFilter === id
                                    ? 'brand-gradient-soft text-primary'
                                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                showHidden && 'opacity-40'
                            )}
                            onClick={() => setTypeFilter(id)}
                        >
                            {label}
                        </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-border"/>
                    <button
                        type="button"
                        className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                            showHidden
                                ? 'brand-gradient-soft text-primary'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                        )}
                        onClick={() => setShowHidden(!showHidden)}
                    >
                        {t('settings.wallpaper.hiddenTab')}
                        {hiddenCount > 0 && ` (${hiddenCount})`}
                    </button>
                    <div className="flex-1"/>
                    <button
                        type="button"
                        disabled={uploading}
                        className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                        onClick={() => fileRef.current?.click()}
                    >
                        <Upload className="h-3.5 w-3.5"/>
                        {uploading ? t('settings.wallpaper.uploading') : t('settings.wallpaper.upload')}
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept={ACCEPT}
                        className="sr-only"
                        onChange={(e) => {
                            handleFile(e.target.files?.[0]);
                            e.target.value = '';
                        }}
                    />
                </div>

                {uploadError && (
                    <p className="px-5 pb-2 text-xs text-destructive">{uploadError}</p>
                )}

                {/* 网格 */}
                <div className="flex-1 overflow-y-auto px-5 pb-5">
                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
                            <ImageIcon className="h-10 w-10 text-muted-foreground/40"/>
                            <p className="text-sm font-medium">{t('settings.wallpaper.emptyTitle')}</p>
                            <p className="max-w-xs text-xs text-muted-foreground">
                                {showHidden ? t('settings.wallpaper.emptyHidden') : t('settings.wallpaper.emptyHint')}
                            </p>
                            {!showHidden && (
                                <button
                                    type="button"
                                    className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                                    onClick={() => fileRef.current?.click()}
                                >
                                    <Upload className="h-3.5 w-3.5"/>
                                    {t('settings.wallpaper.upload')}
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                            {items.map(card)}
                        </div>
                    )}
                </div>

                {/* 底部提示 */}
                <div className="border-t border-border/50 px-5 py-2.5">
                    <p className="text-[11px] text-muted-foreground">{t('settings.wallpaper.pickerHint')}</p>
                </div>
            </div>
        </div>,
        document.body
    );
}
