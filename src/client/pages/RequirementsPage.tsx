/**
 * @file RequirementsPage.tsx
 * @description 需求管理页面组件
 *
 * 该页面用于从 ONES 项目管理平台获取、搜索和保存需求（Requirements）。
 * 支持以下核心功能：
 * 1. 通过需求 ID 直接获取并保存需求到本地存储
 * 2. 通过 MCP（Model Context Protocol）搜索 ONES 中的需求
 * 3. 查看已保存需求的详细信息（描述、验收标准、附件、关联缺陷等）
 * 4. 管理本地需求列表（选择、删除）
 *
 * 已保存的需求可在 Pipeline 运行时使用，实现需求驱动的开发流程。
 */
import {useState, useEffect, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {Joyride} from 'react-joyride';
import {useGuide} from '../guides/useGuide';
import {apiGet, apiPost, apiPut, apiDelete} from '../api';
import {useAppStore} from '../stores/app-store';
import {cn} from '../lib/utils';
import {Badge} from '../components/ui/badge';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {MarkdownContent} from '../components/MarkdownContent';
import {Card, CardContent} from '../components/ui/card';
import {
    Search,
    X,
    CheckCircle2,
    AlertCircle,
    User,
    Link2,
    FileText,
    Loader2,
    Plus,
    Trash2,
    Download,
    BookOpen,
    Clock,
    Pencil,
    Save,
} from 'lucide-react';

/**
 * @interface Requirement
 * @description 需求基本信息接口
 * 用于列表展示和搜索结果，仅包含核心字段
 */
interface Requirement {
    /** 需求唯一标识符 */
    id: string;
    /** 需求编号（如 #91086） */
    number?: string;
    /** 需求标题 */
    title: string;
    /** 需求状态（如：待处理、进行中、已完成等） */
    status: string;
    /** 需求优先级（如：高、中、低） */
    priority: string;
    /** 需求负责人 */
    assignee: string;
    /** 最后更新时间（ISO 格式） */
    updatedAt: string;
}

/**
 * @interface StoredRequirement
 * @extends Requirement
 * @description 已保存需求的完整信息接口
 * 包含从 ONES 获取并保存到本地后的所有详细信息
 */
interface StoredRequirement extends Requirement {
    /** 需求详细描述 */
    description: string;
    /** 验收标准列表 */
    acceptanceCriteria: string[];
    /** 附件列表（文件名、URL、类型） */
    attachments: { name: string; url: string; type: string }[];
    /** 关联的缺陷/问题列表 */
    relatedIssues: { id: string; title: string; status: string }[];
    /** 本地保存时间（ISO 格式） */
    savedAt: string;
    /** 需求来源标识（如 ONES 系统名） */
    source: string;
}

/**
 * @function RequirementsPage
 * @description 需求管理页面主组件
 *
 * 页面布局采用左右分栏结构：
 * - 左侧：已保存需求列表，支持选择和删除操作
 * - 右侧：选中需求的详细信息展示
 * - 顶部：需求获取（按 ID）和搜索功能区域
 *
 * @returns {JSX.Element} 需求管理页面的 React 组件
 */
export default function RequirementsPage() {
    const {t} = useTranslation();
    const {run: guideRun, steps: guideSteps, handleJoyrideEvent} = useGuide('requirements');
    // === 已保存需求相关状态 ===
    /** 已保存到本地的需求列表 */
    const [saved, setSaved] = useState<StoredRequirement[]>([]);
    /** 当前选中的需求详情（右侧面板展示） */
    const [selected, setSelected] = useState<StoredRequirement | null>(null);
    /** 是否正在加载已保存需求列表 */
    const [loadingSaved, setLoadingSaved] = useState(false);

    // === 按 ID 获取需求相关状态 ===
    /** 用户输入的需求 ID */
    const [fetchId, setFetchId] = useState('');
    /** 是否正在获取需求 */
    const [fetching, setFetching] = useState(false);
    /** 获取需求时的错误信息 */
    const [fetchError, setFetchError] = useState<string | null>(null);
    /** 是否解析文档附件 */
    const [parseDocuments, setParseDocuments] = useState(false);

    // === MCP 搜索相关状态 ===
    /** 搜索关键词 */
    const [searchQuery, setSearchQuery] = useState('');
    /** 搜索结果列表（不自动保存） */
    const [searchResults, setSearchResults] = useState<Requirement[]>([]);
    /** 是否正在搜索 */
    const [searching, setSearching] = useState(false);
    /** 搜索时的错误信息 */
    const [searchError, setSearchError] = useState<string | null>(null);
    /** 是否展开搜索面板 */
    const [showSearch, setShowSearch] = useState(false);

    // === 编辑相关状态 ===
    /** 是否处于编辑模式 */
    const [editing, setEditing] = useState(false);
    /** 编辑中的标题 */
    const [editTitle, setEditTitle] = useState('');
    /** 编辑中的描述 */
    const [editDescription, setEditDescription] = useState('');
    /** 是否正在保存编辑 */
    const [saving, setSaving] = useState(false);

    /** 从全局状态获取设置选中需求的方法 */
    const setSelectedRequirement = useAppStore((s) => s.setSelectedRequirement);

    /**
     * 加载已保存的需求列表
     * 从后端 API 获取所有已保存的需求数据
     */
    const loadSaved = useCallback(async () => {
        setLoadingSaved(true);
        try {
            const data = await apiGet<StoredRequirement[]>('/requirements/saved');
            setSaved(data);
        } catch {
            // 静默处理加载失败，保持现有数据不变
        } finally {
            setLoadingSaved(false);
        }
    }, []);

    // 组件挂载时自动加载已保存的需求列表
    useEffect(() => {
        loadSaved();
    }, [loadSaved]);

    /**
     * 通过 ID 从 MCP 获取需求并保存到本地
     * 获取成功后自动更新列表、选中该需求并同步到全局状态
     */
    const handleFetch = async () => {
        if (!fetchId.trim()) return;
        setFetching(true);
        setFetchError(null);
        try {
            const req = await apiPost<StoredRequirement>('/requirements/fetch', {id: fetchId.trim(), parseDocuments});
            // 去重后插入到列表头部（最新的排在前面）
            setSaved(prev => {
                const filtered = prev.filter(r => r.id !== req.id);
                return [req, ...filtered];
            });
            setSelected(req);
            setSelectedRequirement(req);
            setFetchId('');
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'Failed to fetch requirement');
        } finally {
            setFetching(false);
        }
    };

    /**
     * 通过 MCP 搜索需求
     * 注意：搜索结果不会自动保存，用户需要手动点击保存按钮
     */
    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true);
        setSearchError(null);
        try {
            const results = await apiGet<Requirement[]>(
                `/requirements/search?q=${encodeURIComponent(searchQuery)}`
            );
            setSearchResults(results);
        } catch (err) {
            setSearchError(err instanceof Error ? err.message : 'Search failed');
        } finally {
            setSearching(false);
        }
    };

    /**
     * 将搜索结果中的某个需求保存到本地存储
     * 调用与按 ID 获取相同的接口，确保获取完整信息
     */
    const handleSaveFromSearch = async (req: Requirement) => {
        try {
            const saved = await apiPost<StoredRequirement>('/requirements/fetch', {id: req.id, parseDocuments});
            setSaved(prev => {
                const filtered = prev.filter(r => r.id !== saved.id);
                return [saved, ...filtered];
            });
            setSelected(saved);
            setSelectedRequirement(saved);
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'Failed to save requirement');
        }
    };

    /**
     * 删除已保存的需求
     * 如果删除的是当前选中的需求，同时清空选中状态和全局状态
     */
    const handleDelete = async (id: string) => {
        try {
            await apiDelete(`/requirements/saved/${id}`);
            setSaved(prev => prev.filter(r => r.id !== id));
            if (selected?.id === id) {
                setSelected(null);
                setSelectedRequirement(null);
            }
        } catch {
            // 静默处理删除失败
        }
    };

    /**
     * 选中一个已保存的需求
     * 同时更新本地状态和全局状态（供 Pipeline 使用）
     */
    const handleSelect = (req: StoredRequirement) => {
        setSelected(req);
        setSelectedRequirement(req);
        setEditing(false);
    };

    /**
     * 进入编辑模式
     * 用当前选中需求的数据初始化编辑表单
     */
    const startEdit = () => {
        if (!selected) return;
        setEditTitle(selected.title);
        setEditDescription(selected.description);
        setEditing(true);
    };

    /**
     * 取消编辑，恢复原始数据
     */
    const cancelEdit = () => {
        setEditing(false);
    };

    /**
     * 保存编辑后的需求
     * 调用 PUT API 更新标题和描述，成功后刷新本地和全局状态
     */
    const saveEdit = async () => {
        if (!selected) return;
        setSaving(true);
        try {
            const updated = await apiPut<StoredRequirement>(`/requirements/saved/${selected.id}`, {
                title: editTitle,
                description: editDescription,
            });
            setSelected(updated);
            setSelectedRequirement(updated);
            setSaved(prev => prev.map(r => r.id === updated.id ? updated : r));
            setEditing(false);
        } catch {
            // 静默处理保存失败
        } finally {
            setSaving(false);
        }
    };

    /**
     * 根据优先级返回对应的样式类名
     * 用于 Badge 组件的颜色区分
     */
    const priorityColor = (p: string) => {
        switch (p.toLowerCase()) {
            case 'high':
                return 'text-red-500 bg-red-500/10';
            case 'medium':
                return 'text-yellow-500 bg-yellow-500/10';
            case 'low':
                return 'text-green-500 bg-green-500/10';
            default:
                return 'text-muted-foreground bg-muted';
        }
    };

    /**
     * 根据状态返回对应的样式类名
     * 用于 Badge 组件的颜色区分
     */
    const statusColor = (s: string) => {
        switch (s.toLowerCase()) {
            case 'done':
            case 'completed':
                return 'text-green-500 bg-green-500/10';
            case 'in_progress':
            case 'in progress':
                return 'text-blue-500 bg-blue-500/10';
            default:
                return 'text-muted-foreground bg-muted';
        }
    };

    return (
        <div className="flex h-full flex-col">
            {/* === 顶部区域：页面标题、需求获取和搜索 === */}
            <div className="border-b border-border px-6 py-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">{t('pageTitle.requirements')}</h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            {t('requirements.subtitle')}
                        </p>
                    </div>
                    {/* 切换 MCP 搜索面板的按钮 */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowSearch(!showSearch)}
                        data-tour="req-search-btn"
                    >
                        <Search className="h-4 w-4 mr-1.5"/>
                        {t('requirements.searchMcp')}
                    </Button>
                </div>

                {/* 通过 ID 获取需求的输入区域 */}
                <div className="mt-4 flex gap-2" data-tour="req-fetch-input">
                    <div className="relative flex-1">
                        <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                        <Input
                            value={fetchId}
                            onChange={(e) => setFetchId(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                            placeholder={t('requirements.fetchPlaceholder')}
                            className="pl-9"
                        />
                    </div>
                    {/* 获取并保存按钮，输入为空时禁用 */}
                    <Button onClick={handleFetch} disabled={fetching || !fetchId.trim()}>
                        {fetching ? <Loader2 className="h-4 w-4 animate-spin"/> :
                            <Download className="h-4 w-4 mr-1.5"/>}
                        {fetching ? t('requirements.fetching') : t('requirements.fetch')}
                    </Button>
                </div>

                {/* 文档解析开关 */}
                <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={parseDocuments}
                        onChange={(e) => setParseDocuments(e.target.checked)}
                        className="rounded border-input"
                    />
                    {t('requirements.parseDocuments')}
                </label>

                {/* 获取失败的错误提示 */}
                {fetchError && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0"/>
                        {fetchError}
                    </div>
                )}

                {/* MCP 搜索面板（可折叠） */}
                {showSearch && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                        <div className="flex gap-2">
                            <Input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                placeholder={t('requirements.searchPlaceholder')}
                                className="flex-1"
                            />
                            <Button onClick={handleSearch} disabled={searching} size="sm">
                                {searching ? <Loader2 className="h-4 w-4 animate-spin"/> :
                                    <Search className="h-4 w-4"/>}
                            </Button>
                            {/* 关闭搜索面板按钮，同时清空搜索结果 */}
                            <Button variant="ghost" size="sm" onClick={() => {
                                setShowSearch(false);
                                setSearchResults([]);
                            }}>
                                <X className="h-4 w-4"/>
                            </Button>
                        </div>
                        {searchError && (
                            <p className="mt-2 text-xs text-destructive">{searchError}</p>
                        )}
                        {/* 搜索结果列表，每个结果可单独保存 */}
                        {searchResults.length > 0 && (
                            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                                {searchResults.map(r => (
                                    <div key={r.id}
                                         className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent text-sm">
                                        <span
                                            className="flex-1 truncate">{r.number ? `${r.number} ` : ''}{r.title}</span>
                                        <span
                                            className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(r.status))}>{r.status}</span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-6 px-2 text-xs"
                                            onClick={() => handleSaveFromSearch(r)}
                                        >
                                            <Plus className="h-3 w-3 mr-1"/>
                                            {t('common.save')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* === 主内容区域：左右分栏布局 === */}
            <div className="flex flex-1 min-h-0">
                {/* 左侧：已保存需求列表 */}
                <div className="w-80 flex flex-col border-r border-border" data-tour="req-saved-list">
                    <div className="px-4 py-2 border-b border-border bg-muted/20">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t('requirements.savedLabel', {count: saved.length})}
                        </p>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {/* 加载中的旋转指示器 */}
                        {loadingSaved && (
                            <div className="flex justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}
                        {/* 空状态提示 */}
                        {!loadingSaved && saved.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
                                <FileText className="h-8 w-8 text-muted-foreground/30"/>
                                <p className="text-sm text-muted-foreground">{t('requirements.emptyTitle')}</p>
                                <p className="text-xs text-muted-foreground/60">
                                    {t('requirements.emptySubtitle')}
                                </p>
                            </div>
                        )}
                        {/* 需求列表项，选中项高亮显示 */}
                        {saved.map(req => (
                            <div
                                key={req.id}
                                onClick={() => handleSelect(req)}
                                className={cn(
                                    'flex items-start gap-3 px-4 py-3 border-b border-border/50 cursor-pointer transition-colors group',
                                    selected?.id === req.id
                                        ? 'bg-primary/5 border-l-2 border-l-primary'
                                        : 'hover:bg-accent/50'
                                )}
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{req.number ? `${req.number} ` : ''}{req.title}</p>
                                    <div className="mt-1 flex items-center gap-2">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(req.status))}>
                      {req.status}
                    </span>
                                        <span
                                            className={cn('text-xs px-1.5 py-0.5 rounded', priorityColor(req.priority))}>
                      {req.priority}
                    </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground/60">
                                        <Clock className="h-3 w-3"/>
                                        {new Date(req.savedAt).toLocaleDateString()}
                                    </div>
                                </div>
                                {/* 删除按钮：鼠标悬停时显示，阻止冒泡避免触发选中 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDelete(req.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                                >
                                    <Trash2 className="h-3.5 w-3.5"/>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 右侧：需求详情面板 */}
                <div className="flex-1 overflow-y-auto">
                    {selected ? (
                        <div className="p-6">
                            {/* 标题栏：需求标题、编辑和关闭按钮 */}
                            <div className="flex items-start justify-between gap-4">
                                {editing ? (
                                    <Input
                                        value={editTitle}
                                        onChange={(e) => setEditTitle(e.target.value)}
                                        className="text-lg font-semibold"
                                    />
                                ) : (
                                    <h2 className="text-lg font-semibold leading-tight">{selected.number ? `${selected.number} ` : ''}{selected.title}</h2>
                                )}
                                <div className="flex items-center gap-1">
                                    {!editing && (
                                        <button
                                            onClick={startEdit}
                                            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                            title={t('common.edit')}
                                        >
                                            <Pencil className="h-4 w-4"/>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => setSelected(null)}
                                        className="p-1 rounded hover:bg-accent text-muted-foreground"
                                    >
                                        <X className="h-4 w-4"/>
                                    </button>
                                </div>
                            </div>

                            {/* 编辑模式下的保存/取消按钮 */}
                            {editing && (
                                <div className="mt-3 flex gap-2">
                                    <Button size="sm" onClick={saveEdit} disabled={saving}>
                                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5"/> :
                                            <Save className="h-4 w-4 mr-1.5"/>}
                                        {saving ? t('requirements.saving') : t('common.save')}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saving}>
                                        {t('common.cancel')}
                                    </Button>
                                </div>
                            )}

                            {/* 元信息标签：状态、优先级、负责人、来源 */}
                            <div className="mt-3 flex flex-wrap gap-2">
                <span className={cn('text-xs px-2 py-1 rounded-full font-medium', statusColor(selected.status))}>
                  {selected.status}
                </span>
                                <span
                                    className={cn('text-xs px-2 py-1 rounded-full font-medium', priorityColor(selected.priority))}>
                  {selected.priority}
                </span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <User className="h-3 w-3"/>
                                    {selected.assignee || t('requirements.unassigned')}
                </span>
                                <span className="text-xs text-muted-foreground">
                  {t('requirements.source')} <code className="bg-muted px-1 rounded">{selected.source}</code>
                </span>
                            </div>

                            {/* 需求描述 - 编辑模式用 textarea，查看模式用 Markdown 渲染 */}
                            {editing ? (
                                <div className="mt-5">
                                    <textarea
                                        value={editDescription}
                                        onChange={(e) => setEditDescription(e.target.value)}
                                        className="w-full min-h-[400px] p-3 rounded-lg border border-border bg-background text-sm font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30"
                                        placeholder={t('requirements.descriptionPlaceholder')}
                                    />
                                </div>
                            ) : (
                                selected.description && (
                                    <div className="mt-5">
                                        <MarkdownContent content={selected.description}/>
                                    </div>
                                )
                            )}

                            {/* 验收标准列表 */}
                            {selected.acceptanceCriteria.length > 0 && (
                                <div className="mt-5">
                                    <h4 className="text-sm font-medium mb-2">{t('requirements.acceptanceCriteria')}</h4>
                                    <ul className="space-y-2">
                                        {selected.acceptanceCriteria.map((ac, i) => (
                                            <li key={i}
                                                className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0"/>
                                                <span>{ac}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* 关联缺陷/问题列表 */}
                            {selected.relatedIssues.length > 0 && (
                                <div className="mt-5">
                                    <h4 className="text-sm font-medium mb-2">{t('requirements.relatedIssues')}</h4>
                                    <ul className="space-y-1.5">
                                        {selected.relatedIssues.map(issue => (
                                            <li key={issue.id}
                                                className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Link2 className="h-3.5 w-3.5"/>
                                                <span
                                                    className={cn('text-xs px-1.5 py-0.5 rounded', statusColor(issue.status))}>
                          {issue.status}
                        </span>
                                                <span>{issue.title}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        /* 未选中需求时的空状态提示 */
                        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                            <FileText className="h-12 w-12 opacity-20"/>
                            <p className="text-sm">{t('requirements.noSelectionTitle')}</p>
                            <p className="text-xs opacity-60">{t('requirements.noSelectionSubtitle')}</p>
                        </div>
                    )}
                </div>
            </div>
            <Joyride
                steps={guideSteps}
                run={guideRun}
                onEvent={handleJoyrideEvent}
                continuous
                options={{
                    showProgress: true,
                    skipBeacon: true,
                    primaryColor: '#6366f1',
                    buttons: ['back', 'close', 'primary', 'skip'],
                    zIndex: 10000
                }}
            />
        </div>
    );
}
