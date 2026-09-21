/**
 * @file PetRoot.tsx
 * @description 桌面宠物悬浮窗根组件（Electron 透明窗口专属页面，`?pet=1` 分支加载）
 *
 * 窗口特性（见 src/electron/main.ts createPetWindow）：
 * - 透明 + 无边框 + 置顶（screen-saver 层）+ 不进任务栏 + 不可聚焦（不打断输入）；
 * - 整个窗口是拖拽区（-webkit-app-region: drag，body.pet-window）；
 * - 通过 ?pet=1 查询参数进入本分支，主应用其余界面完全不加载交互层。
 *
 * 两路敲击来源：
 * - agent 活动流（useAgentActivity：执行/计划/测试输出 → 持续打字；完成 → 表情），
 *   自持 /ws 连接与主窗口解耦，主窗口最小化到托盘后宠物依然实时播报；
 * - 用户输入镜像（主窗口键盘经 before-input-event 捕获、鼠标经 IPC 上报，主进程
 *   统一转发 adw:pet-input）—— 你在应用里敲键盘/点鼠标，猫就对应敲左/右爪。
 */
import {useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {useAppStore} from '../../stores/app-store';
import {useAgentActivity} from '../../hooks/useAgentActivity';
import {PetAvatar} from './pets';
import {tapPaw} from './paw-tap';

export default function PetRoot() {
    const {t} = useTranslation();
    const activity = useAgentActivity();
    const form = useAppStore(s => s.ui.mascot.form);
    const containerRef = useRef<HTMLDivElement>(null);

    // 用户输入镜像（主进程转发；事件驱动直改 DOM class，不经过 React 状态）
    useEffect(() => {
        const off = window.adwDesktop?.onPetInput?.((input) => {
            tapPaw(containerRef.current, input.side);
        });
        return () => off?.();
    }, []);

    return (
        <div ref={containerRef} className="pet-root flex flex-col items-center gap-1 select-none">
            {activity.labelKey && (
                <div className="pet-bubble max-w-[220px] truncate rounded-xl px-3 py-1.5 text-xs font-medium">
                    {t(activity.labelKey)}
                </div>
            )}
            <PetAvatar form={form} mood={activity.mood} width={210}/>
        </div>
    );
}
