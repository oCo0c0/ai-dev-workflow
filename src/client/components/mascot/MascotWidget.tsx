/**
 * @file MascotWidget.tsx
 * @description 应用内吉祥物悬浮组件（**仅 Web 模式**降级宿主）
 *
 * - 桌面端（Electron）不渲染 —— 宠物只保留独立透明悬浮窗（PetRoot），避免双份；
 * - Web 模式固定在应用右下角，两路敲击：agent 活动流 + 用户输入镜像
 *   （键盘/鼠标直改 SVG class）；
 * - 状态气泡 + 形象/大小/气泡偏好来自 app-store 的 ui.mascot。
 */
import {useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {useAppStore} from '../../stores/app-store';
import {useAgentActivity} from '../../hooks/useAgentActivity';
import {isModifierOnly, pawSideOfCode} from '../../lib/paw-side';
import {PetAvatar} from './pets';
import {tapPaw} from './paw-tap';

export function MascotWidget() {
    const {t} = useTranslation();
    const enabled = useAppStore(s => s.ui.mascot.enabled);
    const size = useAppStore(s => s.ui.mascot.size);
    const bubble = useAppStore(s => s.ui.mascot.bubble);
    const form = useAppStore(s => s.ui.mascot.form);
    const activity = useAgentActivity();
    const containerRef = useRef<HTMLDivElement>(null);
    const parityRef = useRef(false);

    // 桌面端只保留独立悬浮窗（用户要求：应用内不再出现第二只）；Web 才降级显示
    const isDesktop = typeof window !== 'undefined' && Boolean(window.adwDesktop);
    const showWidget = enabled && !isDesktop;

    // Web：用户输入镜像（应用内键盘/鼠标直接监听；hook 无条件调用满足规则）
    useEffect(() => {
        if (!showWidget) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.isComposing || isModifierOnly(e.code)) return;
            parityRef.current = !parityRef.current;
            tapPaw(containerRef.current, pawSideOfCode(e.code, parityRef.current));
        };
        const onMouseDown = () => {
            parityRef.current = !parityRef.current;
            tapPaw(containerRef.current, parityRef.current ? 'left' : 'right');
        };
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('mousedown', onMouseDown, true);
        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('mousedown', onMouseDown, true);
        };
    }, [showWidget]);

    if (!showWidget) return null;

    return (
        <div
            ref={containerRef}
            className="fixed bottom-3 right-4 z-[90] flex flex-col items-center gap-1 select-none"
            style={{width: 150 * size}}
        >
            {bubble && activity.labelKey && (
                <div
                    className="glass-card max-w-full truncate rounded-xl px-3 py-1.5 text-xs font-medium shadow-apple"
                    title={t(activity.labelKey)}
                >
                    {t(activity.labelKey)}
                </div>
            )}
            <PetAvatar form={form} mood={activity.mood} width={150 * size} className="drop-shadow-apple"/>
        </div>
    );
}
