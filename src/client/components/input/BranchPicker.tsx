/**
 * @file BranchPicker.tsx
 * @description 输入框工具栏的 git 分支选择器（弹层交互镜像 ModelPicker：点击外部关闭、向上弹出）。
 *   - 按钮常显当前分支名；workspacePath 变化时拉取本地分支列表，请求失败（非 git 目录等）时整个组件隐藏；
 *   - 弹层列出全部本地分支，当前分支 Check 高亮；点击其他分支执行切换流程（切换中 busy 禁用列表）：
 *       1. GET git/status 无未提交改动 → 直接 POST git/checkout；
 *       2. 有改动 → confirm 询问（按改动数）→ POST git/stash（success:false 时提示并中止）→ POST git/checkout；
 *       3. checkout success:false → 弹层内红字展示 message（有 conflicts 一并截断列出）；
 *       成功后刷新分支列表并关闭弹层。
 *   - 错误红字保留到下次操作或关闭弹层；disabled 时按钮置灰并 title 提示（任务运行中禁止切换）。
 */

import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AnimatePresence, motion} from 'framer-motion';
import {Check, ChevronDown, GitBranch, Loader2} from 'lucide-react';
import {apiGet, apiPost} from '../../api';
import {cn} from '../../lib/utils';

/** GET /workspace/git/branches 响应（仅本地分支） */
interface GitBranchesResponse {
    branches: Array<{name: string; current: boolean}>;
    current: string;
}

/** GET /workspace/git/status 响应（changes 非空即有未提交改动） */
interface GitStatusResponse {
    isGit: boolean;
    branch: string;
    changes: Array<{path: string; status: string; staged: boolean}>;
}

/** POST /workspace/git/checkout 响应（success:false 时附 message / conflicts） */
interface CheckoutResponse {
    success: boolean;
    branch?: string;
    conflicts?: string[];
    message?: string;
}

/** 弹层内错误（保留到下次操作或关闭弹层） */
interface PickerError {
    message: string;
    conflicts?: string[];
}

interface BranchPickerProps {
    /** 目标工作区路径；为空或非 git 目录（加载失败）时组件整体隐藏 */
    workspacePath?: string;
    /** 置灰并禁止打开/切换（如任务运行中） */
    disabled?: boolean;
}

