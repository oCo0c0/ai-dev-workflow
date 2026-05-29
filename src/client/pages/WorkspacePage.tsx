/**
 * @file WorkspacePage.tsx
 * @description 工作区管理与文件浏览页面组件
 *
 * 该页面提供一个类似 IDE 的工作区管理界面，支持多工作区管理、
 * 文件树浏览、文件内容预览和 Git 变更查看功能。
 *
 * 核心功能：
 * 1. 管理多个已保存的工作区（添加、重命名、删除）
 * 2. 浏览工作区的目录结构（懒加载展开子目录）
 * 3. 预览文件内容（支持文本文件高亮显示）
 * 4. 查看 Git 状态和变更差异（diff 视图）
 * 5. 面板大小可拖拽调整，支持折叠/展开
 *
 * 页面布局采用三栏可调整结构：
 * - 左栏：工作区列表管理
 * - 中栏：文件树 / Git 变更列表（可切换标签页）
 * - 右栏：文件预览 / Diff 视图
 */
import {useState, useEffect, useCallback, useRef} from 'react';
import {apiGet, apiPost, apiPut, apiDelete, pickFolder} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn} from '../lib/utils';
import {BranchSelector} from '../components/BranchSelector';
import {ConflictResolutionModal} from '../components/ConflictResolutionModal';
import {
    Folder,
    FolderOpen,
    File,
    ChevronRight,
    ChevronDown,
    Plus,
    Trash2,
    Pencil,
    Check,
    X,
    Loader2,
    Package,
    Coffee,
    Cpu,
    HardDrive,
    GitBranch,
    Eye,
    Code,
    FilePlus,
    FileMinus,
    RefreshCw,
    PanelLeftClose,
    PanelLeftOpen,
} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {useTranslation} from 'react-i18next';

// ============================================================
// 类型定义
// ============================================================

/**
 * @interface SavedWorkspace
 * @description 已保存的工作区信息接口
 */
interface SavedWorkspace {
    /** 工作区唯一标识 */
    id: string;
    /** 工作区在文件系统中的绝对路径 */
    path: string;
    /** 用户自定义的工作区显示名称 */
    name: string;
    /** 项目类型标识（用于显示对应的图标） */
    projectType: 'node' | 'python' | 'java' | 'rust' | 'unknown';
    /** 添加时间（ISO 格式） */
    addedAt: string;
}

/**
 * @interface DirectoryEntry
 * @description 目录条目接口
 * 表示文件树中的一个文件或目录节点
 */
interface DirectoryEntry {
    /** 文件或目录名称 */
    name: string;
    /** 完整的文件系统路径 */
    path: string;
    /** 是否为目录 */
    isDirectory: boolean;
    /** 文件大小（字节，可选，仅文件有值） */
    size?: number;
    /** 最后修改时间（ISO 格式） */
    modifiedAt: string;
    /** 文件扩展名（可选，仅文件有值） */
    extension?: string;
}

/**
 * @interface FileContent
 * @description 文件内容接口
 */
interface FileContent {
    /** 文件文本内容 */
    content: string;
    /** 编码类型：文本或二进制 */
    encoding: 'text' | 'binary';
    /** 文件大小（字节） */
    size: number;
}

/**
 * @interface GitChange
 * @description Git 文件变更接口
 * 表示工作区中一个文件的 Git 状态
 */
interface GitChange {
    /** 变更文件路径（相对于仓库根目录） */
    path: string;
    /** 变更状态码 */
    status: 'M' | 'A' | 'D' | 'R' | '?' | '!';
    /** 是否已暂存（staged） */
    staged: boolean;
}

/**
 * @interface GitStatusResult
 * @description Git 仓库状态查询结果接口
 */
interface GitStatusResult {
    /** 当前目录是否为 Git 仓库 */
    isGit: boolean;
    /** 当前分支名 */
    branch: string;
    /** 变更文件列表 */
    changes: GitChange[];
}

/**
 * @interface GitDiffResult
 * @description Git 差异查询结果接口
 */
interface GitDiffResult {
    /** 变更文件路径 */
    path: string;
    /** unified diff 格式的差异文本 */
    diff: string;
    /** 新增行数 */
    additions: number;
    /** 删除行数 */
    deletions: number;
}

// ============================================================
// 常量定义
// ============================================================

/** 左侧面板默认宽度（像素） */
const LEFT_DEFAULT = 224;
/** 左侧面板最小宽度 */
const LEFT_MIN = 160;
/** 左侧面板最大宽度 */
const LEFT_MAX = 400;
/** 中间面板默认宽度（像素） */
const MIDDLE_DEFAULT = 260;
/** 中间面板最小宽度 */
const MIDDLE_MIN = 180;
/** 中间面板最大宽度 */
const MIDDLE_MAX = 500;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据文件扩展名推断编程语言类型
 * 用于在文件预览头部显示语言标识
 *
 * @param filename - 文件名
 * @returns 语言名称字符串
 */
function getLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
        java: 'java', py: 'python', go: 'go', rs: 'rust', cpp: 'cpp', c: 'c',
        cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
        xml: 'xml', html: 'html', css: 'css', scss: 'scss', less: 'less',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown',
        sh: 'bash', bat: 'batch', ps1: 'powershell', sql: 'sql',
        properties: 'properties', env: 'bash', gitignore: 'bash',
    };
    return map[ext] || 'text';
}

/**
 * Git 变更状态的显示配置映射
 * 定义每种状态码对应的标签文字、文字颜色和背景颜色
 */
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    /** Modified - 已修改 */
    M: {label: 'M', color: 'text-amber-500', bg: 'bg-amber-500/10'},
    /** Added - 已添加 */
    A: {label: 'A', color: 'text-emerald-500', bg: 'bg-emerald-500/10'},
    /** Deleted - 已删除 */
    D: {label: 'D', color: 'text-red-500', bg: 'bg-red-500/10'},
    /** Renamed - 已重命名 */
    R: {label: 'R', color: 'text-blue-500', bg: 'bg-blue-500/10'},
    /** Untracked - 未跟踪（新增但未 git add） */
    '?': {label: 'U', color: 'text-emerald-400', bg: 'bg-emerald-500/10'},
    /** Ignored - 已忽略 */
    '!': {label: '!', color: 'text-gray-500', bg: 'bg-gray-500/10'},
};

// ============================================================
// 自定义 Hook
// ============================================================

/**
 * @function useDragDivider
 * @description 面板拖拽分隔条 Hook
 *
 * 实现面板边框的鼠标拖拽调整宽度功能。
 * 在拖拽过程中修改鼠标样式和禁用文本选择，松开后恢复。
 *
 * @param containerRef - 容器元素的引用（用于边界限制，当前未使用）
 * @param onDrag - 拖拽时的回调函数，接收水平位移增量 dx
 * @returns mousedown 事件处理函数，绑定到分隔条元素
 */
function useDragDivider(
    containerRef: React.RefObject<HTMLDivElement | null>,
    onDrag: (dx: number) => void,
) {
    /** 是否正在拖拽中 */
    const dragging = useRef(false);
    /** 上一次鼠标的 X 坐标，用于计算位移增量 */
    const lastX = useRef(0);

    /**
     * 鼠标按下时开始拖拽
     * 在 document 上注册 mousemove 和 mouseup 监听器
     */
    const start = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        dragging.current = true;
        lastX.current = e.clientX;

        const onMove = (ev: MouseEvent) => {
            if (!dragging.current) return;
            const dx = ev.clientX - lastX.current;
            lastX.current = ev.clientX;
            onDrag(dx);
        };
        const onUp = () => {
            dragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        // 设置拖拽时的全局样式：改变光标并禁止文本选择
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [onDrag]);

    return start;
}

// ============================================================
// 子组件
// ============================================================

/**
 * @function ProjectTypeIcon
 * @description 项目类型图标组件
 * 根据项目类型（node/python/java/rust）渲染对应的彩色图标
 *
 * @param type - 项目类型字符串
 * @param className - 额外的 CSS 类名
 * @returns 对应项目类型的 React 图标元素
 */
function ProjectTypeIcon({type, className}: { type: string; className?: string }) {
    const cls = cn('h-4 w-4', className);
    switch (type) {
        case 'node':
            return <Package className={cn(cls, 'text-green-500')}/>;
        case 'python':
            return <Cpu className={cn(cls, 'text-blue-500')}/>;
        case 'java':
            return <Coffee className={cn(cls, 'text-orange-500')}/>;
        case 'rust':
            return <HardDrive className={cn(cls, 'text-orange-700')}/>;
        default:
            return <Folder className={cn(cls, 'text-muted-foreground')}/>;
    }
}

/**
 * @function DiffView
 * @description Git 差异视图组件
 * 以深色主题渲染 unified diff 格式的文本，
 * 对不同类型的行（新增、删除、头部等）进行语法着色。
 *
 * @param diff - unified diff 格式的差异文本
 * @param additions - 新增行数
 * @param deletions - 删除行数
 * @param filePath - 变更文件路径
 * @returns Diff 视图的 React 组件
 */
function DiffView({diff, additions, deletions, filePath}: {
    diff: string;
    additions: number;
    deletions: number;
    filePath: string
}) {
    const {t} = useTranslation();

    // 差异为空时显示空状态
    if (!diff) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                <FilePlus className="h-8 w-8 opacity-20"/>
                <p className="text-sm">{t('workspace.noChangesDisplay')}</p>
            </div>
        );
    }

    const lines = diff.split('\n');

    return (
        <div className="flex flex-col h-full">
            {/* 差异头部：文件路径和增删统计 */}
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/30 shrink-0">
                <GitBranch className="h-4 w-4 text-muted-foreground shrink-0"/>
                <span className="text-sm font-mono text-foreground truncate flex-1">
          {filePath || t('workspace.allChanges')}
        </span>
                <span className="text-xs text-emerald-500 shrink-0">+{additions}</span>
                <span className="text-xs text-red-500 shrink-0">-{deletions}</span>
            </div>

            {/* 差异内容：逐行着色显示 */}
            <div className="flex-1 overflow-auto bg-[#1e1e1e]">
        <pre className="p-4 text-xs font-mono leading-relaxed whitespace-pre overflow-x-auto min-h-full">
          {lines.map((line, i) => {
              let lineClass = 'text-gray-200';
              let bgClass = '';

              // 根据行首字符判断行的类型并应用对应颜色
              if (line.startsWith('@@') || line.startsWith('## ')) {
                  // Hunk header - 蓝色
                  lineClass = 'text-blue-400';
                  bgClass = 'bg-blue-500/5';
              } else if (line.startsWith('+++') || line.startsWith('---')) {
                  // File header - 黄色
                  lineClass = 'text-yellow-300';
                  bgClass = 'bg-yellow-500/5';
              } else if (line.startsWith('+')) {
                  // Added line - 绿色
                  lineClass = 'text-emerald-300';
                  bgClass = 'bg-emerald-500/10';
              } else if (line.startsWith('-')) {
                  // Deleted line - 红色
                  lineClass = 'text-red-300';
                  bgClass = 'bg-red-500/10';
              }

              return (
                  <div key={i} className={cn(bgClass)}>
                      <span className={lineClass}>{line}</span>
                  </div>
              );
          })}
        </pre>
            </div>
        </div>
    );
}

