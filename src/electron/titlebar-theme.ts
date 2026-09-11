/**
 * 窗口控制按钮覆盖层配色（Windows titleBarOverlay）
 *
 * 覆盖层颜色在窗口创建时静态指定，主题切换后需经
 * win.setTitleBarOverlay() 运行时更新；配色必须与前端
 * 顶栏实际底色一致（深色 = 主背景 hsl(203 50% 16%)，
 * 浅色 = 顶栏浅底 hsl(240 5% 97%) 附近）。
 */

export interface OverlayColors {
    /** 按钮区底色（与顶栏融为一体） */
    color: string;
    /** 最小化/最大化/关闭符号颜色 */
    symbolColor: string;
}

/**
 * 按明暗模式返回覆盖层配色
 *
 * @param mode - 'light' | 'dark'（对应 THEME_MODES 的明暗模式）
 */
export function overlayColorsFor(mode: 'light' | 'dark'): OverlayColors {
    return mode === 'light'
        ? {color: '#f4f4f5', symbolColor: '#3f3f46'}
        : {color: '#142d3c', symbolColor: '#e2e8f0'};
}
