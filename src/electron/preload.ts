/**
 * 预加载脚本（渲染进程桥）
 *
 * 以 contextBridge 暴露最小桌面 API；浏览器/Web 模式下 window.adwDesktop 不存在，
 * 调用方一律以可选链访问。
 */

import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('adwDesktop', {
    /**
     * 主题明暗变化时同步窗口控制按钮覆盖层配色
     * （仅 Windows 无边框模式实际生效，主进程侧静默忽略其余平台）
     */
    setWindowControlsTheme: (mode: 'light' | 'dark'): void => {
        ipcRenderer.send('adw:set-window-controls-theme', mode);
    },

    /**
     * 显示/隐藏桌面宠物悬浮窗（Bongo Cat 透明置顶小窗）
     * 由悬浮设置面板「吉祥物」页签驱动；主进程幂等（重复 show/hide 无副作用）
     */
    setPetVisible: (visible: boolean): void => {
        ipcRenderer.send('adw:set-pet-visible', visible);
    },

    /**
     * 自绘窗口控制按钮（titleBarStyle hidden 无原生覆盖层）
     * minimize / toggle-maximize / close（close 走主进程既有关闭行为询问）
     */
    windowControl: (action: 'minimize' | 'toggle-maximize' | 'close'): void => {
        ipcRenderer.send('adw:window-control', action);
    },

    /** 订阅主窗口最大化状态变化（自绘最大化/还原图标切换），返回取消订阅函数 */
    onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized);
        ipcRenderer.on('adw:maximize-changed', handler);
        return () => ipcRenderer.removeListener('adw:maximize-changed', handler);
    },

    /**
     * 上报主窗口输入活动（鼠标点击；键盘由主进程 before-input-event 直接捕获）
     * 主进程统一转发给宠物窗口做 Bongo Cat 敲击镜像
     */
    notifyInputActivity: (kind: 'mouse'): void => {
        ipcRenderer.send('adw:input-activity', kind);
    },

    /** 宠物窗口订阅输入镜像事件（kind: key|mouse + 敲击侧），返回取消订阅函数 */
    onPetInput: (callback: (input: {kind: 'key' | 'mouse'; side: 'left' | 'right'}) => void): (() => void) => {
        const handler = (_event: Electron.IpcRendererEvent, input: {kind: 'key' | 'mouse'; side: 'left' | 'right'}): void => callback(input);
        ipcRenderer.on('adw:pet-input', handler);
        return () => ipcRenderer.removeListener('adw:pet-input', handler);
    },
});
