/**
 * @file 冲突解决弹窗
 * @description 全屏弹窗，左侧冲突文件列表 + 右侧 DiffView 展示冲突内容。
 *   提供 Abort Merge 按钮。
 */

import {useState, useEffect} from 'react';
import {apiGet, apiPost} from '../api';
import {X, AlertTriangle, Loader2, FileText} from 'lucide-react';
import {Button} from './ui/button';

interface ConflictResolutionModalProps {
    open: boolean;
    onClose: () => void;
    workspacePath: string;
    conflicts: string[];
    onResolved: () => void;
}

/** 冲突文件着色渲染（复用 WorkspacePage DiffView 风格） */
function ConflictContentView({content, filePath}: { content: string; filePath: string }) {
    if (!content) return <p className="text-sm text-muted-foreground p-4">Empty file</p>;

    const lines = content.split('\n');
    return (
        <div className="h-full overflow-auto">
            <div className="bg-[#1e1e1e] text-[#d4d4d4] text-xs font-mono min-h-full">
                <div className="px-3 py-1.5 bg-[#2d2d2d] text-[#569cd6] border-b border-[#3c3c3c] sticky top-0">
                    {filePath}
                </div>
                <pre className="p-0">
                    {lines.map((line, i) => {
                        let cls = 'text-[#d4d4d4]';
                        if (line.startsWith('<<<<<<<')) cls = 'bg-red-500/20 text-red-400';
                        else if (line.startsWith('>>>>>>>')) cls = 'bg-red-500/20 text-red-400';
                        else if (line.startsWith('=======')) cls = 'bg-amber-500/20 text-amber-400';
                        return (
                            <div key={i} className={`${cls} px-3 leading-5`}>
                                <span className="text-[#858585] inline-block w-8 text-right mr-3 select-none">{i + 1}</span>
                                {line}
                            </div>
                        );
                    })}
                </pre>
            </div>
        </div>
    );
}

export function ConflictResolutionModal({open, onClose, workspacePath, conflicts, onResolved}: ConflictResolutionModalProps) {
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [aborting, setAborting] = useState(false);

    // 自动选中第一个冲突文件
    useEffect(() => {
        if (conflicts.length > 0 && !selectedFile) {
            setSelectedFile(conflicts[0]);
        }
    }, [conflicts]);

    // 加载冲突文件内容
    useEffect(() => {
        if (!selectedFile) return;
        setLoading(true);
        apiGet<{ path: string; content: string }>(
            `/workspace/git/conflict-diff?workspacePath=${encodeURIComponent(workspacePath)}&file=${encodeURIComponent(selectedFile)}`
        ).then(data => setFileContent(data.content)).catch(() => setFileContent('')).finally(() => setLoading(false));
    }, [selectedFile, workspacePath]);

    const handleAbort = async () => {
        setAborting(true);
        try {
            await apiPost('/workspace/git/stash', {workspacePath, message: 'abort-merge-stash'});
            onResolved();
        } catch {
            onClose();
        } finally {
            setAborting(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose}/>
            <div className="relative z-10 w-full max-w-5xl mx-4 bg-background border border-border rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-500"/>
                        <span className="text-sm font-medium">Merge Conflicts</span>
                        <span className="text-xs text-muted-foreground">({conflicts.length} files)</span>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground">
                        <X className="h-4 w-4"/>
                    </button>
                </div>

                {/* Body: 左侧文件列表 + 右侧内容 */}
                <div className="flex flex-1 min-h-0">
                    {/* 左侧冲突文件列表 */}
                    <div className="w-56 border-r border-border overflow-y-auto">
                        <div className="px-3 py-2 border-b border-border/50">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Conflicting Files</p>
                        </div>
                        {conflicts.map(f => (
                            <button
                                key={f}
                                onClick={() => setSelectedFile(f)}
                                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
                                    selectedFile === f ? 'bg-primary/5 text-primary' : 'hover:bg-accent text-foreground/80'
                                }`}
                            >
                                <FileText className="h-3 w-3 shrink-0"/>
                                <span className="truncate">{f}</span>
                            </button>
                        ))}
                    </div>

                    {/* 右侧冲突内容 */}
                    <div className="flex-1 min-w-0">
                        {loading ? (
                            <div className="flex items-center justify-center h-full">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        ) : selectedFile ? (
                            <ConflictContentView content={fileContent} filePath={selectedFile}/>
                        ) : (
                            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                                Select a file to view conflicts
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-border">
                    <p className="text-xs text-muted-foreground">
                        Resolve conflicts manually in your editor, then commit.
                    </p>
                    <Button size="sm" variant="outline" onClick={handleAbort} disabled={aborting}>
                        {aborting ? <Loader2 className="h-3 w-3 animate-spin mr-1.5"/> : null}
                        Abort Merge
                    </Button>
                </div>
            </div>
        </div>
    );
}
