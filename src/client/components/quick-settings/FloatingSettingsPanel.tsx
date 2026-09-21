/**
 * @file FloatingSettingsPanel.tsx
 * @description 悬浮快捷设置面板 —— 六页签液态玻璃抽屉（对齐 dsh-wallpaper-engine 的分区）
 *
 * - 入口：顶栏调色按钮（Palette）直达，全局悬浮于内容之上（z 110，非模态 ——
 *   不挡操作，可边调效果边看壁纸变化）；
 * - 页签：壁纸 / 外观 / 字体 / 吉祥物 / 效果 / 高级，滑动胶囊指示器
 *   （framer-motion layoutId 平滑滑动），上次页签持久化；
 * - 壁纸选择弹窗由面板挂载（pickerOpen 来自 wallpaper-store，含上传/隐藏/恢复）。
 */
import {useEffect} from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {AnimatePresence, motion} from 'framer-motion';
import {X} from 'lucide-react';
import {cn} from '../../lib/utils';
import {useAppStore, type QuickSettingsTab} from '../../stores/app-store';
import {useWallpaperStore} from '../../stores/wallpaper-store';
import {WallpaperPickerModal} from '../wallpaper/WallpaperPickerModal';
import {AppearanceTab, FontTab, MascotTab} from './tabs-appearance';
import {AdvancedTab, EffectsTab, WallpaperTab} from './tabs-wallpaper';

/** 页签配置（顺序对齐插件的六分区） */
const TABS: Array<{id: QuickSettingsTab; labelKey: string}> = [
    {id: 'wallpaper', labelKey: 'settings.qs.tabWallpaper'},
    {id: 'appearance', labelKey: 'settings.qs.tabAppearance'},
    {id: 'font', labelKey: 'settings.qs.tabFont'},
    {id: 'mascot', labelKey: 'settings.qs.tabMascot'},
    {id: 'effects', labelKey: 'settings.qs.tabEffects'},
    {id: 'advanced', labelKey: 'settings.qs.tabAdvanced'},
];

/**
 * 悬浮快捷设置面板（全局单例；由 Layout 挂载，open 状态在 app-store）
 */
export function FloatingSettingsPanel() {
    const {t} = useTranslation();
    const open = useAppStore(s => s.ui.quickSettings.open);
    const tab = useAppStore(s => s.ui.quickSettings.tab);
    const setOpen = useAppStore(s => s.setQuickSettingsOpen);
    const setTab = useAppStore(s => s.setQuickSettingsTab);
    const pickerOpen = useWallpaperStore(s => s.pickerOpen);
    const setPickerOpen = useWallpaperStore(s => s.setPickerOpen);

    // ESC 关闭（面板与壁纸选择弹窗并存时弹窗优先 —— 弹窗自带 ESC 处理且 stopPropagation）
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, setOpen]);

    return createPortal(
        <>
            <AnimatePresence>
                {open && (
                    <motion.aside
                        initial={{x: 56, opacity: 0}}
                        animate={{x: 0, opacity: 1}}
                        exit={{x: 56, opacity: 0}}
                        transition={{type: 'spring', stiffness: 380, damping: 34}}
                        className="glass-panel fixed bottom-3 right-3 top-16 z-[110] flex w-[400px] max-w-[94vw] flex-col overflow-hidden rounded-2xl"
                        role="dialog"
                        aria-label={t('settings.qs.title')}
                    >
                        {/* 头部 */}
                        <div className="flex items-center justify-between px-4 pt-3.5">
                            <h3 className="text-sm font-semibold">{t('settings.qs.title')}</h3>
                            <button
                                type="button"
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() => setOpen(false)}
                                title={t('common.close')}
                            >
                                <X className="h-4 w-4"/>
                            </button>
                        </div>

                        {/* 页签栏（滑动胶囊指示器） */}
                        <div className="mt-2 flex items-center gap-0.5 overflow-x-auto px-3 pb-1">
                            {TABS.map(item => {
                                const active = tab === item.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setTab(item.id)}
                                        className={cn(
                                            'relative shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                                            active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                                        )}
                                    >
                                        {active && (
                                            <motion.span
                                                layoutId="qs-tab-pill"
                                                className="brand-gradient-soft absolute inset-0 rounded-full"
                                                transition={{type: 'spring', stiffness: 420, damping: 32}}
                                            />
                                        )}
                                        <span className="relative">{t(item.labelKey)}</span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mx-4 h-px bg-border/50"/>

                        {/* 内容 */}
                        <div className="flex-1 overflow-y-auto px-4 py-3">
                            {tab === 'wallpaper' && <WallpaperTab/>}
                            {tab === 'appearance' && <AppearanceTab/>}
                            {tab === 'font' && <FontTab/>}
                            {tab === 'mascot' && <MascotTab/>}
                            {tab === 'effects' && <EffectsTab/>}
                            {tab === 'advanced' && <AdvancedTab/>}
                        </div>
                    </motion.aside>
                )}
            </AnimatePresence>

            {/* 壁纸库弹窗（从壁纸页签触发；面板关闭时也保持可用状态由 store 管） */}
            <WallpaperPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)}/>
        </>,
        document.body
    );
}
