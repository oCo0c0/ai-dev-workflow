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
});