export function BranchPicker({workspacePath, disabled}: BranchPickerProps) {
    const {t} = useTranslation();
    const [data, setData] = useState<GitBranchesResponse | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [open, setOpen] = useState(false);
    const [switching, setSwitching] = useState(false);
    const [error, setError] = useState<PickerError | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // workspacePath 变化（或首次挂载）时拉取本地分支；失败（非 git 目录等）时隐藏组件
    useEffect(() => {
        if (!workspacePath) {
            setData(null);
            setLoadFailed(false);
            setOpen(false);
            return;
        }
        let cancelled = false;
        setData(null);
        setLoadFailed(false);
        setOpen(false);
        setError(null);
        apiGet<GitBranchesResponse>(`/workspace/git/branches?workspacePath=${encodeURIComponent(workspacePath)}`)
            .then((res) => {
                if (!cancelled) setData(res);
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [workspacePath]);

    // 点击外部关闭（镜像 ModelPicker 的 ref + mousedown 模式）
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    /** 刷新分支列表（切换成功后调用；失败保留旧列表不打断弹层） */
    const loadBranches = async () => {
        if (!workspacePath) return;
        try {
            const res = await apiGet<GitBranchesResponse>(
                `/workspace/git/branches?workspacePath=${encodeURIComponent(workspacePath)}`);
            setData(res);
        } catch {
            // 静默：保留旧数据
        }
    };

    /**
     * 切换分支：
     *   先查 status，有未提交改动时 confirm 询问，确认后 stash（失败提示并中止）再 checkout；
     *   checkout 失败在弹层内红字提示（conflicts 截断列出），成功刷新列表并关闭弹层。
     */
    const switchBranch = async (target: string) => {
        if (!workspacePath || !data || switching || target === data.current) return;
        setSwitching(true);
        setError(null);
        try {
            const status = await apiGet<GitStatusResponse>(
                `/workspace/git/status?workspacePath=${encodeURIComponent(workspacePath)}`);
            const changeCount = status.changes?.length ?? 0;
            if (changeCount > 0) {
                const confirmed = window.confirm(
                    t('common.chatInput.branchDirtyConfirm', {count: changeCount}));
                if (!confirmed) return;
                const stashResult = await apiPost<{success: boolean; message?: string}>('/workspace/git/stash', {
                    workspacePath,
                    message: `switch-branch: ${data.current} → ${target}`,
                });
                // 后端约定：stash 失败不抛错，返回 success:false
                if (stashResult.success === false) {
                    setError({message: t('common.chatInput.branchStashFailed')});
                    return;
                }
            }
            const result = await apiPost<CheckoutResponse>('/workspace/git/checkout', {
                workspacePath,
                branch: target,
            });
            if (result.success === false) {
                setError({
                    message: result.message || t('common.chatInput.branchSwitchFailed'),
                    conflicts: result.conflicts,
                });
                return;
            }
            await loadBranches();
            setOpen(false);
        } catch (err) {
            setError({
                message: err instanceof Error ? err.message : t('common.chatInput.branchSwitchFailed'),
            });
        } finally {
            setSwitching(false);
        }
    };

    if (!workspacePath || loadFailed || !data) return null;

    const current = data.current || data.branches.find(b => b.current)?.name || '';

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => {
                    setError(null);
                    setOpen(o => !o);
                }}
                disabled={disabled}
                title={disabled ? t('common.chatInput.branchDisabled') : current}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-popover/60 px-2 text-[11px]
                    font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors max-w-44
                    disabled:opacity-50"
            >
                <GitBranch className="h-3.5 w-3.5 shrink-0"/>
                <span className="truncate">{current || '—'}</span>
                <ChevronDown className="h-3 w-3 shrink-0"/>
            </button>
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{opacity: 0, y: 4}}
                        animate={{opacity: 1, y: 0}}
                        exit={{opacity: 0, y: 4}}
                        transition={{duration: 0.15}}
                        className="absolute bottom-full mb-2 left-0 z-[500] w-64 rounded-lg border border-border bg-popover p-1 shadow-apple-lg"
                    >
                        <p className="px-2 pt-1 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {t('common.chatInput.branch')}
                        </p>
                        <div className="max-h-56 overflow-y-auto">
                            {data.branches.map(b => (
                                <button
                                    key={b.name}
                                    type="button"
                                    onClick={() => void switchBranch(b.name)}
                                    disabled={switching}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors disabled:opacity-50',
                                        b.current
                                            ? 'bg-accent text-foreground font-medium'
                                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                    )}
                                >
                                    {b.current ? <Check className="h-3.5 w-3.5"/> : <span className="w-3.5"/>}
                                    <span className="truncate">{b.name}</span>
                                </button>
                            ))}
                        </div>
                        {switching && (
                            <p className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] text-muted-foreground">
                                <Loader2 className="h-3 w-3 shrink-0 animate-spin"/>
                                {t('common.chatInput.branchSwitching')}
                            </p>
                        )}
                        {/* 错误红字：保留到下次操作或关闭弹层 */}
                        {error && (
                            <div className="mt-1 border-t border-border/60 px-2 pt-1.5 pb-1 text-[11px] text-destructive">
                                <p className="break-all">{error.message}</p>
                                {!!error.conflicts?.length && (
                                    <ul className="mt-1 space-y-0.5">
                                        {error.conflicts.slice(0, 5).map(c => (
                                            <li key={c} className="truncate font-mono text-[10px] opacity-90" title={c}>{c}</li>
                                        ))}
                                        {error.conflicts.length > 5 && (
                                            <li className="text-[10px] opacity-70">…(+{error.conflicts.length - 5})</li>
                                        )}
                                    </ul>
                                )}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
