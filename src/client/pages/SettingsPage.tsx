/**
 * @file SettingsPage.tsx
 * @description 设置中心页面 —— 左侧二级分类栏 + 右侧内容区。
 *
 * - 分类栏：环境体检 / 模型供应商 / MCP / Skills / 数据（点击切换 /settings/<section>，
 *   当前项高亮；窄屏下收窄为纯图标列，label 隐藏、以 title 提示）
 * - 外观 / 壁纸 / 字体 / 吉祥物 / 效果 / 高级 已迁至顶栏调色按钮唤出的
 *   「悬浮快捷设置面板」（FloatingSettingsPanel），不再占用设置中心栏目；
 * - 右侧按 section 渲染对应面板：
 *   - environment     → EnvironmentSection（环境体检）
 *   - model-providers → ModelProvidersPage（原独立页组件直接嵌入）
 *   - mcp             → MCPPage（同上）
 *   - skills          → SkillsPage（同上）
 *   - data            → DataSection（配置导入/导出）
 * - 未知或缺失 section 时重定向到 /settings/environment
 */

import {NavLink, Navigate, useLocation} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Cpu, Database, MonitorCheck, Plug, Zap} from 'lucide-react';
import {cn} from '../lib/utils';
import {DataSection} from './settings/DataSection';
import {EnvironmentSection} from './settings/EnvironmentSection';
import ModelProvidersPage from './ModelProvidersPage';
import MCPPage from './MCPPage';
import SkillsPage from './SkillsPage';

/** 设置分类配置（id 即 /settings/:section 的路由参数值） */
const SECTIONS = [
    {id: 'environment', labelKey: 'settings.nav.environment', icon: MonitorCheck},
    {id: 'model-providers', labelKey: 'settings.nav.modelProviders', icon: Cpu},
    {id: 'mcp', labelKey: 'settings.nav.mcp', icon: Plug},
    {id: 'skills', labelKey: 'settings.nav.skills', icon: Zap},
    {id: 'data', labelKey: 'settings.nav.data', icon: Database},
] as const;

/**
 * 设置中心页面组件
 *
 * @description 外层 flex 双栏：左侧 ~200px 分类栏（窄屏 52px 收窄），
 * 右侧内容区为确定高度 + 纵向滚动的容器，按 section 条件渲染对应组件。
 */
export default function SettingsPage() {
    const {t} = useTranslation();
    const location = useLocation();

    // keep-alive 常驻：非设置路径时本页处于隐藏态，不渲染、不重定向
    // （否则切到其他导航页时这里会误触发 Navigate）
    if (!location.pathname.startsWith('/settings')) return null;

    // section 从路径解析而非路由参数：keep-alive 方案下页面不经过路由匹配
    // （Layout 常驻渲染），/settings/:section 的 params 拿不到
    const section = location.pathname.split('/')[2];

    // 未知/缺失 section（含旧链接 /settings/appearance、/settings/wallpaper）：
    // 统一重定向到环境体检（replace 避免污染历史记录）
    if (!section || !SECTIONS.some((s) => s.id === section)) {
        return <Navigate to="/settings/environment" replace/>;
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
                {section === 'environment' && <EnvironmentSection/>}
                {section === 'model-providers' && <ModelProvidersPage/>}
                {section === 'mcp' && <MCPPage/>}
                {section === 'skills' && <SkillsPage/>}
                {section === 'data' && <DataSection/>}
            </div>
        </div>
    );
}
