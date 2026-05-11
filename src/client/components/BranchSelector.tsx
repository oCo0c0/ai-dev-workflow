/**
 * @file 分支选择器组件
 * @description 内联下拉组件，展示分支列表并支持切换。
 *   冲突时显示处理面板（Stash / Discard / Merge）。
 */

import {useState, useEffect, useRef} from 'react';
import {apiGet, apiPost} from '../api';
import {GitBranch, ChevronDown, Loader2, Archive, Trash2, GitMerge, X, AlertTriangle} from 'lucide-react';
import {Button} from './ui/button';

interface BranchItem {
    name: string;
    current: boolean;
}

interface BranchSelectorProps {
    workspacePath: string;
    currentBranch: string;
    onBranchChange: () => void;
}

/** 冲突处理状态 */
interface ConflictState {
    targetBranch: string;
    conflicts: string[];
    message: string;
}

export function BranchSelector({workspacePath, currentBranch, onBranchChange}: BranchSelectorProps) {
    const [branches, setBranches] = useState<BranchItem[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conflict, setConflict] = useState<ConflictState | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // 加载分支列表
    const loadBranches = async () => {
        setLoading(true);
        try {
            const result = await apiGet<{ branches: BranchItem[]; current: string }>(
                `/workspace/git/branches?workspacePath=${encodeURIComponent(workspacePath)}`
            );
            setBranches(result.branches);
        } catch {
            // 静默失败
        } finally {
            setLoading(false);
        }
    };

    // 打开下拉
    const handleToggle = () => {
        if (!open) loadBranches();
        setOpen(!open);
        setError(null);
        setConflict(null);
    };

    // 切换分支
    const handleCheckout = async (branch: string) => {
        setSwitching(true);
        setError(null);
        try {
            const result = await apiPost<{ success: boolean; branch: string; conflicts?: string[]; message?: string }>(
                '/workspace/git/checkout', {workspacePath, branch}
            );
            if (result.success) {
                setOpen(false);
                onBranchChange();
            } else if (result.conflicts && result.conflicts.length > 0) {
                setConflict({
                    targetBranch: branch,
                    conflicts: result.conflicts,
                    message: result.message || 'Local changes would be overwritten',
                });
            } else {
                setError(result.message || 'Switch failed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Switch failed');
        } finally {
            setSwitching(false);
        }
    };

    // === 冲突处理操作 ===

    const handleStashAndSwitch = async () => {
        if (!conflict) return;
        setSwitching(true);
        try {
            const stashResult = await apiPost<{ success: boolean }>('/workspace/git/stash', {
                workspacePath, message: `auto-stash before switching to ${conflict.targetBranch}`
            });
            if (!stashResult.success) {
                setError('Stash failed');
                return;
            }
            const checkoutResult = await apiPost<{ success: boolean }>('/workspace/git/checkout', {
                workspacePath, branch: conflict.targetBranch
            });
            if (checkoutResult.success) {
                setOpen(false);
                setConflict(null);
                onBranchChange();
            } else {
                setError('Checkout after stash failed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Operation failed');
        } finally {
            setSwitching(false);
        }
    };

    const handleForceCheckout = async () => {
        if (!conflict) return;
        setSwitching(true);
        try {
            const result = await apiPost<{ success: boolean }>('/workspace/git/checkout-force', {
                workspacePath, branch: conflict.targetBranch
            });
            if (result.success) {
                setOpen(false);
                setConflict(null);
                onBranchChange();
            } else {
                setError('Force checkout failed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Operation failed');
        } finally {
            setSwitching(false);
        }
    };

    const handleMerge = async () => {
        if (!conflict) return;
        setSwitching(true);
        try {
            // 先 checkout 到目标分支，再 merge 当前分支
            const checkoutResult = await apiPost<{ success: boolean }>('/workspace/git/checkout-force', {
                workspacePath, branch: conflict.targetBranch
            });
            if (!checkoutResult.success) {
                setError('Checkout failed');
                return;
            }
            const mergeResult = await apiPost<{ success: boolean; conflicts?: string[]; message?: string }>(
                '/workspace/git/merge', {workspacePath, sourceBranch: currentBranch}
            );
            onBranchChange();
            if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
                // merge 冲突，关闭当前下拉，由父组件处理
                setOpen(false);
                setConflict(null);
            } else {
                setOpen(false);
                setConflict(null);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Merge failed');
        } finally {
            setSwitching(false);
        }
    };

    return (
        <div ref={containerRef} className="relative">
            {/* 触发器 */}
            <button
                onClick={handleToggle}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
                <GitBranch className="h-3 w-3"/>
                <span className="truncate font-mono max-w-[120px]">{currentBranch}</span>
                {loading ? <Loader2 className="h-3 w-3 animate-spin"/> : <ChevronDown className="h-3 w-3"/>}
            </button>

            {/* 下拉面板 */}
            {open && (
                <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-background border border-border rounded-lg shadow-xl">
                    {conflict ? (
                        /* 冲突处理面板 */
                        <div className="p-3">
                            <div className="flex items-center gap-2 mb-2 text-amber-500">
                                <AlertTriangle className="h-4 w-4 shrink-0"/>
                                <span className="text-xs font-medium">Conflict detected</span>
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">
                                Switch to <code className="bg-muted px-1 rounded">{conflict.targetBranch}</code>
                            </p>
                            <p className="text-xs text-muted-foreground/70 mb-3">{conflict.message}</p>
                            <div className="space-y-1.5">
                                <Button size="sm" variant="outline" className="w-full justify-start text-xs h-7"
                                        onClick={handleStashAndSwitch} disabled={switching}>
                                    <Archive className="h-3 w-3 mr-2"/>
                                    Stash & Switch
                                </Button>
                                <Button size="sm" variant="outline" className="w-full justify-start text-xs h-7"
                                        onClick={handleForceCheckout} disabled={switching}>
                                    <Trash2 className="h-3 w-3 mr-2 text-red-400"/>
                                    Discard & Switch
                                </Button>
                                <Button size="sm" variant="outline" className="w-full justify-start text-xs h-7"
                                        onClick={handleMerge} disabled={switching}>
                                    <GitMerge className="h-3 w-3 mr-2 text-blue-400"/>
                                    Merge to Target
                                </Button>
                            </div>
                            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                            <Button size="sm" variant="ghost" className="mt-2 w-full text-xs h-6"
                                    onClick={() => { setConflict(null); setError(null); }}>
                                Back to branch list
                            </Button>
                        </div>
                    ) : (
                        /* 分支列表 */
                        <div className="py-1 max-h-64 overflow-y-auto">
                            {loading ? (
                                <div className="flex justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/>
                                </div>
                            ) : branches.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-4">No branches</p>
                            ) : (
                                branches.map(b => (
                                    <button
                                        key={b.name}
                                        onClick={() => !b.current && handleCheckout(b.name)}
                                        disabled={b.current || switching}
                                        className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                                            b.current
                                                ? 'bg-primary/5 text-primary font-medium'
                                                : 'hover:bg-accent text-foreground/80'
                                        } ${switching ? 'opacity-50' : ''}`}
                                    >
                                        <GitBranch className="h-3 w-3 shrink-0"/>
                                        <span className="truncate">{b.name}</span>
                                        {b.current && (
                                            <span className="ml-auto text-[10px] bg-primary/10 px-1.5 py-0.5 rounded">current</span>
                                        )}
                                    </button>
                                ))
                            )}
                            {switching && (
                                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                                    <Loader2 className="h-3 w-3 animate-spin"/> Switching...
                                </div>
                            )}
                            {error && <p className="px-3 py-2 text-xs text-destructive">{error}</p>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
