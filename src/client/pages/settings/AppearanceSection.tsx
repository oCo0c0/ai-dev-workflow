/**
 * @file AppearanceSection.tsx
 * @description 设置中心 - 外观设置面板。
 *
 * 提供界面外观的个性化配置：
 * - 中文字体：内置字体栈下拉（苹方/冬青黑体/微软雅黑/思源黑体/系统默认）+ 自定义字体栈输入
 * - 西文字体：内置字体栈下拉（Inter/系统 UI/Segoe UI/Roboto/JetBrains Mono）+ 自定义字体栈输入
 * - 字号：range 滑块（12-18px，步进 1），即时生效
 * - 主题：浅色/深色选项卡按钮（调 store 的 setTheme）
 * - 界面语言：中文/English 选项卡按钮（setLocale + i18n.changeLanguage）
 * - 底部实时预览条 + 恢复默认按钮
 *
 * 所有设置读写自 app-store 的 ui 分片；字体/字号变更由 store 写入
 * localStorage 并同步到 <html> 的 --app-font-* CSS 变量，全局即时生效。
 */

import {useMemo} from 'react';
import {useTranslation} from 'react-i18next';
import {Moon, RotateCcw, Sun} from 'lucide-react';
import {cn} from '../../lib/utils';
import {composeEnFontFamily, useAppStore} from '../../stores/app-store';
import {Card, CardContent, CardHeader, CardTitle} from '../../components/ui/card';
import {Input} from '../../components/ui/input';
import {Button} from '../../components/ui/button';

/** select 中"自定义"选项的哨兵值（仅用于展示当前处于自定义字体状态） */
const CUSTOM_VALUE = '__custom__';

/** 默认中文字体栈（与 app-store 的 DEFAULT_FONT_ZH 保持一致） */
const DEFAULT_FONT_ZH = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";

/** 默认西文字体栈（与 app-store 的 DEFAULT_FONT_EN 保持一致） */
const DEFAULT_FONT_EN = "'Inter', -apple-system, 'Segoe UI', sans-serif";

/** 默认基准字号 px（与 app-store 的 DEFAULT_FONT_SIZE 保持一致） */
const DEFAULT_FONT_SIZE = 14;

