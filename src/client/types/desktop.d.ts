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
            /** 同步窗口控制按钮覆盖层配色（已弃用覆盖层，保留为 no-op） */
            setWindowControlsTheme: (mode: 'light' | 'dark') => void;
            /** 显示/隐藏桌面宠物悬浮窗（透明置顶小窗；非桌面端为 no-op） */
            setPetVisible: (visible: boolean) => void;
            /** 自绘窗口控制按钮：最小化 / 最大化切换 / 关闭（走既有关闭行为询问） */
            windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => void;
            /** 订阅主窗口最大化状态变化，返回取消订阅函数 */
            onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
            /** 上报主窗口输入活动（鼠标点击；键盘由主进程直接捕获） */
            notifyInputActivity: (kind: 'mouse') => void;
            /** 宠物窗口订阅输入镜像事件（Bongo Cat 敲击），返回取消订阅函数 */
            onPetInput: (callback: (input: {kind: 'key' | 'mouse'; side: 'left' | 'right'}) => void) => () => void;
        };
    }
}
