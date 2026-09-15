/**
 * @file SettingsPage.tsx
 * @description 设置中心页面 —— 左侧二级分类栏 + 右侧内容区。
 *
 * - 分类栏四项：外观 / 模型供应商 / MCP / Skills，点击切换 /settings/<section>，
 *   当前项高亮（窄屏下收窄为纯图标列，label 隐藏、以 title 提示）
 * - 右侧按 useParams 的 section 渲染对应面板：
 *   - appearance      → AppearanceSection（设置中心专属外观面板）
 *   - model-providers → ModelProvidersPage（原独立页组件直接嵌入）
 *   - mcp             → MCPPage（同上）
 *   - skills          → SkillsPage（同上）
 * - 未知或缺失 section 时重定向到 /settings/appearance
 *
 * 被嵌入的三个页面原为全屏页（根容器 `p-6 h-full flex flex-col`），
 * 右侧内容区提供确定高度（h-full 链路）与 overflow-y-auto，
 * 其内部分栏的滚动行为与嵌入前保持一致；页面内部的 useGuide（Joyride）
 * 引导逻辑不受嵌入影响。
 */

import {NavLink, Navigate, useParams} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Cpu, Plug, SlidersHorizontal, Zap} from 'lucide-react';
import {cn} from '../lib/utils';
import {AppearanceSection} from './settings/AppearanceSection';
import ModelProvidersPage from './ModelProvidersPage';
import MCPPage from './MCPPage';
import SkillsPage from './SkillsPage';

/** 设置分类配置（id 即 /settings/:section 的路由参数值） */
const SECTIONS = [
    {id: 'appearance', labelKey: 'settings.nav.appearance', icon: SlidersHorizontal},
    {id: 'model-providers', labelKey: 'settings.nav.modelProviders', icon: Cpu},
    {id: 'mcp', labelKey: 'settings.nav.mcp', icon: Plug},
    {id: 'skills', labelKey: 'settings.nav.skills', icon: Zap},
] as const;

/**
 * 设置中心页面组件
 *
 * @description 外层 flex 双栏：左侧 ~200px 分类栏（窄屏 52px 收窄），
 * 右侧内容区为确定高度 + 纵向滚动的容器，按 section 条件渲染对应组件。
 */
export default function SettingsPage() {
    const {t} = useTranslation();
    const {section} = useParams<{section?: string}>();

    // 未知/缺失 section：统一重定向回外观设置（replace 避免污染历史记录）
    if (!section || !SECTIONS.some((s) => s.id === section)) {
        return <Navigate to="/settings/appearance" replace/>;
    }

    return (
        <div className="flex h-full overflow-hidden">
            {/* 左侧分类栏 */}
            <nav className="w-[52px] md:w-[200px] shrink-0 border-r border-border/50 px-2 py-3">
                <p className="hidden md:block px-3 pb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('settings.title')}
                </p>
                <div className="space-y-1">
                    {SECTIONS.map((item) => {
                        const Icon = item.icon;
                        const label = t(item.labelKey);
                        return (
                            <NavLink
                                key={item.id}
                                to={`/settings/${item.id}`}
                                className={({isActive}) =>
                                    cn(
                                        'flex items-center justify-center md:justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                                        isActive
                                            ? 'brand-gradient-soft text-primary'
                                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                                    )
                                }
                                title={label}
                            >
                                {({isActive}) => (
                                    <>
                                        <Icon
                                            className={cn(
                                                'h-4 w-4 shrink-0 transition-colors',
                                                isActive && 'text-primary'
                                            )}
                                        />
                                        <span className="hidden md:inline truncate">{label}</span>
                                    </>
                                )}
                            </NavLink>
                        );
                    })}
                </div>
            </nav>

            {/* 右侧内容区：确定高度 + 纵向滚动，嵌入页根容器 h-full 在此正常撑满 */}
            <div className="flex-1 min-w-0 h-full overflow-y-auto">
                {section === 'appearance' && <AppearanceSection/>}
                {section === 'model-providers' && <ModelProvidersPage/>}
                {section === 'mcp' && <MCPPage/>}
                {section === 'skills' && <SkillsPage/>}
            </div>
        </div>
    );
}
