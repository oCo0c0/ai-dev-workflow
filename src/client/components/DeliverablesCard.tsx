/**
 * @file DeliverablesCard.tsx
 * @description 「本次产出」卡片 —— 对齐 DeepSeek Harness ui-deliverables（ProducedFiles）设计：
 * 执行结束后在日志流结尾列出本次写类工具（Write/Edit/MultiEdit/NotebookEdit）产出/修改的文件。
 * 点击文件行经 onOpenFile 打开（页面可接侧边栏预览）；「在文件夹中显示」调
 * /workspace/reveal 在系统文件管理器中定位；另有复制路径辅助。
 *
 * 高度策略：本卡片与消息区是同一弹性列里的兄弟节点（`shrink-0`），
 * 早先按文件数自然伸展，文件一多就把消息区挤扁 —— 因此：
 * - **默认折叠**，只占一行（标题 + 文件数 + 首个文件摘要）
 * - 展开后列表**高度封顶内滚**（max-h-56），无论多少文件都不会继续挤压消息区
 */

import {useState} from 'react';
import {Check, ChevronDown, Copy, FileText, FolderOpen, Package} from 'lucide-react';
import {apiPost} from '../api';
import {cn} from '../lib/utils';
import type {DeliverableFile} from '../utils/agent-log-parse';

interface DeliverablesCardProps {
    files: DeliverableFile[];
    /** 点击文件行（页面接入侧边栏预览时提供） */
    onOpenFile?: (path: string) => void;
    /** 初始是否展开（默认折叠，避免挤占消息区；测试用） */
    initialExpanded?: boolean;
    className?: string;
}

/**
 * 「本次产出」卡片：文件清单 + 在文件夹中显示（可折叠；展开后高度封顶内滚）
 */
export function DeliverablesCard({files, onOpenFile, initialExpanded = false, className}: DeliverablesCardProps) {
    const [copiedPath, setCopiedPath] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);
    const [expanded, setExpanded] = useState(initialExpanded);

    if (files.length === 0) return null;

    const reveal = async (p: string) => {
        try {
            await apiPost('/workspace/reveal', {path: p});
            setRevealed(true);
            setTimeout(() => setRevealed(false), 1500);
        } catch { /* 文件夹打不开时静默（路径可能已失效） */ }
    };

    const copyPath = async (p: string) => {
        try {
            await navigator.clipboard.writeText(p);
            setCopiedPath(p);
            setTimeout(() => setCopiedPath(null), 1500);
        } catch { /* 剪贴板不可用时静默 */ }
    };

    const first = files[0];

    return (
        <div
            className={cn(
                'rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden',
                className,
            )}
            data-tour="deliverables"
        >
            {/* 标题行：整行可点击折叠/展开（右侧「在文件夹中显示」独立按钮） */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/20">
                <button
                    type="button"
                    onClick={() => setExpanded(v => !v)}
                    aria-expanded={expanded}
                    title={expanded ? '收起产出清单' : '展开产出清单'}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left rounded-md px-0.5 py-0.5 hover:bg-emerald-500/10 transition-colors"
                >
                    <Package className="h-3.5 w-3.5 shrink-0 text-emerald-500"/>
                    <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400">本次产出</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{files.length} 个文件</span>
                    {/* 折叠态：一行摘要（首个文件 + 其余数量），不展开也能看到改了哪个文件 */}
                    {!expanded && (
                        <span className="min-w-0 truncate text-[10px] font-mono text-muted-foreground/70">
                            {first.name}{first.dir ? ` (${first.dir}/)` : ''}
                            {files.length > 1 ? ` 等 ${files.length} 个` : ''}
                        </span>
                    )}
                    <ChevronDown
                        className={cn(
                            'ml-auto h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                            expanded && 'rotate-180',
                        )}
                    />
                </button>
                <button
                    type="button"
                    onClick={() => void reveal(files[0].path)}
                    className="shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    title="在文件管理器中显示"
                >
                    <FolderOpen className="h-3 w-3"/>
                    在文件夹中显示
                </button>
            </div>

            {/* 文件清单：展开态，高度封顶内滚（不随文件数挤占消息区） */}
            {expanded && (
                <div className="max-h-56 overflow-y-auto py-1" data-deliverables-list>
                    {files.map((f) => (
                        <div
                            key={f.path}
                            className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors"
                            data-deliverable-row
                        >
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground"/>
                            <button
                                type="button"
                                onClick={() => onOpenFile?.(f.path)}
                                className="min-w-0 flex-1 flex items-baseline gap-1.5 text-left"
                                title={f.path}
                            >
                                <span className="text-xs font-medium text-foreground/90 truncate">{f.name}</span>
                                {f.dir && (
                                    <span className="shrink-0 text-[10px] text-muted-foreground/60 truncate font-mono">
                                        {f.dir}/
                                    </span>
                                )}
                            </button>
                            {/* 行内操作：在文件夹中显示 / 复制路径 */}
                            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => void reveal(f.path)}
                                    title="在文件夹中显示"
                                    aria-label="在文件夹中显示"
                                    className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                >
                                    <FolderOpen className="h-3 w-3"/>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void copyPath(f.path)}
                                    title="复制路径"
                                    aria-label="复制路径"
                                    className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                                >
                                    {copiedPath === f.path
                                        ? <Check className="h-3 w-3 text-emerald-500"/>
                                        : <Copy className="h-3 w-3"/>}
                                </button>
                            </div>
                            {revealed && (
                                <span className="shrink-0 text-[10px] text-emerald-500 hidden group-hover:block">
                                    已定位
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
