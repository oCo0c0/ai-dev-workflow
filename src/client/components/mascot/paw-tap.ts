/**
 * @file paw-tap.ts
 * @description Bongo Cat 爪子敲击的命令式触发 —— 直接操作 SVG class 重启动画，
 * 免去每次按键的 React 重渲染（快速输入时每秒可达 20+ 次敲击）。
 */

/** 每侧爪子的收尾定时器（动画结束后摘掉 tap 类，让 typing 循环动画干净恢复） */
const timers = new Map<string, number>();

/**
 * 让指定侧的爪子敲一下
 * @param root 包含 .bongo-cat 的容器元素
 * @param side 左爪 / 右爪
 */
export function tapPaw(root: HTMLElement | null, side: 'left' | 'right'): void {
    if (!root) return;
    const paw = root.querySelector(side === 'left' ? '.bongo-cat__paw--l' : '.bongo-cat__paw--r');
    if (!paw) return;
    const el = paw as SVGGraphicsElement;
    // 摘类 → 强制 reflow → 挂类：连续快速敲击时也能每次重新触发动画
    el.classList.remove('paw-tap');
    void el.getBoundingClientRect();
    el.classList.add('paw-tap');
    const prev = timers.get(side);
    if (prev) clearTimeout(prev);
    timers.set(side, window.setTimeout(() => {
        el.classList.remove('paw-tap');
        timers.delete(side);
    }, 180));
}
