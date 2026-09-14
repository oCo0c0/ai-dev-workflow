/**
 * 窗口控制按钮覆盖层配色（Windows titleBarOverlay）
 *
 * 配色常量单一来源在 src/shared/titlebar-colors.ts（前端顶栏实色与
 * 覆盖层共用），本模块仅为 Electron 侧的类型化再导出。
 */

export {overlayColorsFor, type OverlayColors} from '../shared/titlebar-colors';
