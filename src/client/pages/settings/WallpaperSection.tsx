/**
 * @file WallpaperSection.tsx
 * @description 设置中心「壁纸」分区 —— 引导卡片
 *
 * 壁纸/外观/字体/吉祥物/效果/高级 已升级为顶栏调色按钮唤出的「悬浮快捷设置面板」
 * （FloatingSettingsPanel，对齐 dsh-wallpaper-engine 的六页签设计）。
 * 本分区保留路由（/settings/wallpaper）并引导用户前往悬浮面板。
 */
import {useTranslation} from 'react-i18next';
import {PanelRightOpen} from 'lucide-react';
import {Card, CardContent} from '../../components/ui/card';
import {useAppStore} from '../../stores/app-store';

export function WallpaperSection() {
    const {t} = useTranslation();
    const setQuickSettingsOpen = useAppStore(s => s.setQuickSettingsOpen);
    const setQuickSettingsTab = useAppStore(s => s.setQuickSettingsTab);

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                        <PanelRightOpen className="h-10 w-10 text-muted-foreground/40"/>
                        <p className="text-sm font-semibold">{t('settings.qs.movedTitle')}</p>
                        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                            {t('settings.qs.movedDesc')}
                        </p>
                        <button
                            type="button"
                            className="mt-1 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                            onClick={() => {
                                setQuickSettingsTab('wallpaper');
                                setQuickSettingsOpen(true);
                            }}
                        >
                            {t('settings.qs.openPanel')}
                        </button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
