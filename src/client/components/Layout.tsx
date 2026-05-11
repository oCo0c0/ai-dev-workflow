/**
 * @file Layout.tsx
 * @description 应用主布局组件 —— 提供侧边栏导航 + 顶部工具栏 + 内容区域的经典三栏式布局结构。
 *
 * 职责包括：
 * - 侧边栏：展示导航菜单项、Logo 区域、WebSocket 连接状态指示器
 * - 顶部栏：页面标题、侧边栏折叠/展开切换按钮、明暗主题切换按钮
 * - 内容区域：通过 React Router 的 <Outlet /> 渲染当前路由对应的子页面
 * - 响应式处理：窗口宽度小于 1024px 时自动折叠侧边栏
 * - 全局初始化：启动 WebSocket 连接、注册键盘快捷键
 *
 * @exports Layout - 默认导出的主布局组件
 */

import {useEffect} from 'react';
import {NavLink, Outlet, useLocation} from 'react-router-dom';
import {AnimatePresence, motion} from 'framer-motion';
import {useAppStore} from '../stores/app-store';
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
    Sun,
    Moon,
} from 'lucide-react';

/**
 * 侧边栏导航菜单项配置数组
 *
 * 每个条目包含：
 * - path: 路由路径，对应 React Router 路由定义
 * - label: 在侧边栏中显示的菜单名称
 * - icon: 来自 lucide-react 的图标组件，用于菜单项前的图标展示
 */
const navItems = [
    {path: '/', label: 'Requirements', icon: FileText},
    {path: '/workspace', label: 'Workspace', icon: FolderOpen},
    {path: '/plan', label: 'Plan', icon: FileCode},
    {path: '/execution', label: 'Execution', icon: Play},
    {path: '/tests', label: 'Tests', icon: TestTube},
    {path: '/skills', label: 'Skills', icon: Zap},
    {path: '/mcp', label: 'MCP', icon: Plug},
    {path: '/pipelines', label: 'Pipelines', icon: GitBranch},
];

/**
 * 页面路由路径到页面标题的映射表
 *
 * 根据当前路由路径在顶部栏显示对应的页面标题，
 * 当路径未在映射中找到时，使用默认标题 'AI Workbench'。
 */
const pageTitles: Record<string, string> = {
    '/': 'Requirements',
    '/workspace': 'Workspace',
    '/plan': 'Development Plan',
    '/execution': 'Execution',
    '/tests': 'Tests',
    '/skills': 'Skills',
    '/mcp': 'MCP Servers',
    '/pipelines': 'Pipelines',
};

/**
 * 主布局组件 —— 构成应用的整体页面框架
 *
 * 布局结构（从外到内）：
 * 1. 最外层 flex 容器：横向排列侧边栏和主内容区域
 * 2. SetupWizard 向导：首次使用时的环境检测引导弹窗（条件渲染）
 * 3. aside 侧边栏：可折叠的导航菜单 + 连接状态
 * 4. 主内容区域：顶部 header + Outlet 路由内容
 *
 * @component
 * @returns {JSX.Element} 完整的应用布局 DOM 结构
 */