/** 中文字体内置选项（labelKey 为 i18n 键，value 为写入 store 的完整字体栈） */
const ZH_FONT_OPTIONS = [
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
const EN_FONT_OPTIONS = [
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
function isFontInstalled(fontFamily: string): boolean {
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
function firstQuotedFamily(stack: string): string | null {
    const m = stack.match(/'([^']+)'/);
    return m ? m[1] : null;
}

/** 下拉控件样式（沿用项目既有表单写法，见 MCPPage） */
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * 选项卡按钮样式（主题/语言二选一切换）
 * @param active - 是否为当前选中项
 */
function tabClass(active: boolean): string {
    return cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
            ? 'bg-accent text-accent-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
    );
}

/**
 * 外观设置面板组件
 * @returns 渲染的外观设置卡片（卡片式分区表单 + 实时预览条）
 */
export function AppearanceSection() {
    const {t, i18n} = useTranslation();
    // 从 ui 分片订阅外观设置与对应 actions（细粒度 selector，避免无关重渲染）
    const theme = useAppStore(s => s.ui.theme);
    const locale = useAppStore(s => s.ui.locale);
    const fontFamilyZh = useAppStore(s => s.ui.fontFamilyZh);
    const fontFamilyEn = useAppStore(s => s.ui.fontFamilyEn);
    const fontSize = useAppStore(s => s.ui.fontSize);
    const setTheme = useAppStore(s => s.setTheme);
    const setLocale = useAppStore(s => s.setLocale);
    const setFontFamily = useAppStore(s => s.setFontFamily);
    const setFontSize = useAppStore(s => s.setFontSize);
    const notificationsEnabled = useAppStore(s => s.ui.notificationsEnabled);
    const setNotificationsEnabled = useAppStore(s => s.setNotificationsEnabled);

    // 当前字体栈命中内置选项时取该选项，否则视为自定义（下拉显示"自定义"）
    const zhMatch = ZH_FONT_OPTIONS.find(o => o.value === fontFamilyZh);
    const enMatch = EN_FONT_OPTIONS.find(o => o.value === fontFamilyEn);

    /**
     * 切换界面语言：store 持久化 + i18next 运行时切换
     * （与 Layout.handleToggleLocale 相同逻辑，此处按目标语言直达）
     */
    const handleLocaleChange = (next: 'zh' | 'en') => {
        if (next === locale) return;
        setLocale(next);
        i18n.changeLanguage(next);
    };

    /** 恢复默认外观：字体栈重置为 store 默认常量值，字号重置为 14 */
    const handleReset = () => {
        setFontFamily(DEFAULT_FONT_ZH, DEFAULT_FONT_EN);
        setFontSize(DEFAULT_FONT_SIZE);
    };

    /**
     * 自定义字体栈输入回调：非空即写入 store（输入实时生效到预览与全局）
     * 空值跳过，避免清空输入时把无效空栈写入 CSS 变量
     */
    const handleCustomZh = (value: string) => {
        if (value.trim()) setFontFamily(value, fontFamilyEn);
    };
    const handleCustomEn = (value: string) => {
        if (value.trim()) setFontFamily(fontFamilyZh, value);
    };

    /** 各内置字体栈的本机可用性（首选项名未安装则整项禁用，挂载时检测一次） */
    const zhInstalled = useMemo(() => ZH_FONT_OPTIONS.map(o => isFontInstalled(firstQuotedFamily(o.value) ?? '')), []);
    const enInstalled = useMemo(() => EN_FONT_OPTIONS.map(o => isFontInstalled(firstQuotedFamily(o.value) ?? '')), []);

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t('settings.nav.appearance')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* 字体：中文/西文下拉 + 自定义输入 */}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                    {t('settings.appearance.fontZh')}
                                </label>
                                <select
                                    value={zhMatch ? zhMatch.value : CUSTOM_VALUE}
                                    onChange={(e) => {
                                        if (e.target.value !== CUSTOM_VALUE) {
                                            setFontFamily(e.target.value, fontFamilyEn);
                                        }
                                    }}
                                    className={SELECT_CLASS}
                                >
                                    {ZH_FONT_OPTIONS.map((opt, i) => (
                                        <option
                                            key={opt.value}
                                            value={opt.value}
                                            disabled={!zhInstalled[i] && opt.labelKey !== 'settings.appearance.fontSystemDefault'}
                                        >
                                            {t(opt.labelKey)}{!zhInstalled[i] ? t('settings.appearance.fontNotInstalled') : ''}
                                        </option>
                                    ))}
                                    <option value={CUSTOM_VALUE}>{t('settings.appearance.fontCustom')}</option>
                                </select>
                                <Input
                                    className="mt-2"
                                    value={zhMatch ? '' : fontFamilyZh}
                                    placeholder={t('settings.appearance.fontCustomPlaceholder')}
                                    onChange={(e) => handleCustomZh(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                    {t('settings.appearance.fontEn')}
                                </label>
                                <select
                                    value={enMatch ? enMatch.value : CUSTOM_VALUE}
                                    onChange={(e) => {
                                        if (e.target.value !== CUSTOM_VALUE) {
                                            setFontFamily(fontFamilyZh, e.target.value);
                                        }
                                    }}
                                    className={SELECT_CLASS}
                                >
                                    {EN_FONT_OPTIONS.map((opt, i) => (
                                        <option
                                            key={opt.value}
                                            value={opt.value}
                                            disabled={!enInstalled[i] && opt.labelKey !== 'settings.appearance.fontSystemUi'}
                                        >
                                            {t(opt.labelKey)}{!enInstalled[i] ? t('settings.appearance.fontNotInstalled') : ''}
                                        </option>
                                    ))}
                                    <option value={CUSTOM_VALUE}>{t('settings.appearance.fontCustom')}</option>
                                </select>
                                <Input
                                    className="mt-2"
                                    value={enMatch ? '' : fontFamilyEn}
                                    placeholder={t('settings.appearance.fontCustomPlaceholder')}
                                    onChange={(e) => handleCustomEn(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* 字号：range 滑块 12-18，即时生效 */}
                        <div>
                            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                {t('settings.appearance.fontSize')}
                            </label>
                            <div className="flex items-center gap-3">
                                <input
                                    type="range"
                                    min={12}
                                    max={18}
                                    step={1}
                                    value={fontSize}
                                    onChange={(e) => setFontSize(Number(e.target.value))}
                                    className="h-1.5 w-full cursor-pointer accent-primary"
                                />
                                <span className="w-12 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                                    {fontSize}px
                                </span>
                            </div>
                        </div>

                        <div className="h-px bg-border/60"/>

                        {/* 主题 / 界面语言：选项卡切换 */}
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                    {t('settings.appearance.theme')}
                                </label>
                                <div className="flex w-full rounded-lg border border-border/60 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => setTheme('light')}
                                        className={tabClass(theme === 'light')}
                                    >
                                        <Sun className="h-3.5 w-3.5"/>
                                        {t('settings.appearance.themeLight')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setTheme('dark')}
                                        className={tabClass(theme === 'dark')}
                                    >
                                        <Moon className="h-3.5 w-3.5"/>
                                        {t('settings.appearance.themeDark')}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                    {t('settings.appearance.language')}
                                </label>
                                <div className="flex w-full rounded-lg border border-border/60 p-0.5">
                                    <button
                                        type="button"
                                        onClick={() => handleLocaleChange('zh')}
                                        className={tabClass(locale === 'zh')}
                                    >
                                        {t('settings.appearance.langZh')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleLocaleChange('en')}
                                        className={tabClass(locale === 'en')}
                                    >
                                        {t('settings.appearance.langEn')}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="h-px bg-border/60"/>

                        {/* 任务通知开关：执行成功/失败时弹系统通知 */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-sm font-medium">{t('settings.appearance.notifications')}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {t('settings.appearance.notificationsDesc')}
                                </p>
                            </div>
                            <div className="flex w-40 shrink-0 rounded-lg border border-border/60 p-0.5">
                                <button
                                    type="button"
                                    onClick={() => setNotificationsEnabled(true)}
                                    className={tabClass(notificationsEnabled)}
                                >
                                    {t('settings.appearance.notificationsOn')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setNotificationsEnabled(false)}
                                    className={tabClass(!notificationsEnabled)}
                                >
                                    {t('settings.appearance.notificationsOff')}
                                </button>
                            </div>
                        </div>

                        <div className="h-px bg-border/60"/>

                        {/* 实时预览 + 恢复默认 */}
                        <div>
                            <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                                <p
                                    className="break-words"
                                    style={{
                                        fontFamily: composeEnFontFamily(fontFamilyEn, fontFamilyZh),
                                        fontSize: `${fontSize}px`,
                                    }}
                                >
                                    {t('settings.appearance.fontPreview')}
                                </p>
                            </div>
                            <div className="mt-3 flex justify-end">
                                <Button variant="outline" size="sm" onClick={handleReset}>
                                    <RotateCcw className="h-4 w-4"/>
                                    {t('settings.appearance.reset')}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
