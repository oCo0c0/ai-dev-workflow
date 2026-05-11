/**
 * @file FolderPickerModal.tsx
 * @description 文件夹选择器模态弹窗组件 —— 提供可视化的文件系统浏览界面，
 *              允许用户通过点击导航的方式选择目标文件夹路径。
 *
 * 功能特性：
 * - 支持文件夹层级浏览：点击文件夹进入下一级，支持返回上一级和回到根目录
 * - 导航历史栈管理：使用 pathStack 数组记录浏览路径，支持逐级回退
 * - 目录条目排序：文件夹优先展示，同类型内按名称字母序排列
 * - 面包屑路径指示：顶部显示当前路径的层级结构
 * - 错误与加载状态处理：网络请求失败时展示错误信息，加载中显示旋转动画
 * - 仅允许选择文件夹：文件条目以半透明样式展示且不可点击
 *
 * @exports FolderPickerModal - 命名导出的文件夹选择器弹窗组件
 */

import {useState, useEffect, useCallback} from 'react';
import {apiGet} from '../api';
import {cn} from '../lib/utils';
import {
    Folder,
    FolderOpen,
    File,
    ChevronRight,
    Home,
    ArrowLeft,
    X,
    Check,
    Loader2,
} from 'lucide-react';

/**
 * 目录条目数据接口
 *
 * 对应后端 `/workspace/browse` API 返回的每个文件/文件夹条目。
 *
 * @property name       - 文件或文件夹的名称（不含路径）
 * @property path       - 文件或文件夹的完整路径
 * @property isDirectory - 是否为文件夹（true: 文件夹, false: 文件）
 * @property size       - 文件大小（字节数），仅文件有值（可选）
 * @property modifiedAt - 最后修改时间的字符串表示
 */
interface DirectoryEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    modifiedAt: string;
}

/**
 * FolderPickerModal 组件的属性接口
 *
 * @property open        - 控制弹窗是否可见
 * @property onClose     - 关闭弹窗的回调函数
 * @property onSelect    - 选中文件夹后的回调函数，参数为选中的文件夹路径
 * @property initialPath - 弹窗打开时的初始浏览路径（可选，默认为空即根目录）
 * @property title       - 弹窗标题文本（可选，默认为 'Select Folder'）
 */
interface FolderPickerModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    initialPath?: string;
    title?: string;
}

/**
 * 文件夹选择器模态弹窗组件
 *
 * 以全屏遮罩 + 居中卡片的形式展示，内部提供完整的文件系统浏览功能。
 * 用户可以在目录树中逐级浏览，最终选择一个文件夹并确认。
 *
 * @component
 * @param {FolderPickerModalProps} props - 组件属性
 * @returns {JSX.Element | null} 弹窗打开时返回完整的模态弹窗 DOM，关闭时返回 null
 */
