/**
 * @file jumpbar-geometry.ts
 * @description 消息跳转栏的几何计算（纯函数，便于确定性验证）。
 *
 * 竖条改为「贴日志面板右缘」后，位置不再能写死：左侧菜单栏与执行列表都能拖拽调宽，
 * 右侧工作区面板还能开合 —— 水平位置必须由「视口宽度 + 面板右缘实测值」算出。
 */

/** 竖条右边缘距视口右侧的距离（px） */
export function railRightFor(viewportWidth: number, panelRightEdge: number, inset = 6): number {
    if (!Number.isFinite(viewportWidth) || !Number.isFinite(panelRightEdge)) return inset;
    const distance = Math.round(viewportWidth - panelRightEdge);
    return Math.max(0, distance) + inset;
}

/** 悬停预览卡宽度（Tailwind w-56 = 224px）与间距 */
export const PREVIEW_WIDTH = 224;
export const PREVIEW_GAP = 12;

/**
 * 悬停预览卡的水平位置：在节点**左侧**展开（竖条已贴右缘，向右展开会溢出视口），
 * 且不越出视口左缘。
 */
export function previewLeftFor(nodeLeft: number, minLeft = 8): number {
    if (!Number.isFinite(nodeLeft)) return minLeft;
    return Math.max(minLeft, Math.round(nodeLeft - PREVIEW_WIDTH - PREVIEW_GAP));
}
