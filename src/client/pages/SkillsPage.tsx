/**
 * @file SkillsPage.tsx
 * @description 技能（Skills）管理页面组件
 *
 * 该页面用于管理 Claude Code 的自定义技能（Skills）。
 * 技能是以 Markdown 格式编写的指令模板，可被 Claude 在对话中调用，
 * 用于实现特定的开发工作流或自动化任务。
 *
 * 支持以下核心功能：
 * 1. 查看已有技能列表
 * 2. 创建新技能（名称、描述、内容）
 * 3. 编辑已有技能的内容
 * 4. 删除技能
 * 5. 查看技能的详细内容
 *
 * 页面布局采用左右分栏结构：
 * - 左侧：技能列表，支持新建和删除操作
 * - 右侧：技能内容编辑/预览区域
 */
import {useState, useEffect, useCallback} from 'react';
import {apiGet, apiPost, apiPut, apiDelete} from '../api';
import {cn} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Card} from '../components/ui/card';
import {
    Plus,
    Trash2,
    Pencil,
    Save,
    X,
    Zap,
    Loader2,
    FileCode,
} from 'lucide-react';

/**
 * @interface Skill
 * @description 技能基本信息接口
 * 用于列表展示，不包含技能内容
 */
interface Skill {
    /** 技能唯一名称标识 */
    name: string;
    /** 技能简要描述 */
    description: string;
    /** 是否启用 */
    enabled: boolean;
    /** 技能文件在服务器上的存储路径 */
    filePath: string;
}

/**
 * @interface SkillDetail
 * @extends Skill
 * @description 技能详细信息接口
 * 在基本信息基础上包含完整的技能内容（Markdown 格式）
 */
interface SkillDetail extends Skill {
    /** 技能的完整内容（Markdown 格式的指令文本） */
    content: string;
}

/**
 * @function SkillsPage
 * @description 技能管理页面主组件
 *
 * 提供技能的完整 CRUD 操作界面：
 * - 列表视图：展示所有已注册的技能
 * - 创建视图：填写名称、描述和内容来创建新技能
 * - 详情视图：查看选中技能的完整内容
 * - 编辑视图：修改已有技能的内容
 *
 * @returns {JSX.Element} 技能管理页面的 React 组件
 */
