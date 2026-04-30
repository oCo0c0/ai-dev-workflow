import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAppStore } from '../stores/app-store';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useWebSocket } from '../hooks/useWebSocket';
import SetupWizard from './SetupWizard';
import { cn } from '../lib/utils';
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

const navItems = [
  { path: '/', label: 'Requirements', icon: FileText },
  { path: '/workspace', label: 'Workspace', icon: FolderOpen },
  { path: '/plan', label: 'Plan', icon: FileCode },
  { path: '/execution', label: 'Execution', icon: Play },
  { path: '/tests', label: 'Tests', icon: TestTube },
  { path: '/skills', label: 'Skills', icon: Zap },
  { path: '/mcp', label: 'MCP', icon: Plug },
  { path: '/pipelines', label: 'Pipelines', icon: GitBranch },
];

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

export default function Layout() {
  const sidebarCollapsed = useAppStore((s) => s.ui.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const theme = useAppStore((s) => s.ui.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const wsConnected = useAppStore((s) => s.ws.connected);
  const location = useLocation();

  // Initialize WebSocket connection
  useWebSocket();
  useKeyboardShortcuts();

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

  const currentTitle = pageTitles[location.pathname] || 'AI Workbench';

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <SetupWizard />

      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r border-border bg-card transition-all duration-200 ease-in-out',
          sidebarCollapsed ? 'w-[52px]' : 'w-[220px]'
        )}
      >
        {/* Logo area */}
        <div className="flex h-14 items-center border-b border-border px-3">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <img
                src="https://blogsite.site/upload/logo.png"
                alt="logo"
                className="h-7 w-7 rounded-md object-cover shrink-0"
              />
              <span className="text-sm font-semibold tracking-tight">AI Workbench</span>
            </div>
          )}
          {sidebarCollapsed && (
            <img
              src="https://blogsite.site/upload/logo.png"
              alt="logo"
              className="h-7 w-7 rounded-md object-cover mx-auto"
            />
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-accent text-accent-foreground border-l-2 border-primary ml-0 pl-[10px]'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground border-l-2 border-transparent ml-0 pl-[10px]'
                  )
                }
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center justify-center gap-2">
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

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-card/50 backdrop-blur-sm px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeft className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
            <div className="h-4 w-px bg-border" />
            <h1 className="text-sm font-medium">{currentTitle}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
