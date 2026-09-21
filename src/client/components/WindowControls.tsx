/**
 * @file WindowControls.tsx
 * @description 自绘窗口控制按钮（仅桌面端渲染）—— 最小化 / 最大化切换 / 关闭
 *
 * 背景：Windows 原生 titleBarOverlay 会在窗口顶部画一条不透明实色条，
 * 把玻璃顶栏的毛玻璃/壁纸透明效果整条盖死。改用自绘按钮（titleBarStyle hidden
 * 无覆盖层）后，顶栏回归液态玻璃。关闭走主进程既有关闭行为询问（托盘/退出）。
 * 双击顶栏拖拽区（app-drag）切换最大化由系统默认行为提供。
 *
 * 已知取舍：Win11 悬停最大化按钮的「吸附布局」弹层是原生按钮专属，自绘后不可用。
 */
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Copy, Minus, Square, X} from 'lucide-react';
import {cn} from '../lib/utils';

const BTN_CLASS = 'flex h-8 w-11 items-center justify-center text-muted-foreground transition-colors app-no-drag';

export function WindowControls() {
    const {t} = useTranslation();
    const [maximized, setMaximized] = useState(false);

    useEffect(() => {
        const off = window.adwDesktop?.onMaximizeChange?.(setMaximized);
        return () => off?.();
    }, []);

    // Web 模式（浏览器）不渲染：window controls 仅桌面端存在
    if (typeof window === 'undefined' || !window.adwDesktop) return null;
    const desktop = window.adwDesktop;

    return (
        <div className="ml-1 flex items-center app-no-drag">
            <button
                type="button"
                className={cn(BTN_CLASS, 'hover:bg-accent hover:text-foreground')}
                title={t('common.winMinimize')}
                onClick={() => desktop.windowControl('minimize')}
            >
                <Minus className="h-4 w-4"/>
            </button>
            <button
                type="button"
                className={cn(BTN_CLASS, 'hover:bg-accent hover:text-foreground')}
                title={maximized ? t('common.winRestore') : t('common.winMaximize')}
                onClick={() => desktop.windowControl('toggle-maximize')}
            >
                {maximized ? <Copy className="h-3.5 w-3.5"/> : <Square className="h-3.5 w-3.5"/>}
            </button>
            <button
                type="button"
                className={cn(BTN_CLASS, 'hover:bg-destructive hover:text-destructive-foreground')}
                title={t('common.winClose')}
                onClick={() => desktop.windowControl('close')}
            >
                <X className="h-4 w-4"/>
            </button>
        </div>
    );
}
