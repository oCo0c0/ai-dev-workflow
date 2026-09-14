/**
 * 窗口标题栏配色（单一事实来源）
 *
 * 前端（顶栏实色 CSS 变量）与 Electron 主进程（titleBarOverlay 覆盖层）
 * 共用同一组常量，保证三个窗口控制按钮与顶栏底色像素级一致；
 * 任何一侧不得另设色值。
 *
 * 深色 = 应用主背景 hsl(203 50% 16%)；浅色 = 顶栏浅底 hsl(240 5% 97%)。
 */

export interface OverlayColors {
    /** 按钮区底色（与顶栏融为一体） */
    color: string;
    /** 最小化/最大化/关闭符号颜色 */
    symbolColor: string;
}

export const OVERLAY_COLORS: Record<'light' | 'dark', OverlayColors> = {
    light: {color: '#f4f4f5', symbolColor: '#3f3f46'},
    dark: {color: '#142d3c', symbolColor: '#e2e8f0'},
};

/**
 * 按明暗模式返回覆盖层配色
 *
 * @param mode - 'light' | 'dark'（对应 THEME_MODES 的明暗模式）
 */
export function overlayColorsFor(mode: 'light' | 'dark'): OverlayColors {
    return OVERLAY_COLORS[mode];
}
