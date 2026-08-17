/**
 * @file Layout.tsx
 * @description 应用主布局组件 —— 提供侧边栏导航 + 顶部工具栏 + 内容区域的经典三栏式布局结构。
 *
 * 职责包括：
 * - 侧边栏：展示导航菜单项、Logo 区域、WebSocket 连接状态指示器
 * - 顶部栏：页面标题、侧边栏折叠/展开切换按钮、语言切换、明暗主题切换按钮
 * - 内容区域：通过 React Router 的 <Outlet /> 渲染当前路由对应的子页面
 * - 响应式处理：窗口宽度小于 1024px 时自动折叠侧边栏
 * - 全局初始化：启动 WebSocket 连接、注册键盘快捷键
 */

import {useEffect, useState, useRef, type ChangeEvent} from 'react';
import {NavLink, Outlet, useLocation} from 'react-router-dom';
import {AnimatePresence, motion} from 'framer-motion';
import {useTranslation} from 'react-i18next';
import {useAppStore, type Theme} from '../stores/app-store';
import {useKeyboardShortcuts} from '../hooks/useKeyboardShortcuts';
import {useWebSocket} from '../hooks/useWebSocket';
import SetupWizard from './SetupWizard';
import {cn} from '../lib/utils';
import {
    FileText,
    FolderOpen,
    FileCode,
    Play,
    TestTube,
    Zap,
    Plug,
    GitBranch,
    PanelLeftClose,
    PanelLeft,
    Palette,
    FileSearch,
    FolderKanban,
    Languages,
    Bot,
    Terminal,
    Cpu,
    ImagePlus,
    Trash2,
    Sparkles,
} from 'lucide-react';
import {ProviderSetupModal} from './ProviderSetupModal';
import {ModelConfigModal} from './ModelConfigModal';

/**
 * 侧边栏导航菜单项配置数组
 */
const navItems = [
    {path: '/', labelKey: 'nav.requirements', icon: FileText},
    {path: '/workspace', labelKey: 'nav.workspace', icon: FolderOpen},
    {path: '/agent-execution', labelKey: 'nav.agentExecution', icon: Bot},
    {path: '/pipelines', labelKey: 'nav.pipelines', icon: GitBranch},
    {path: '/plan', labelKey: 'nav.plan', icon: FileCode},
    {path: '/execution', labelKey: 'nav.execution', icon: Play},
    {path: '/tests', labelKey: 'nav.tests', icon: TestTube},
    {path: '/projects', labelKey: 'nav.projects', icon: FolderKanban},
    {path: '/model-providers', labelKey: 'nav.modelProviders', icon: Cpu},
    {path: '/mcp', labelKey: 'nav.mcp', icon: Plug},
    {path: '/skills', labelKey: 'nav.skills', icon: Zap},
    {path: '/mineru', labelKey: 'nav.mineru', icon: FileSearch},
];

/**
 * 页面路由路径到 i18n key 的映射表
 */
const pageTitleKeys: Record<string, string> = {
    '/': 'pageTitle.requirements',
    '/projects': 'pageTitle.projects',
    '/workspace': 'pageTitle.workspace',
    '/agent-execution': 'pageTitle.agentExecution',
    '/plan': 'pageTitle.plan',
    '/execution': 'pageTitle.execution',
    '/tests': 'pageTitle.tests',
    '/skills': 'pageTitle.skills',
    '/mcp': 'pageTitle.mcp',
    '/model-providers': 'pageTitle.modelProviders',
    '/pipelines': 'pageTitle.pipelines',
    '/mineru': 'pageTitle.mineru',
};

/**
 * 主题切换器选项（id 对应 Theme 类型；swatch 为色块预览色）
 */
const THEME_OPTIONS: {id: Theme; labelKey: string; swatch: string}[] = [
    {id: 'light', labelKey: 'common.themeLight', swatch: '#f7f7f8'},
    {id: 'dark', labelKey: 'common.themeDark', swatch: '#1e1f21'},
];

/**
 * 将选择的图片压缩为背景照片 dataURL
 * 限制最长边 1920px、JPEG 质量 0.82，避免超出 localStorage 容量。
 * @param file   用户选择的图片文件
 * @param maxDim 缩放后的最长边
 * @param quality JPEG 压缩质量
 */
function compressImage(file: File, maxDim = 1920, quality = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas 2D 不可用');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            } catch (err) {
                reject(err);
            } finally {
                URL.revokeObjectURL(url);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('图片加载失败'));
        };
        img.src = url;
    });
}

/**
 * 主布局组件
 */
