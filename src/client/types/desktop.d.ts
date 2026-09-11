/**
 * 桌面版（Electron）注入的全局 API 类型声明
 *
 * 由 src/electron/preload.ts 经 contextBridge 暴露；
 * 浏览器环境该对象不存在，业务代码应以 window.adwDesktop?. 形式访问。
 */

export {};

declare global {
    interface Window {
        adwDesktop?: {
            /** 同步窗口控制按钮覆盖层配色（明暗模式） */
            setWindowControlsTheme: (mode: 'light' | 'dark') => void;
        };
    }
}