export default function SkillsPage() {
    // === 列表和选中状态 ===
    /** 所有技能列表 */
    const [skills, setSkills] = useState<Skill[]>([]);
    /** 当前选中的技能详情 */
    const [selected, setSelected] = useState<SkillDetail | null>(null);

    // === 编辑模式状态 ===
    /** 是否处于编辑模式 */
    const [editing, setEditing] = useState(false);
    /** 编辑中的内容（独立于 selected，用于取消编辑时恢复） */
    const [editContent, setEditContent] = useState('');

    // === 创建模式状态 ===
    /** 是否处于创建模式 */
    const [creating, setCreating] = useState(false);
    /** 新技能名称 */
    const [newName, setNewName] = useState('');
    /** 新技能描述 */
    const [newDescription, setNewDescription] = useState('');
    /** 新技能内容 */
    const [newContent, setNewContent] = useState('');

    // === 通用状态 ===
    /** 是否正在加载数据 */
    const [loading, setLoading] = useState(false);
    /** 全局错误信息 */
    const [error, setError] = useState<string | null>(null);

    /**
     * 获取所有技能列表
     * 调用后端 API 获取技能基本信息数组
     */
    const fetchSkills = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet<Skill[]>('/skills');
            setSkills(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to fetch skills';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * 选中并加载某个技能的详细信息
     * 同时退出创建模式，重置编辑状态
     */
    const selectSkill = async (name: string) => {
        try {
            const detail = await apiGet<SkillDetail>(`/skills/${encodeURIComponent(name)}`);
            setSelected(detail);
            setEditContent(detail.content);
            setEditing(false);
            setCreating(false);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to fetch skill';
            setError(msg);
        }
    };

    /**
     * 保存编辑后的技能内容
     * 更新成功后退出编辑模式并刷新列表
     */
    const saveEdit = async () => {
        if (!selected) return;
        try {
            await apiPut(`/skills/${encodeURIComponent(selected.name)}`, {
                ...selected,
                content: editContent,
            });
            setSelected({...selected, content: editContent});
            setEditing(false);
            fetchSkills();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to save skill';
            setError(msg);
        }
    };

    /**
     * 创建新技能
     * 验证名称非空后提交到后端，成功后重置表单并刷新列表
     */
    const createSkill = async () => {
        if (!newName.trim()) return;
        try {
            await apiPost('/skills', {
                name: newName.trim(),
                description: newDescription.trim(),
                content: newContent,
                enabled: true,
            });
            setCreating(false);
            setNewName('');
            setNewDescription('');
            setNewContent('');
            fetchSkills();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to create skill';
            setError(msg);
        }
    };

    /**
     * 删除技能
     * 弹出确认对话框后调用 API 删除，同时清理选中状态
     */
    const deleteSkill = async (name: string) => {
        if (!confirm(`Delete skill "${name}"?`)) return;
        try {
            await apiDelete(`/skills/${encodeURIComponent(name)}`);
            if (selected?.name === name) setSelected(null);
            fetchSkills();
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to delete skill';
            setError(msg);
        }
    };

    // 组件挂载时自动加载技能列表
    useEffect(() => {
        fetchSkills();
    }, [fetchSkills]);

    return (
        <div className="p-6 h-full flex flex-col">
            {/* 全局错误提示横幅 */}
            {error && (
                <div
                    className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            <div className="flex-1 flex gap-4 min-h-0">
                {/* === 左侧：技能列表 === */}
                <div className="w-64 flex flex-col flex-shrink-0">
                    {/* 新建技能按钮 */}
                    <Button
                        onClick={() => {
                            setCreating(true);
                            setSelected(null);
                        }}
                        className="w-full mb-3"
                        size="sm"
                    >
                        <Plus className="h-4 w-4 mr-1"/>
                        New Skill
                    </Button>
                    {/* 技能列表：支持加载状态、空状态和正常列表 */}
                    <div className="flex-1 overflow-y-auto space-y-1">
                        {loading && (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}
                        {!loading && skills.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-8 gap-2">
                                <Zap className="h-8 w-8 text-muted-foreground/50"/>
                                <p className="text-xs text-muted-foreground">No skills yet</p>
                            </div>
                        )}
                        {skills.map((skill) => (
                            <div
                                key={skill.name}
                                onClick={() => selectSkill(skill.name)}
                                className={cn(
                                    'group flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors',
                                    selected?.name === skill.name
                                        ? 'bg-accent border border-primary/30'
                                        : 'hover:bg-accent/50 border border-transparent'
                                )}
                            >
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate">{skill.name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                                </div>
                                {/* 删除按钮：鼠标悬停时显示，阻止冒泡避免触发选中 */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSkill(skill.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                                    title="Delete"
                                >
                                    <Trash2 className="h-3.5 w-3.5"/>
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* === 右侧：内容区域（创建 / 查看 / 编辑 / 空状态） === */}
                <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* 创建新技能表单 */}
                    {creating && (
                        <div className="p-4 flex flex-col h-full">
                            <h3 className="text-sm font-medium mb-4">Create New Skill</h3>
                            <div className="space-y-3 flex-1 flex flex-col">
                                <Input
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    placeholder="Skill name"
                                />
                                <Input
                                    value={newDescription}
                                    onChange={(e) => setNewDescription(e.target.value)}
                                    placeholder="Description"
                                />
                                {/* Markdown 内容编辑区域，自适应填充剩余空间 */}
                                <textarea
                                    value={newContent}
                                    onChange={(e) => setNewContent(e.target.value)}
                                    placeholder="Skill content (markdown)"
                                    className="flex-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                                />
                                <div className="flex gap-2">
                                    <Button onClick={createSkill} size="sm">
                                        <Save className="h-4 w-4 mr-1"/>
                                        Create
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={() => setCreating(false)}>
                                        Cancel
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 查看或编辑已选中的技能 */}
                    {selected && !creating && (
                        <div className="flex flex-col h-full">
                            {/* 技能标题栏：显示名称和描述，提供编辑/保存/取消按钮 */}
                            <div className="flex items-center justify-between p-4 border-b border-border">
                                <div>
                                    <h3 className="text-sm font-medium">{selected.name}</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">{selected.description}</p>
                                </div>
                                <div className="flex gap-2">
                                    {editing ? (
                                        <>
                                            {/* 编辑模式：保存和取消 */}
                                            <Button size="sm" onClick={saveEdit}>
                                                <Save className="h-4 w-4 mr-1"/>
                                                Save
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                    setEditing(false);
                                                    setEditContent(selected.content);
                                                }}
                                            >
                                                <X className="h-4 w-4 mr-1"/>
                                                Cancel
                                            </Button>
                                        </>
                                    ) : (
                                        /* 查看模式：进入编辑 */
                                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                                            <Pencil className="h-4 w-4 mr-1"/>
                                            Edit
                                        </Button>
                                    )}
                                </div>
                            </div>
                            {/* 内容展示/编辑区域 */}
                            <div className="flex-1 overflow-hidden">
                                {editing ? (
                                    /* 编辑模式：可编辑的文本区域 */
                                    <textarea
                                        value={editContent}
                                        onChange={(e) => setEditContent(e.target.value)}
                                        className="w-full h-full bg-transparent px-4 py-3 text-sm font-mono resize-none focus:outline-none"
                                    />
                                ) : (
                                    /* 查看模式：只读的预格式化文本 */
                                    <pre
                                        className="w-full h-full overflow-y-auto px-4 py-3 text-sm text-muted-foreground font-mono whitespace-pre-wrap">
                    {selected.content}
                  </pre>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 未选中技能且未在创建时的空状态提示 */}
                    {!selected && !creating && (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3">
                            <FileCode className="h-10 w-10 text-muted-foreground/30"/>
                            <p className="text-sm text-muted-foreground">Select a skill or create a new one</p>
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
