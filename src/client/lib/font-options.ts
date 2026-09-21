/**
 * @file font-options.ts
 * @description 字体选项共享模块（原 AppearanceSection 内联常量/工具，供字体页签复用）
 */

/** select 中"自定义"选项的哨兵值（仅用于展示当前处于自定义字体状态） */
export const CUSTOM_FONT_VALUE = '__custom__';

/** 默认中文字体栈（与 app-store 的 DEFAULT_FONT_ZH 保持一致） */
export const DEFAULT_FONT_ZH = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** 默认西文字体栈（与 app-store 的 DEFAULT_FONT_EN 保持一致） */
export const DEFAULT_FONT_EN = "'Inter', -apple-system, 'Segoe UI', sans-serif";

/** 默认基准字号 px（与 app-store 的 DEFAULT_FONT_SIZE 保持一致） */
export const DEFAULT_FONT_SIZE = 14;

/** 中文字体内置选项（labelKey 为 i18n 键，value 为写入 store 的完整字体栈） */
export const ZH_FONT_OPTIONS = [
    {labelKey: 'settings.appearance.fontYaHei', value: "'Microsoft YaHei', sans-serif"},
    {labelKey: 'settings.appearance.fontSimSun', value: "'SimSun', 'NSimSun', serif"},
    {labelKey: 'settings.appearance.fontSimHei', value: "'SimHei', sans-serif"},
    {labelKey: 'settings.appearance.fontKaiTi', value: "'KaiTi', '楷体', serif"},
    {labelKey: 'settings.appearance.fontDengXian', value: "'DengXian', sans-serif"},
    {labelKey: 'settings.appearance.fontPingFang', value: "'PingFang SC', sans-serif"},
    {labelKey: 'settings.appearance.fontHiragino', value: "'Hiragino Sans GB', sans-serif"},
    {labelKey: 'settings.appearance.fontNotoSansSC', value: "'Noto Sans SC', sans-serif"},
    {labelKey: 'settings.appearance.fontSystemDefault', value: DEFAULT_FONT_ZH},
] as const;

/** 西文字体内置选项（"系统 UI"即应用默认西文栈） */
export const EN_FONT_OPTIONS = [
    {labelKey: 'settings.appearance.fontInter', value: "'Inter', sans-serif"},
    {labelKey: 'settings.appearance.fontSystemUi', value: DEFAULT_FONT_EN},
    {labelKey: 'settings.appearance.fontSegoeUi', value: "'Segoe UI', sans-serif"},
    {labelKey: 'settings.appearance.fontRoboto', value: "'Roboto', sans-serif"},
    {labelKey: 'settings.appearance.fontJetBrainsMono', value: "'JetBrains Mono', monospace"},
] as const;

/**
 * 检测本机是否安装了指定字体（canvas 测宽法）
 *
 * 原理：用待测字体与已知兜底字体(monospace/serif)分别渲染同一段混合文本，
 * 宽度与兜底完全一致则说明待测字体未命中（未安装）。
 *
 * @param fontFamily - 单个字体族名（如 "Microsoft YaHei"）
 * @returns 是否可用；canvas 不可用时视为可用（宁可不提示也不误禁）
 */
export function isFontInstalled(fontFamily: string): boolean {
    if (typeof document === 'undefined') return true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const sample = '中文字体测试 Abc 0123 楷宋';
    const widthOf = (font: string) => {
        ctx.font = `48px ${font}`;
        return ctx.measureText(sample).width;
    };
    const baseline = {mono: widthOf('monospace'), serif: widthOf('serif')};
    const probed = {mono: widthOf(`'${fontFamily}', monospace`), serif: widthOf(`'${fontFamily}', serif`)};
    return probed.mono !== baseline.mono || probed.serif !== baseline.serif;
}

/** 从字体栈中提取首个带引号的字体族名（用于安装检测），无引号名时返回 null */
export function firstQuotedFamily(stack: string): string | null {
    const m = stack.match(/'([^']+)'/);
    return m ? m[1] : null;
}
