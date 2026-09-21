/**
 * @file appearance.ts
 * @description 外观引擎 —— 配色（accent）与玻璃底色（glassColor）的 CSS 变量注入
 *
 * 设计参考 dsh-wallpaper-engine（MIT）的「配色 + 玻璃颜色」双旋钮：
 * - 配色管控件（按钮/开关/滑块/高光/品牌渐变），玻璃颜色管玻璃面板底色；
 * - 通过 <html> 内联 CSS 变量覆盖样式表 token（内联优先级高于 :root/.dark），
 *   深浅主题统一使用同一配色（与插件行为一致）；
 * - null = 恢复跟随主题（removeProperty 回退到样式表默认值）。
 */

/** 品牌配色对（from→to 渐变两端，hex） */
export interface AccentPair {
    from: string;
    to: string;
}

/** 内置配色预设（6 种，参考插件「6 预设 + 自定义取色」） */
export const ACCENT_PRESETS: Array<{id: string; from: string; to: string}> = [
    {id: 'classic', from: '#ed4545', to: '#f8788d'},   // 经典红（应用默认）
    {id: 'ocean', from: '#3b82f6', to: '#60a5fa'},     // 冰蓝
    {id: 'midnight', from: '#0ea5e9', to: '#38bdf8'},  // 深海蓝
    {id: 'violet', from: '#8b5cf6', to: '#a78bfa'},    // 紫罗兰
    {id: 'emerald', from: '#10b981', to: '#34d399'},   // 翠绿
    {id: 'sunset', from: '#f97316', to: '#fb923c'},    // 暖橙
];

/** 内置玻璃底色预设（6 种；null = 跟随主题） */
export const GLASS_COLOR_PRESETS: Array<{id: string; hex: string}> = [
    {id: 'white', hex: '#ffffff'},
    {id: 'nightblue', hex: '#1e2735'},
    {id: 'warmgray', hex: '#f5f2ee'},
    {id: 'mint', hex: '#eef7f2'},
    {id: 'sakura', hex: '#fdf1f5'},
    {id: 'graphite', hex: '#2a2a2e'},
];

/** hex (#rgb/#rrggbb) → HSL（h: 0-360, s/l: 0-100） */
export function hexToHsl(hex: string): {h: number; s: number; l: number} {
    let cleaned = hex.replace(/^#/, '').trim();
    if (cleaned.length === 3) {
        cleaned = cleaned.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return {h: 0, s: 82, l: 60};
    const r = parseInt(cleaned.slice(0, 2), 16) / 255;
    const g = parseInt(cleaned.slice(2, 4), 16) / 255;
    const b = parseInt(cleaned.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return {h: 0, s: 0, l: Math.round(l * 100)};
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h: number;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return {
        h: Math.round(h * 60),
        s: Math.round(s * 100),
        l: Math.round(l * 100),
    };
}

/** HSL 三元组 → Tailwind token 字符串（"H S% L%"） */
function triplet(hex: string): string {
    const {h, s, l} = hexToHsl(hex);
    return `${h} ${s}% ${l}%`;
}

/** 提亮 hex 颜色（l + amount，0-100 夹取）→ hex，用于从自定义主色派生渐变亮端 */
export function lightenHex(hex: string, amount: number): string {
    const {h, s, l} = hexToHsl(hex);
    const nl = Math.min(100, l + amount);
    const sn = s / 100;
    const ln = nl / 100;
    const c = (1 - Math.abs(2 * ln - 1)) * sn;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = ln - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const to255 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/**
 * 应用配色：覆盖 --brand-from/to、--primary、--ring 与背景光晕的色相。
 * pair = null 时移除内联覆盖，恢复样式表主题默认（经典红）。
 */
export function applyAccent(pair: AccentPair | null): void {
    if (typeof document === 'undefined') return;
    const style = document.documentElement.style;
    if (!pair) {
        for (const v of ['--brand-from', '--brand-to', '--primary', '--ring',
            '--bg-glow-1', '--bg-glow-2', '--bg-glow-3']) {
            style.removeProperty(v);
        }
        return;
    }
    const from = triplet(pair.from);
    const to = triplet(pair.to);
    style.setProperty('--brand-from', from);
    style.setProperty('--brand-to', to);
    style.setProperty('--primary', from);
    style.setProperty('--ring', from);
    // 背景光晕跟随品牌色相（深浅主题共用一组折中 alpha：比浅色深一点、比深色淡一点）
    style.setProperty('--bg-glow-1', `${from} / 0.26`);
    style.setProperty('--bg-glow-2', `${to} / 0.20`);
    style.setProperty('--bg-glow-3', `${from} / 0.14`);
}

/**
 * 应用玻璃底色：覆盖 .glass/.glass-sidebar/.glass-card/.glass-panel 的底色 token。
 * hex = null 时移除覆盖，恢复「跟随主题」。
 */
export function applyGlassColor(hex: string | null): void {
    if (typeof document === 'undefined') return;
    const style = document.documentElement.style;
    const vars = ['--glass-bar-bg', '--glass-card-bg', '--glass-panel-bg'];
    if (!hex) {
        for (const v of vars) style.removeProperty(v);
        return;
    }
    const t = triplet(hex);
    for (const v of vars) style.setProperty(v, t);
}