export default function Layout() {
    // --- 从全局状态仓库获取 UI 相关状态与操作方法 ---
    const sidebarCollapsed = useAppStore((s) => s.ui.sidebarCollapsed);
    const toggleSidebar = useAppStore((s) => s.toggleSidebar);
    const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
    const theme = useAppStore((s) => s.ui.theme);
    const toggleTheme = useAppStore((s) => s.toggleTheme);
    const wsConnected = useAppStore((s) => s.ws.connected);

    // 获取当前路由位置，用于动态匹配页面标题
    const location = useLocation();

    // 初始化 WebSocket 连接（全局单例，组件挂载时自动建立）
    useWebSocket();

    // 注册全局键盘快捷键监听
    useKeyboardShortcuts();

    /**
     * 响应式侧边栏折叠处理
     *
     * 当窗口宽度小于 1024px（lg 断点）时自动折叠侧边栏，
     * 避免在小屏幕设备上侧边栏占用过多空间。
     * 组件挂载时立即执行一次检测，同时监听 resize 事件持续响应窗口变化。
     */
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

    // 根据当前路由路径查找对应的页面标题，找不到则使用默认标题
    const currentTitle = pageTitles[location.pathname] || 'AI Workbench';

    return (
        <div className="flex h-screen overflow-hidden bg-background text-foreground">
            {/* 首次启动时的环境检测引导向导，完成设置后不再显示 */}
            <SetupWizard/>

            {/* ===== 侧边栏 ===== */}
            <aside
                className={cn(
                    'flex flex-col border-r border-border/50 glass-sidebar transition-all duration-300 ease-in-out',
                    sidebarCollapsed ? 'w-[52px]' : 'w-[220px]'
                )}
            >
                {/* Logo 展示区域：折叠时仅显示图标，展开时显示图标 + 文字标题 */}
                <div className="flex h-14 items-center border-b border-border/50 px-3">
                    {!sidebarCollapsed && (
                        <div className="flex items-center gap-2">
                            <img
                                src="https://blogsite.site/upload/logo.png"
                                alt="logo"
                                className="h-7 w-7 rounded-xl object-cover shrink-0"
                            />
                            <span className="text-sm font-semibold tracking-tight">AI Workbench</span>
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

                {/* 导航菜单列表：遍历 navItems 配置渲染导航链接 */}
                <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                // 对根路径 "/" 启用精确匹配，避免子路由也被高亮
                                end={item.path === '/'}
                                className={({isActive}) =>
                                    cn(
                                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
                                        isActive
                                            ? 'bg-primary/10 text-primary'
                                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                                    )
                                }
                                // 侧边栏折叠时通过 title 属性显示菜单名称的 tooltip 提示
                                title={sidebarCollapsed ? item.label : undefined}
                            >
                                <Icon className="h-4 w-4 flex-shrink-0"/>
                                {/* 仅在侧边栏展开时显示文字标签 */}
                                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                            </NavLink>
                        );
                    })}
                </nav>

                {/* 侧边栏底部区域：显示 WebSocket 实时连接状态 */}
                <div className="border-t border-border/50 p-3 space-y-2">
                    <div className="flex items-center justify-center gap-2">
                        {/* 连接状态指示灯：绿色圆点表示已连接，红色圆点表示断开 */}
                        <span
                            className={cn(
                                'h-2 w-2 rounded-full',
                                wsConnected ? 'bg-emerald-500' : 'bg-red-500'
                            )}
                        />
                        {!sidebarCollapsed && (
                            <span className="text-xs text-muted-foreground">
                {wsConnected ? 'Connected' : 'Disconnected'}
              </span>
                        )}
                    </div>
                </div>
            </aside>

            {/* ===== 主内容区域 ===== */}
            <div className="flex flex-1 flex-col overflow-hidden">
                {/* 顶部工具栏 */}
                <header className="flex h-14 items-center justify-between border-b border-border/50 glass px-6">
                    {/* 左侧：侧边栏折叠按钮 + 分隔线 + 当前页面标题 */}
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleSidebar}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
                            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        >
                            {/* 根据当前侧边栏状态显示不同的图标：折叠时显示展开图标，展开时显示折叠图标 */}
                            {sidebarCollapsed ? (
                                <PanelLeft className="h-4 w-4"/>
                            ) : (
                                <PanelLeftClose className="h-4 w-4"/>
                            )}
                        </button>
                        <div className="h-4 w-px bg-border"/>
                        <h1 className="text-sm font-medium">{currentTitle}</h1>
                    </div>
                    {/* 右侧：明暗主题切换按钮 */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleTheme}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-all duration-200"
                            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
                        >
                            {/* 暗色模式下显示太阳图标（切换到亮色），亮色模式下显示月亮图标（切换到暗色） */}
                            {theme === 'dark' ? (
                                <Sun className="h-4 w-4"/>
                            ) : (
                                <Moon className="h-4 w-4"/>
                            )}
                        </button>
                    </div>
                </header>

                {/* 页面内容渲染区域：framer-motion 过渡动画 */}
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
        </div>
    );
}