export function FolderPickerModal({
                                      open,
                                      onClose,
                                      onSelect,
                                      initialPath,
                                      title = 'Select Folder',
                                  }: FolderPickerModalProps) {
    /** 当前浏览的目录路径 */
    const [currentPath, setCurrentPath] = useState(initialPath || '');
    /** 当前目录下的文件/文件夹条目列表 */
    const [entries, setEntries] = useState<DirectoryEntry[]>([]);
    /** 是否正在加载目录内容 */
    const [loading, setLoading] = useState(false);
    /** 请求过程中捕获的错误信息 */
    const [error, setError] = useState<string | null>(null);
    /**
     * 导航历史栈：记录每次进入子目录前的父路径
     * 用于实现"返回上一级"功能，栈顶元素为最近一次的父路径
     */
    const [pathStack, setPathStack] = useState<string[]>([]);

    /**
     * 异步浏览指定路径的目录内容
     *
     * 调用后端 `/workspace/browse` API 获取指定路径下的文件列表，
     * 并对结果进行排序：文件夹优先于文件，同类型内按名称字母序排列。
     *
     * @param path - 要浏览的目录路径，空字符串表示根目录
     */
    const browse = useCallback(async (path: string) => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet<DirectoryEntry[]>(
                `/workspace/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`
            );
            // 排序规则：文件夹排在前面（isDirectory 为 true 时返回 -1），
            // 同类型内按名称进行本地化字母序比较
            const sorted = [...data].sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setEntries(sorted);
            setCurrentPath(path);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to browse directory');
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * 弹窗打开时的初始化逻辑
     *
     * 每次弹窗打开时重置导航历史栈，
     * 并加载初始路径（或根目录）的目录内容。
     */
    useEffect(() => {
        if (open) {
            setPathStack([]);
            browse(initialPath || '');
        }
    }, [open, initialPath, browse]);

    /**
     * 进入子目录
     *
     * 仅对文件夹条目有效：将当前路径压入导航历史栈，
     * 然后加载目标文件夹的内容。
     *
     * @param entry - 被点击的目录条目
     */
    const navigateInto = (entry: DirectoryEntry) => {
        if (!entry.isDirectory) return;
        setPathStack(prev => [...prev, currentPath]);
        browse(entry.path);
    };

    /**
     * 返回上一级目录
     *
     * 从导航历史栈中弹出最近的路径作为返回目标，
     * 同时裁剪历史栈。若历史栈为空则返回根目录。
     */
    const navigateBack = () => {
        const prev = pathStack[pathStack.length - 1] ?? '';
        setPathStack(p => p.slice(0, -1));
        browse(prev);
    };

    /**
     * 回到根目录
     *
     * 清空导航历史栈并加载根目录内容。
     */
    const navigateHome = () => {
        setPathStack([]);
        browse('');
    };

    /**
     * 确认选择当前文件夹
     *
     * 当存在有效路径时，调用 onSelect 回调将路径传递给父组件，
     * 然后自动关闭弹窗。
     */
    const handleSelect = () => {
        if (currentPath) {
            onSelect(currentPath);
            onClose();
        }
    };

    /**
     * 根据当前路径生成面包屑导航的各段文本
     *
     * 将路径中的反斜杠统一替换为正斜杠后按分隔符拆分，
     * 并过滤掉空字符串段。
     */
    const breadcrumbs = currentPath
        ? currentPath.replace(/\\/g, '/').split('/').filter(Boolean)
        : [];

    // 弹窗未打开时不渲染任何 DOM
    if (!open) return null;

    return (
        <>
            {/* 全屏遮罩容器 */}
            <div className="fixed inset-0 z-50 flex items-center justify-center">
                {/* 半透明背景遮罩：点击时关闭弹窗 */}
                <div
                    className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                    onClick={onClose}
                />

                {/* 模态弹窗主体卡片 */}
                <div
                    className="relative z-10 w-full max-w-2xl mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
                    {/* 弹窗头部：标题 + 关闭按钮 */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <h2 className="text-sm font-semibold">{title}</h2>
                        <button
                            onClick={onClose}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                            <X className="h-4 w-4"/>
                        </button>
                    </div>

                    {/* 工具栏：导航按钮 + 面包屑路径显示 */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
                        {/* 回到根目录按钮 */}
                        <button
                            onClick={navigateHome}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                            title="Home"
                        >
                            <Home className="h-4 w-4"/>
                        </button>
                        {/* 返回上一级按钮：历史栈为空时禁用 */}
                        <button
                            onClick={navigateBack}
                            disabled={pathStack.length === 0}
                            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Back"
                        >
                            <ArrowLeft className="h-4 w-4"/>
                        </button>

                        {/* 面包屑路径导航：显示从根到当前目录的路径层级 */}
                        <div className="flex items-center gap-1 flex-1 overflow-hidden text-xs">
                            <span className="text-muted-foreground shrink-0">/</span>
                            {breadcrumbs.map((crumb, i) => (
                                <span key={i} className="flex items-center gap-1 min-w-0">
                                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0"/>
                                    <span className="truncate text-foreground">{crumb}</span>
                                </span>
                            ))}
                            {/* 根目录时显示 "Home" 占位文本 */}
                            {breadcrumbs.length === 0 && (
                                <span className="text-muted-foreground">Home</span>
                            )}
                        </div>
                    </div>

                    {/* 文件/文件夹列表区域 */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                        {/* 错误提示：请求失败时显示错误信息 */}
                        {error && (
                            <div
                                className="m-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                {error}
                            </div>
                        )}

                        {/* 加载状态：显示旋转加载动画 */}
                        {loading && (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}

                        {/* 空目录提示：无加载、无错误且无条目时显示 */}
                        {!loading && entries.length === 0 && !error && (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <Folder className="h-8 w-8 mb-2 opacity-30"/>
                                <p className="text-sm">Empty directory</p>
                            </div>
                        )}

                        {/* 目录条目列表：仅文件夹可点击进入，文件以半透明样式展示 */}
                        {!loading && entries.map((entry) => (
                            <div
                                key={entry.path}
                                onClick={() => entry.isDirectory && navigateInto(entry)}
                                className={cn(
                                    'flex items-center gap-3 px-4 py-2.5 border-b border-border/40 last:border-0 text-sm transition-colors',
                                    // 文件夹条目：可点击，悬停时高亮
                                    entry.isDirectory
                                        ? 'cursor-pointer hover:bg-accent/50 group'
                                        // 文件条目：半透明且不可交互
                                        : 'opacity-50 cursor-default'
                                )}
                            >
                                {/* 文件夹使用蓝色打开图标，文件使用灰色文件图标 */}
                                {entry.isDirectory ? (
                                    <FolderOpen className="h-4 w-4 text-blue-400 shrink-0 group-hover:text-blue-300"/>
                                ) : (
                                    <File className="h-4 w-4 text-muted-foreground/40 shrink-0"/>
                                )}
                                {/* 条目名称：文件夹使用加粗样式，文件使用次要文字颜色 */}
                                <span className={cn(
                                    'flex-1 truncate',
                                    entry.isDirectory ? 'text-foreground font-medium' : 'text-muted-foreground'
                                )}>
                                    {entry.name}
                                </span>
                                {/* 文件夹条目右侧显示右箭头，暗示可点击进入 */}
                                {entry.isDirectory && (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0"/>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* 底部操作栏：当前路径显示 + 取消/选择按钮 */}
                    <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
                        {/* 左侧：显示当前选中的完整路径，或引导提示文本 */}
                        <div className="flex-1 min-w-0 mr-3">
                            {currentPath ? (
                                <p className="text-xs text-muted-foreground truncate font-mono">{currentPath}</p>
                            ) : (
                                <p className="text-xs text-muted-foreground">Navigate to a folder and click Select</p>
                            )}
                        </div>
                        {/* 右侧：取消和确认选择按钮 */}
                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent transition-colors"
                            >
                                Cancel
                            </button>
                            {/* 选择按钮：无有效路径时禁用 */}
                            <button
                                onClick={handleSelect}
                                disabled={!currentPath}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                <Check className="h-3.5 w-3.5"/>
                                Select
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
