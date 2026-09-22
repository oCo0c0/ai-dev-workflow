/**
 * @file DeliverablesCard.tsx
 * @description 「本次产出」卡片 —— 对齐 DeepSeek Harness ui-deliverables（ProducedFiles）设计：
 * 执行结束后在日志流结尾列出本次写类工具（Write/Edit/MultiEdit/NotebookEdit）产出/修改的文件。
 * 点击文件行经 onOpenFile 打开（页面可接侧边栏预览）；「在文件夹中显示」调
 * /workspace/reveal 在系统文件管理器中定位；另有复制路径辅助。
 */

import {useState} from 'react';
import {Check, Copy, FileText, FolderOpen, Package} from 'lucide-react';
import {apiPost} from '../api';
import {cn} from '../lib/utils';
import type {DeliverableFile} from '../utils/agent-log-parse';

interface DeliverablesCardProps {
    files: DeliverableFile[];
    /** 点击文件行（页面接入侧边栏预览时提供） */
    onOpenFile?: (path: string) => void;
    className?: string;
}

/**
 * 「本次产出」卡片：文件清单 + 在文件夹中显示
 */
export function DeliverablesCard({files, onOpenFile, className}: DeliverablesCardProps) {
    const [copiedPath, setCopiedPath] = useState<string | null>(null);
    const [revealed, setRevealed] = useState(false);

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

    return (
        <div
            className={cn(
                'rounded-lg border border-emerald-500/25 bg-emerald-500/5 overflow-hidden',
                className,
            )}
            data-tour="deliverables"
        >
            {/* 标题行 */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-emerald-500/20">
                <Package className="h-3.5 w-3.5 shrink-0 text-emerald-500"/>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">本次产出</span>
                <span className="text-[10px] text-muted-foreground">{files.length} 个文件</span>
                <button
                    type="button"
                    onClick={() => void reveal(files[0].path)}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    title="在文件管理器中显示"
                >
                    <FolderOpen className="h-3 w-3"/>
                    在文件夹中显示
                </button>
            </div>

            {/* 文件清单 */}
            <div className="py-1">
                {files.map((f) => (
                    <div
                        key={f.path}
                        className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 transition-colors"
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
        </div>
    );
}