/**
 * @function FileTreeNode
 * @description 文件树节点组件（递归）
 * 支持懒加载子目录内容，目录展开时才请求子条目。
 * 文件夹排在文件前面，同类按名称排序。
 *
 * @param entry - 当前目录条目
 * @param workspacePath - 工作区根路径
 * @param depth - 当前节点的嵌套深度（用于缩进）
 * @param onFileClick - 文件点击回调
 * @param selectedFile - 当前选中的文件路径
 * @returns 文件树节点的 React 组件
 */
function FileTreeNode({
                          entry,
                          workspacePath,
                          depth,
                          onFileClick,
                          selectedFile,
                      }: {
    entry: DirectoryEntry;
    workspacePath: string;
    depth: number;
    onFileClick: (path: string, name: string) => void;
    selectedFile: string | null;
}) {
    /** 是否展开子目录 */
    const [expanded, setExpanded] = useState(false);
    /** 子条目列表 */
    const [children, setChildren] = useState<DirectoryEntry[]>([]);
    /** 是否正在加载子目录 */
    const [loading, setLoading] = useState(false);
    /** 是否已加载过子目录（避免重复请求） */
    const [loaded, setLoaded] = useState(false);

    /**
     * 懒加载子目录内容
     * 从后端 API 获取目录下的文件和子目录列表
     */
    const loadChildren = async () => {
        setLoading(true);
        try {
            const data = await apiGet<DirectoryEntry[]>(
                `/workspace/browse?path=${encodeURIComponent(entry.path)}`
            );
            // 排序：目录在前，文件在后；同类按名称字母顺序排列
            const sorted = [...data].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setChildren(sorted);
            setLoaded(true);
            setExpanded(true);
        } catch {
            // 静默处理加载失败
        } finally {
            setLoading(false);
        }
    };

    /**
     * 节点点击处理
     * - 文件：触发选中回调
     * - 目录：首次点击加载子项，之后切换展开/折叠状态
     */
    const toggle = async () => {
        if (!entry.isDirectory) {
            onFileClick(entry.path, entry.name);
            return;
        }
        if (!loaded) {
            await loadChildren();
        } else {
            setExpanded(!expanded);
        }
    };

    /** 当前节点是否为选中状态（仅文件可选中） */
    const isSelected = !entry.isDirectory && selectedFile === entry.path;

    return (
        <div>
            {/* 节点行：缩进根据深度动态计算 */}
            <div
                onClick={toggle}
                className={cn(
                    'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors select-none',
                    isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50',
                )}
                style={{paddingLeft: `${8 + depth * 16}px`}}
            >
                {entry.isDirectory ? (
                    <>
                        {/* 目录展开/折叠箭头指示器 */}
                        {loading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0"/>
                        ) : expanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
                        ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0"/>
                        )}
                        {/* 目录图标：展开/折叠使用不同图标 */}
                        {expanded ? (
                            <FolderOpen className="h-4 w-4 text-blue-400 shrink-0"/>
                        ) : (
                            <Folder className="h-4 w-4 text-blue-400 shrink-0"/>
                        )}
                    </>
                ) : (
                    <>
                        {/* 文件：占位对齐 + 文件图标 */}
                        <span className="w-3.5 shrink-0"/>
                        <File className="h-4 w-4 text-muted-foreground/60 shrink-0"/>
                    </>
                )}
                <span className={cn(
                    'truncate text-xs',
                    entry.isDirectory ? 'font-medium text-foreground' : 'text-muted-foreground'
                )}>
          {entry.name}
        </span>
                {/* 文件大小显示（目录不显示） */}
                {!entry.isDirectory && entry.size !== undefined && (
                    <span className="ml-auto text-xs text-muted-foreground/40 shrink-0">
            {entry.size < 1024 ? `${entry.size}B` : `${(entry.size / 1024).toFixed(0)}K`}
          </span>
                )}
            </div>
            {/* 递归渲染子节点 */}
            {entry.isDirectory && expanded && (
                <div>
                    {children.map((child) => (
                        <FileTreeNode
                            key={child.path}
                            entry={child}
                            workspacePath={workspacePath}
                            depth={depth + 1}
                            onFileClick={onFileClick}
                            selectedFile={selectedFile}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================================
// 面板分隔条组件
// ============================================================

/**
 * @function Divider
 * @description 可拖拽的面板分隔条组件
 * 渲染一个窄的垂直条，绑定鼠标按下事件以启动拖拽
 *
 * @param onMouseDown - 鼠标按下时的回调（由 useDragDivider hook 提供）
 * @returns 分隔条的 React 组件
 */
function Divider({onMouseDown}: { onMouseDown: (e: React.MouseEvent) => void }) {
    return (
        <div
            className="w-1 shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={onMouseDown}
        />
    );
}

/**
 * 中间面板的标签页类型
 * - 'files': 文件树浏览
 * - 'changes': Git 变更列表
 */
type MiddleTab = 'files' | 'changes';

// ============================================================
// 主组件
// ============================================================

/**
 * @function WorkspacePage
 * @description 工作区管理与文件浏览页面主组件
 *
 * 提供完整的工作区管理功能：
 * - 三栏可调整布局（工作区列表 | 文件树/变更 | 文件预览/差异）
 * - 工作区增删改管理
 * - 文件树懒加载浏览
 * - 文件内容预览
 * - Git 状态查看和 Diff 视图
 *
 * @returns {JSX.Element} 工作区管理页面的 React 组件
 */
export default function WorkspacePage() {
    const {t} = useTranslation();

    // === 面板尺寸状态 ===
    /** 左侧面板宽度 */
    const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
    /** 中间面板宽度 */
    const [middleWidth, setMiddleWidth] = useState(MIDDLE_DEFAULT);
    /** 左侧面板是否折叠 */
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    /** 中间面板是否折叠 */
    const [middleCollapsed, setMiddleCollapsed] = useState(false);
    /** 主容器引用（用于拖拽边界限制） */
    const containerRef = useRef<HTMLDivElement>(null);

    // === 工作区数据状态 ===
    /** 已保存的工作区列表 */
    const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>([]);
    /** 当前选中的工作区 */
    const [selectedWs, setSelectedWs] = useState<SavedWorkspace | null>(null);
    /** 文件树根条目列表 */
    const [rootEntries, setRootEntries] = useState<DirectoryEntry[]>([]);
    /** 是否正在加载文件树 */
    const [loadingTree, setLoadingTree] = useState(false);
    /** 当前选中的文件路径 */
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    /** 当前选中的文件名 */
    const [selectedFileName, setSelectedFileName] = useState('');
    /** 选中文件的内容 */
    const [fileContent, setFileContent] = useState<FileContent | null>(null);
    /** 是否正在加载文件内容 */
    const [loadingFile, setLoadingFile] = useState(false);
    /** 正在编辑的工作区 ID（内联重命名） */
    const [editingId, setEditingId] = useState<string | null>(null);
    /** 重命名编辑中的名称 */
    const [editName, setEditName] = useState('');

    // === Git 状态 ===
    /** 中间面板当前激活的标签页 */
    const [middleTab, setMiddleTab] = useState<MiddleTab>('files');
    /** Git 仓库状态查询结果 */
    const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
    /** 当前查看的文件差异结果 */
    const [gitDiffResult, setGitDiffResult] = useState<GitDiffResult | null>(null);
    /** 当前选中的变更文件路径 */
    const [selectedChange, setSelectedChange] = useState<string | null>(null);
    /** 冲突解决弹窗状态 */
    const [conflictModal, setConflictModal] = useState<{ open: boolean; conflicts: string[] }>({open: false, conflicts: []});
    /** 是否正在加载 Git 状态 */
    const [loadingGit, setLoadingGit] = useState(false);
    /** 是否正在加载 Diff */
    const [loadingDiff, setLoadingDiff] = useState(false);

    /** 从全局状态获取设置当前工作区的方法 */
    const setCurrentWorkspace = useAppStore((s) => s.setCurrentWorkspace);

    // === 拖拽分隔条处理 ===
    /** 左侧面板拖拽处理 */
    const dragLeft = useDragDivider(containerRef, useCallback((dx: number) => {
        setLeftWidth(w => Math.min(LEFT_MAX, Math.max(LEFT_MIN, w + dx)));
    }, []));

    /** 中间面板拖拽处理 */
    const dragMiddle = useDragDivider(containerRef, useCallback((dx: number) => {
        setMiddleWidth(w => Math.min(MIDDLE_MAX, Math.max(MIDDLE_MIN, w + dx)));
    }, []));

    // === 数据加载方法 ===

    /**
     * 加载已保存的工作区列表
     */
    const loadSavedWorkspaces = useCallback(async () => {
        try {
            const data = await apiGet<SavedWorkspace[]>('/workspace/saved');
            setSavedWorkspaces(data);
        } catch { /* ignore */
        }
    }, []);

    useEffect(() => {
        loadSavedWorkspaces();
    }, [loadSavedWorkspaces]);

    /**
     * 加载指定工作区的 Git 状态
     * 切换到 Changes 标签页或更换工作区时自动调用
     */
    const loadGitStatus = useCallback(async (wsPath: string) => {
        setLoadingGit(true);
        try {
            const data = await apiGet<GitStatusResult>(
                `/workspace/git/status?workspacePath=${encodeURIComponent(wsPath)}`
            );
            setGitStatus(data);
        } catch {
            setGitStatus(null);
        } finally {
            setLoadingGit(false);
        }
    }, []);

    // 当选中工作区或切换到 Changes 标签页时自动加载 Git 状态
    useEffect(() => {
        if (selectedWs && middleTab === 'changes') {
            loadGitStatus(selectedWs.path);
            setSelectedChange(null);
            setGitDiffResult(null);
        }
    }, [selectedWs, middleTab, loadGitStatus]);

    /**
     * 添加新工作区
     * 通过系统文件选择器让用户选取文件夹，保存到后端后自动选中
     */
    const handleAddWorkspace = async () => {
        const picked = await pickFolder(t('workspace.selectFolder'));
        if (!picked) return;
        try {
            const saved = await apiPost<SavedWorkspace>('/workspace/saved', {path: picked});
            setSavedWorkspaces(prev => [...prev, saved]);
            selectWorkspace(saved);
        } catch (err) {
            alert(err instanceof Error ? err.message : 'Failed to add workspace');
        }
    };

    /**
     * 移除工作区
     * 同时清理所有关联的选中状态
     */
    const handleRemove = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await apiDelete(`/workspace/saved/${id}`);
            setSavedWorkspaces(prev => prev.filter(w => w.id !== id));
            // 如果删除的是当前选中的工作区，清空所有相关状态
            if (selectedWs?.id === id) {
                setSelectedWs(null);
                setRootEntries([]);
                setSelectedFile(null);
                setFileContent(null);
                setGitStatus(null);
                setGitDiffResult(null);
                setSelectedChange(null);
            }
        } catch { /* ignore */
        }
    };

    /**
     * 重命名工作区
     * 调用 API 更新名称后同步本地状态
     */
    const handleRename = async (id: string) => {
        if (!editName.trim()) return;
        try {
            const updated = await apiPut<SavedWorkspace>(`/workspace/saved/${id}`, {name: editName.trim()});
            setSavedWorkspaces(prev => prev.map(w => w.id === id ? updated : w));
            setEditingId(null);
        } catch { /* ignore */
        }
    };

    /**
     * 选中并加载工作区
     * 重置文件和 Git 相关状态，加载根目录条目列表
     */
    const selectWorkspace = async (ws: SavedWorkspace) => {
        setSelectedWs(ws);
        setSelectedFile(null);
        setFileContent(null);
        setMiddleTab('files');
        setGitStatus(null);
        setGitDiffResult(null);
        setSelectedChange(null);
        setLoadingTree(true);
        try {
            const data = await apiGet<DirectoryEntry[]>(
                `/workspace/browse?path=${encodeURIComponent(ws.path)}`
            );
            const sorted = [...data].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setRootEntries(sorted);
            // 同步到全局状态，供其他模块使用
            try {
                const info = await apiPost('/workspace/select', {path: ws.path});
                setCurrentWorkspace(info as Parameters<typeof setCurrentWorkspace>[0]);
            } catch { /* ignore */
            }
        } catch { /* ignore */
        } finally {
            setLoadingTree(false);
        }
    };

    /**
     * 文件点击处理
     * 加载并展示选中文件的内容，同时清空 Diff 视图
     */
    const handleFileClick = async (filePath: string, fileName: string) => {
        if (!selectedWs) return;
        setSelectedFile(filePath);
        setSelectedFileName(fileName);
        setLoadingFile(true);
        setFileContent(null);
        setSelectedChange(null);
        setGitDiffResult(null);
        try {
            const data = await apiGet<FileContent>(
                `/workspace/file?path=${encodeURIComponent(filePath)}&workspace=${encodeURIComponent(selectedWs.path)}`
            );
            setFileContent(data);
        } catch (err) {
            // 加载失败时在预览区域显示错误信息
            setFileContent({
                content: `Error reading file: ${err instanceof Error ? err.message : 'Unknown error'}`,
                encoding: 'text',
                size: 0,
            });
        } finally {
            setLoadingFile(false);
        }
    };

    /**
     * Git 变更文件点击处理
     * 加载并展示该文件的 Diff 视图，同时清空文件预览
     */
    const handleChangeClick = async (changePath: string) => {
        if (!selectedWs) return;
        setSelectedChange(changePath);
        setSelectedFile(null);
        setFileContent(null);
        setLoadingDiff(true);
        setGitDiffResult(null);
        try {
            const data = await apiGet<GitDiffResult>(
                `/workspace/git/diff?workspacePath=${encodeURIComponent(selectedWs.path)}&file=${encodeURIComponent(changePath)}`
            );
            setGitDiffResult(data);
        } catch {
            setGitDiffResult(null);
        } finally {
            setLoadingDiff(false);
        }
    };

    /** 是否显示 Diff 视图 */
    const showDiffView = selectedChange !== null;
    /** 是否显示文件预览（文件被选中且不在 Diff 视图模式） */
    const showFilePreview = selectedFile !== null && !showDiffView;

    // === 计算面板实际宽度（折叠时为 0） ===
    const effectiveLeft = leftCollapsed ? 0 : leftWidth;
    const effectiveMiddle = middleCollapsed ? 0 : middleWidth;

    return (
        <div ref={containerRef} className="flex h-full overflow-hidden">
            {/* ====== 左栏：工作区列表 ====== */}
            {!leftCollapsed && (
                <>
                    <div
                        className="flex flex-col border-r border-border bg-muted/10 shrink-0 overflow-hidden"
                        style={{width: effectiveLeft}}
                    >
                        {/* 标题栏：标题、添加和折叠按钮 */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('workspace.title')}
              </span>
                            <div className="flex items-center gap-0.5">
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleAddWorkspace}
                                        title={t('workspace.addTitle')}>
                                    <Plus className="h-4 w-4"/>
                                </Button>
                                <Button
                                    variant="ghost" size="sm" className="h-6 w-6 p-0"
                                    onClick={() => setLeftCollapsed(true)} title={t('workspace.collapse')}
                                >
                                    <PanelLeftClose className="h-4 w-4"/>
                                </Button>
                            </div>
                        </div>

                        {/* 工作区列表 */}
                        <div className="flex-1 overflow-y-auto py-1">
                            {/* 空状态：引导用户添加工作区 */}
                            {savedWorkspaces.length === 0 && (
                                <div className="flex flex-col items-center justify-center py-8 px-3 text-center gap-2">
                                    <Folder className="h-7 h-7 text-muted-foreground/30"/>
                                    <p className="text-xs text-muted-foreground">{t('workspace.emptyTitle')}</p>
                                    <Button variant="outline" size="sm" className="text-xs h-7"
                                            onClick={handleAddWorkspace}>
                                        <Plus className="h-3.5 w-3.5 mr-1"/>
                                        {t('workspace.addButton')}
                                    </Button>
                                </div>
                            )}

                            {/* 工作区列表项 */}
                            {savedWorkspaces.map((ws) => (
                                <div
                                    key={ws.id}
                                    onClick={() => selectWorkspace(ws)}
                                    className={cn(
                                        'group flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors',
                                        selectedWs?.id === ws.id
                                            ? 'bg-primary/5 border-l-2 border-l-primary'
                                            : 'hover:bg-accent/50'
                                    )}
                                >
                                    <ProjectTypeIcon type={ws.projectType} className="shrink-0"/>
                                    <div className="flex-1 min-w-0">
                                        {/* 内联重命名编辑模式 */}
                                        {editingId === ws.id ? (
                                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                <Input
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleRename(ws.id);
                                                        if (e.key === 'Escape') setEditingId(null);
                                                    }}
                                                    className="h-5 text-xs px-1 py-0"
                                                    autoFocus
                                                />
                                                {/* 确认重命名 */}
                                                <button onClick={() => handleRename(ws.id)}
                                                        className="text-emerald-500 hover:text-emerald-400">
                                                    <Check className="h-3.5 w-3.5"/>
                                                </button>
                                                {/* 取消重命名 */}
                                                <button onClick={() => setEditingId(null)}
                                                        className="text-muted-foreground hover:text-foreground">
                                                    <X className="h-3.5 w-3.5"/>
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-xs font-medium truncate">{ws.name}</p>
                                                {/* 显示路径的最后两级作为副标题 */}
                                                <p className="text-xs text-muted-foreground/50 truncate font-mono">{ws.path.split(/[/\\]/).slice(-2).join('/')}</p>
                                            </>
                                        )}
                                    </div>
                                    {/* 操作按钮：重命名和删除，鼠标悬停时显示 */}
                                    {editingId !== ws.id && (
                                        <div
                                            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 shrink-0">
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    setEditingId(ws.id);
                                                    setEditName(ws.name);
                                                }}
                                                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                            >
                                                <Pencil className="h-3 w-3"/>
                                            </button>
                                            <button
                                                onClick={e => handleRemove(ws.id, e)}
                                                className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                                            >
                                                <Trash2 className="h-3 w-3"/>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 左侧面板分隔条 */}
                    <Divider onMouseDown={dragLeft}/>
                </>
            )}

            {/* 左侧面板折叠时的展开按钮 */}
            {leftCollapsed && (
                <div className="flex flex-col items-center pt-3 px-1 border-r border-border bg-muted/10 shrink-0">
                    <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 mb-1"
                        onClick={() => setLeftCollapsed(false)} title={t('workspace.show')}
                    >
                        <PanelLeftOpen className="h-4 w-4"/>
                    </Button>
                </div>
            )}

            {/* ====== 中栏：文件树 / Git 变更 ====== */}
            {!middleCollapsed ? (
                <>
                    <div
                        className="flex flex-col border-r border-border shrink-0 overflow-hidden"
                        style={{width: effectiveMiddle}}
                    >
                        {selectedWs ? (
                            <>
                                {/* 工作区信息头部 */}
                                <div className="px-3 py-2.5 border-b border-border bg-muted/10 shrink-0">
                                    <div className="flex items-center gap-2">
                                        <ProjectTypeIcon type={selectedWs.projectType}/>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold truncate">{selectedWs.name}</p>
                                            <div className="flex items-center gap-1">
                                                {gitStatus?.isGit ? (
                                                    <BranchSelector
                                                        workspacePath={selectedWs.path}
                                                        currentBranch={gitStatus.branch}
                                                        onBranchChange={() => {
                                                            loadGitStatus(selectedWs.path);
                                                            setSelectedChange(null);
                                                            setGitDiffResult(null);
                                                        }}
                                                    />
                                                ) : (
                                                    <>
                                                        <GitBranch className="h-3 w-3 text-muted-foreground/50"/>
                                                        <span className="text-xs text-muted-foreground/50 truncate font-mono">
                                                            {selectedWs.projectType}
                                                        </span>
                                                    </>
                                                )}
                                                {/* 有未提交变更时显示变更数量角标 */}
                                                {gitStatus?.isGit && gitStatus.changes.length > 0 && (
                                                    <span className="text-xs text-amber-500 ml-auto shrink-0">
                            {gitStatus.changes.length}
                          </span>
                                                )}
                                            </div>
                                        </div>
                                        <Button
                                            variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0"
                                            onClick={() => setMiddleCollapsed(true)} title={t('workspace.collapse')}
                                        >
                                            <PanelLeftClose className="h-3.5 w-3.5"/>
                                        </Button>
                                    </div>
                                </div>

                                {/* Files / Changes 标签页切换 */}
                                <div className="flex border-b border-border shrink-0">
                                    <button
                                        onClick={() => setMiddleTab('files')}
                                        className={cn(
                                            'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
                                            middleTab === 'files'
                                                ? 'text-primary border-b-2 border-primary'
                                                : 'text-muted-foreground hover:text-foreground'
                                        )}
                                    >
                                        {t('workspace.filesTab')}
                                    </button>
                                    <button
                                        onClick={() => setMiddleTab('changes')}
                                        className={cn(
                                            'flex-1 px-3 py-1.5 text-xs font-medium transition-colors relative',
                                            middleTab === 'changes'
                                                ? 'text-primary border-b-2 border-primary'
                                                : 'text-muted-foreground hover:text-foreground'
                                        )}
                                    >
                                        {t('workspace.changesTab')}
                                        {/* 变更数量角标 */}
                                        {gitStatus && gitStatus.changes.length > 0 && (
                                            <span
                                                className="ml-1 text-xs text-amber-500">{gitStatus.changes.length}</span>
                                        )}
                                    </button>
                                </div>

                                {/* 标签页内容区域 */}
                                <div className="flex-1 overflow-y-auto py-1">
                                    {middleTab === 'files' ? (
                                        // 文件树标签页
                                        loadingTree ? (
                                            <div className="flex justify-center py-8">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                                            </div>
                                        ) : (
                                            rootEntries.map((entry) => (
                                                <FileTreeNode
                                                    key={entry.path}
                                                    entry={entry}
                                                    workspacePath={selectedWs.path}
                                                    depth={0}
                                                    onFileClick={handleFileClick}
                                                    selectedFile={selectedFile}
                                                />
                                            ))
                                        )
                                    ) : (
                                        // Git 变更标签页
                                        loadingGit ? (
                                            <div className="flex justify-center py-8">
                                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                                            </div>
                                        ) : !gitStatus?.isGit ? (
                                            /* 非 Git 仓库提示 */
                                            <div
                                                className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
                                                <GitBranch className="h-6 w-6 opacity-30"/>
                                                <p className="text-xs text-center">{t('workspace.notGitRepo')}</p>
                                            </div>
                                        ) : gitStatus.changes.length === 0 ? (
                                            /* 无变更提示 */
                                            <div
                                                className="flex flex-col items-center justify-center py-8 px-4 gap-2 text-muted-foreground">
                                                <Check className="h-6 h-6 opacity-30 text-emerald-500"/>
                                                <p className="text-xs text-center">{t('workspace.noChanges')}</p>
                                                <Button variant="ghost" size="sm" className="text-xs h-6 mt-1"
                                                        onClick={() => loadGitStatus(selectedWs.path)}>
                                                    <RefreshCw className="h-3 w-3 mr-1"/>
                                                    {t('common.refresh')}
                                                </Button>
                                            </div>
                                        ) : (
                                            /* 变更文件列表 */
                                            <>
                                                <div className="px-2 py-1 flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {t('workspace.filesChanged', {count: gitStatus.changes.length})}
                          </span>
                                                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0"
                                                            onClick={() => loadGitStatus(selectedWs.path)}
                                                            title={t('common.refresh')}>
                                                        <RefreshCw className="h-3 w-3"/>
                                                    </Button>
                                                </div>
                                                {gitStatus.changes.map((change) => {
                                                    const cfg = STATUS_CONFIG[change.status] || STATUS_CONFIG['?'];
                                                    const isSelected = selectedChange === change.path;
                                                    // 从路径提取文件名和目录（处理 renamed 的 -> ）
                                                    const cleanPath = change.path.replace(/\\/g, '/').split(' -> ').pop() || '';
                                                    const parts = cleanPath.split('/').filter(Boolean);
                                                    const fileName = parts[parts.length - 1] || cleanPath;
                                                    const dirPath = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
                                                    return (
                                                        <div
                                                            key={change.path}
                                                            onClick={() => handleChangeClick(change.path)}
                                                            className={cn(
                                                                'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
                                                                isSelected ? 'bg-primary/10 text-primary' : 'hover:bg-accent/50'
                                                            )}
                                                        >
                                                            {/* 变更状态标签 */}
                                                            <span className={cn(
                                                                'text-xs font-mono font-bold w-4 text-center shrink-0',
                                                                cfg.color
                                                            )}>
                                                                {cfg.label}
                                                            </span>
                                                            {/* 文件名 + 目录路径 */}
                                                            <div className="flex-1 min-w-0">
                                                                <span className={cn(
                                                                    'text-xs truncate block',
                                                                    isSelected ? 'text-primary font-medium' : 'text-foreground'
                                                                )}>
                                                                    {fileName}
                                                                </span>
                                                                {dirPath && (
                                                                    <span className="text-xs text-muted-foreground/50 truncate block font-mono leading-tight">
                                                                        {dirPath}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* 已暂存标识 */}
                                                            {change.staged && (
                                                                <span className="text-xs text-emerald-500 shrink-0">S</span>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        )
                                    )}
                                </div>
                            </>
                        ) : (
                            /* 未选中工作区时的空状态 */
                            <div
                                className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground px-4 text-center">
                                <FolderOpen className="h-8 w-8 opacity-30"/>
                                <p className="text-xs">{t('workspace.selectToBrowse')}</p>
                            </div>
                        )}
                    </div>

                    {/* 中间面板分隔条 */}
                    <Divider onMouseDown={dragMiddle}/>
                </>
            ) : (
                /* 中间面板折叠时的展开按钮 */
                <div className="flex flex-col items-center pt-3 px-1 border-r border-border bg-muted/10 shrink-0">
                    <Button
                        variant="ghost" size="sm" className="h-6 w-6 p-0 mb-1"
                        onClick={() => setMiddleCollapsed(false)} title={t('workspace.showFileTree')}
                    >
                        <PanelLeftOpen className="h-4 w-4"/>
                    </Button>
                </div>
            )}

            {/* ====== 右栏：文件预览 / Diff 视图 ====== */}
            <div className="flex-1 flex flex-col min-w-0">
                {showDiffView ? (
                    // Diff 视图模式
                    loadingDiff ? (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin opacity-20"/>
                            <p className="text-sm">{t('workspace.loadingDiff')}</p>
                        </div>
                    ) : gitDiffResult ? (
                        <DiffView
                            diff={gitDiffResult.diff}
                            additions={gitDiffResult.additions}
                            deletions={gitDiffResult.deletions}
                            filePath={gitDiffResult.path}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                            <FileMinus className="h-10 w-10 opacity-20"/>
                            <p className="text-sm">{t('workspace.noDiff')}</p>
                        </div>
                    )
                ) : showFilePreview ? (
                    // 文件预览模式
                    <>
                        {/* 文件信息头部：文件名、语言类型、文件大小 */}
                        <div
                            className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
                            <Code className="h-4 w-4 text-muted-foreground shrink-0"/>
                            <span className="text-sm font-mono text-foreground truncate">{selectedFileName}</span>
                            <span className="text-xs text-muted-foreground/50 ml-auto shrink-0">
                {getLanguage(selectedFileName)}
              </span>
                            {fileContent && (
                                <span className="text-xs text-muted-foreground/50 shrink-0">
                  {fileContent.size < 1024
                      ? `${fileContent.size}B`
                      : `${(fileContent.size / 1024).toFixed(1)}KB`}
                </span>
                            )}
                        </div>

                        {/* 文件内容区域：深色主题代码预览 */}
                        <div className="flex-1 overflow-auto bg-[#1e1e1e]">
                            {loadingFile ? (
                                <div className="flex justify-center py-12">
                                    <Loader2 className="h-5 w-5 animate-spin text-gray-400"/>
                                </div>
                            ) : fileContent ? (
                                <pre
                                    className="p-4 text-xs font-mono text-gray-200 leading-relaxed whitespace-pre overflow-x-auto min-h-full">
                  {fileContent.content}
                </pre>
                            ) : null}
                        </div>
                    </>
                ) : (
                    /* 未选中任何内容时的空状态 */
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                        <Eye className="h-10 w-10 opacity-20"/>
                        <p className="text-sm">{t('workspace.selectFilePreview')}</p>
                        <p className="text-xs opacity-60">{t('workspace.selectFilePreviewSub')}</p>
                    </div>
                )}
            </div>
            <ConflictResolutionModal
                open={conflictModal.open}
                onClose={() => setConflictModal({open: false, conflicts: []})}
                workspacePath={selectedWs?.path || ''}
                conflicts={conflictModal.conflicts}
                onResolved={() => {
                    if (selectedWs) loadGitStatus(selectedWs.path);
                    setConflictModal({open: false, conflicts: []});
                }}
            />
        </div>
    );
}