export default function Layout() {
    const {t, i18n} = useTranslation();
    const sidebarCollapsed = useAppStore((s) => s.ui.sidebarCollapsed);
    const toggleSidebar = useAppStore((s) => s.toggleSidebar);
    const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
    const theme = useAppStore((s) => s.ui.theme);
    const locale = useAppStore((s) => s.ui.locale);
    const setLocale = useAppStore((s) => s.setLocale);
    const setTheme = useAppStore((s) => s.setTheme);
    const bgImage = useAppStore((s) => s.ui.bgImage);
    const setBgImage = useAppStore((s) => s.setBgImage);
    const [themeMenuOpen, setThemeMenuOpen] = useState(false);
    const themeMenuRef = useRef<HTMLDivElement>(null);
    const [bgError, setBgError] = useState<string | null>(null);

    /** 背景图片文件选择：压缩后写入 store（持久化 + 应用） */
    const handleBgFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBgError(null);
        try {
            const dataUrl = await compressImage(file);
            setBgImage(dataUrl);
        } catch (err) {
            console.error('背景图片处理失败:', err);
            setBgError('背景图片处理失败，请换一张 JPG/PNG 图片试试');
        } finally {
            e.target.value = '';
        }
    };

    /** 清除自定义背景，恢复默认渐变 */
    const handleClearBg = () => setBgImage(null);

    // 主题菜单：点击外部关闭
    useEffect(() => {
        if (!themeMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (!themeMenuRef.current?.contains(e.target as Node)) setThemeMenuOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [themeMenuOpen]);
    const wsConnected = useAppStore((s) => s.ws.connected);
    const cliProvider = useAppStore((s) => s.cliProvider);
    const setCliProvider = useAppStore((s) => s.setCliProvider);
    const setShowSetupModal = useAppStore((s) => s.setShowSetupModal);
    const setShowModelConfigModal = useAppStore((s) => s.setShowModelConfigModal);
    const fetchModelConfig = useAppStore((s) => s.fetchModelConfig);
    const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels);
    const claudeModelTiers = useAppStore((s) => s.claudeModelTiers);

    const location = useLocation();

    useWebSocket();
    useKeyboardShortcuts();

    // 应用启动时加载模型配置和可用模型列表（串行避免覆盖）
    useEffect(() => {
        (async () => {
            await fetchModelConfig();
            await fetchAvailableModels();
        })();
    }, [fetchModelConfig, fetchAvailableModels]);

    useEffect(() => {
        function handleResize() {
            if (window.innerWidth < 1024) {
                setSidebarCollapsed(true);
            }
        }
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [setSidebarCollapsed]);

    const currentTitle = t(pageTitleKeys[location.pathname] || 'common.appTitle');

    const handleToggleLocale = () => {
        const next = locale === 'zh' ? 'en' : 'zh';
        setLocale(next);
        i18n.changeLanguage(next);
    };

    return (
        <div className="flex h-screen overflow-hidden bg-transparent text-foreground">
            <SetupWizard/>

            {/* 侧边栏 */}
            <aside
                className={cn(
                    'flex flex-col border-r border-border/50 glass-sidebar transition-all duration-300 ease-in-out',
                    sidebarCollapsed ? 'w-[52px]' : 'w-[220px]'
                )}
            >
                <div className="flex h-14 items-center border-b border-border/50 px-3">
                    {!sidebarCollapsed && (
                        <div className="flex items-center gap-2">
                            <img
                                src="https://blogsite.site/upload/logo.png"
                                alt="logo"
                                className="h-7 w-7 rounded-xl object-cover shrink-0 ring-2 ring-primary/40 shadow-md shadow-primary/20"
                            />
                            <span className="text-sm font-semibold tracking-tight">{t('common.appTitle')}</span>
                        </div>
                    )}
                    {sidebarCollapsed && (
                        <img
                            src="https://blogsite.site/upload/logo.png"
                            alt="logo"
                            className="h-7 w-7 rounded-xl object-cover mx-auto"
                        />
                    )}
                </div>

                <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const label = t(item.labelKey);
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                end={item.path === '/'}
                                className={({isActive}) =>
                                    cn(
                                        'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                                        isActive
                                            ? 'brand-gradient-soft text-primary'
                                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                                    )
                                }
                                title={sidebarCollapsed ? label : undefined}
                            >
                                {({isActive}) => (
                                    <>
                                        {isActive && (
                                            <span
                                                className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full brand-gradient"/>
                                        )}
                                        <Icon className={cn('h-4 w-4 flex-shrink-0 transition-colors', isActive && 'text-primary')}/>
                                        {!sidebarCollapsed && <span className="truncate">{label}</span>}
                                    </>
                                )}
                            </NavLink>
                        );
                    })}
                </nav>

                <div className="border-t border-border/50 p-3 space-y-2">
                    <div className="flex items-center justify-center gap-2">
                        <span
                            className={cn(
                                'h-2 w-2 rounded-full',
                                wsConnected ? 'bg-emerald-500' : 'bg-red-500'
                            )}
                        />
                        {!sidebarCollapsed && (
                            <span className="text-xs text-muted-foreground">
                                {wsConnected ? t('common.connected') : t('common.disconnected')}
                            </span>
                        )}
                    </div>
                </div>
            </aside>

            {/* 主内容区域 */}
            <div className="flex flex-1 flex-col overflow-hidden">
                <header className="relative z-50 flex h-14 items-center justify-between border-b border-border/50 glass px-6">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleSidebar}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
                            title={sidebarCollapsed ? t('common.expandSidebar') : t('common.collapseSidebar')}
                        >
                            {sidebarCollapsed ? (
                                <PanelLeft className="h-4 w-4"/>
                            ) : (
                                <PanelLeftClose className="h-4 w-4"/>
                            )}
                        </button>
                        <div className="h-4 w-px bg-border"/>
                        <h1 className="text-sm font-semibold brand-gradient-text">{currentTitle}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* CLI Provider 切换 */}
                        <button
                            onClick={() => setShowSetupModal(true)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 text-xs font-medium"
                            title={t('common.switchProvider')}
                        >
                            {cliProvider.active === 'codex'
                                ? <Terminal className="h-4 w-4"/>
                                : cliProvider.active === 'pi'
                                ? <Sparkles className="h-4 w-4"/>
                                : <Bot className="h-4 w-4"/>
                            }
                            <span className="hidden sm:inline">
                                {cliProvider.active === 'codex' ? 'Codex' : cliProvider.active === 'pi' ? 'Pi' : 'Claude'}
                            </span>
                        </button>
                        {/* 模型配置 */}
                        <button
                            onClick={() => setShowModelConfigModal(true)}
                            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 text-xs font-medium"
                            title="模型配置"
                        >
                            <Cpu className="h-4 w-4"/>
                            <span className="hidden md:inline">
                                {cliProvider.active === 'codex'
                                    ? (cliProvider.modelConfig.codex.model || '未配置')
                                    : cliProvider.active === 'pi'
                                    ? (cliProvider.modelConfig.pi.model || '未配置')
                                    : (() => {
                                        const tier = claudeModelTiers.find(
                                            t => t.tier === cliProvider.modelConfig.claude.model
                                        );
                                        return tier ? tier.model : cliProvider.modelConfig.claude.model;
                                    })()
                                }
                            </span>
                        </button>
                        {/* 语言切换 */}
                        <button
                            onClick={handleToggleLocale}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200 text-xs font-medium"
                            title={locale === 'zh' ? 'Switch to English' : '切换到中文'}
                        >
                            <Languages className="h-4 w-4"/>
                        </button>
                        {/* 主题切换器 */}
                        <div className="relative" ref={themeMenuRef}>
                            <button
                                onClick={() => { setBgError(null); setThemeMenuOpen(!themeMenuOpen); }}
                                className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
                                title={t('common.theme')}
                            >
                                <Palette className="h-4 w-4"/>
                            </button>
                            <AnimatePresence>
                                {themeMenuOpen && (
                                    <motion.div
                                        initial={{opacity: 0, y: -4}}
                                        animate={{opacity: 1, y: 0}}
                                        exit={{opacity: 0, y: -4}}
                                        transition={{duration: 0.15}}
                                        className="absolute right-0 top-full mt-1 z-[100] w-48 rounded-lg border border-border bg-popover p-1 shadow-apple-lg"
                                    >
                                        <p className="px-2 pt-1 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">主题</p>
                                        {THEME_OPTIONS.map(opt => (
                                            <button
                                                key={opt.id}
                                                onClick={() => { setTheme(opt.id); setThemeMenuOpen(false); }}
                                                className={cn(
                                                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                                                    theme === opt.id ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                                                )}
                                            >
                                                <span className="h-3 w-3 shrink-0 rounded-full border border-border/60" style={{background: opt.swatch}}/>
                                                {t(opt.labelKey)}
                                            </button>
                                        ))}
                                        <div className="my-1 h-px bg-border/60"/>
                                        <p className="px-2 pt-0.5 pb-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">背景</p>
                                        <label
                                            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                            title="上传本地图片作为背景"
                                        >
                                            <ImagePlus className="h-3.5 w-3.5"/>
                                            上传背景图片
                                            <input
                                                type="file"
                                                accept="image/*"
                                                className="sr-only"
                                                onChange={handleBgFile}
                                            />
                                        </label>
                                        {bgError && (
                                            <p className="px-2 py-1 text-[11px] text-destructive">{bgError}</p>
                                        )}
                                        {bgImage && (
                                            <button
                                                onClick={handleClearBg}
                                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                                title="恢复默认渐变背景"
                                            >
                                                <Trash2 className="h-3.5 w-3.5"/>
                                                清除背景
                                            </button>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </header>

                <AnimatePresence mode="wait">
                    <motion.div
                        key={location.pathname}
                        initial={{opacity: 0, y: 8}}
                        animate={{opacity: 1, y: 0}}
                        exit={{opacity: 0, y: -8}}
                        transition={{duration: 0.2, ease: [0.25, 0.1, 0.25, 1]}}
                        className="flex-1 overflow-y-auto"
                    >
                        <Outlet/>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* CLI Provider 切换弹窗 */}
            <ProviderSetupModal
                open={cliProvider.showSetupModal}
                onClose={() => setShowSetupModal(false)}
                onSelected={(providerId) => {
                    setCliProvider(true, providerId);
                    setShowSetupModal(false);
                }}
                firstRun={!cliProvider.configured}
            />

            {/* 模型配置弹窗 */}
            <ModelConfigModal
                open={cliProvider.showModelConfigModal}
                onClose={() => setShowModelConfigModal(false)}
            />
        </div>
    );
}
