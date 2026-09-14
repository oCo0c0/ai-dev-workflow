/**
 * @file PermissionPicker.tsx
 * @description 输入框工具栏的权限模式三档选择器（confirm 询问确认 / acceptEdits 自动接受编辑 /
 *   bypassPermissions 完全放行）。仅 claude / pi 引擎支持权限体系；codex 与 custom 引擎置灰提示。
 *   选择经 store 的 setPermissionMode 乐观更新并持久化，失败时 store 回滚、弹层内展示错误。
 */

import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {AnimatePresence, motion} from 'framer-motion';
import {FileCheck, Hand, Loader2, ShieldCheck, Zap} from 'lucide-react';
import {cn} from '../../lib/utils';
import {useAppStore} from '../../stores/app-store';

type PermissionMode = 'confirm' | 'acceptEdits' | 'bypassPermissions';

const PERMISSION_OPTIONS = [
    {value: 'confirm', labelKey: 'common.chatInput.permConfirm', descKey: 'common.chatInput.permConfirmDesc', icon: Hand},
    {value: 'acceptEdits', labelKey: 'common.chatInput.permAcceptEdits', descKey: 'common.chatInput.permAcceptEditsDesc', icon: FileCheck},
    {value: 'bypassPermissions', labelKey: 'common.chatInput.permBypass', descKey: 'common.chatInput.permBypassDesc', icon: Zap},
] as const satisfies ReadonlyArray<{value: PermissionMode; labelKey: string; descKey: string; icon: typeof Hand}>;

export function PermissionPicker() {
    const {t} = useTranslation();
    const mode = useAppStore(s => s.cliProvider.permissionMode);
    const setPermissionMode = useAppStore(s => s.setPermissionMode);
    const active = useAppStore(s => s.cliProvider.active);

    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // 点击外部关闭（镜像 Layout 主题菜单的 ref + mousedown 模式）
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // codex 与 custom 引擎不支持权限体系 → 置灰
    const supported = active === 'claude' || active === 'pi';
    const current = PERMISSION_OPTIONS.find(o => o.value === mode);

    /** 选择权限档位：store 内部乐观更新并持久化，失败时回滚并抛错 —— 弹层保持打开展示错误 */
    const handleSelect = async (value: PermissionMode) => {
        if (saving || value === mode) return;
        setError(null);
        setSaving(true);
        try {
            await setPermissionMode(value);
            setOpen(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                disabled={!supported}
                onClick={() => setOpen(!open)}
                title={supported ? t('common.chatInput.permission') : t('common.chatInput.permUnsupported')}
                aria-label={supported ? t('common.chatInput.permission') : t('common.chatInput.permUnsupported')}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-popover/60 px-2 text-[11px]
                    font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors
                    disabled:opacity-40 disabled:pointer-events-none"
            >
                {saving
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin"/>
                    : <ShieldCheck className="h-3.5 w-3.5"/>}
                <span className="hidden sm:inline">
                    {supported
                        ? (current ? t(current.labelKey) : t('common.chatInput.permission'))
                        : t('common.chatInput.permUnsupportedShort')}
                </span>
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
                            {t('common.chatInput.permission')}
                        </p>
                        {PERMISSION_OPTIONS.map(opt => {
                            const Icon = opt.icon;
                            const selected = opt.value === mode;
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    disabled={saving}
                                    onClick={() => void handleSelect(opt.value)}
                                    className={cn(
                                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-50',
                                        selected
                                            ? 'bg-accent text-foreground'
                                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                                    )}
                                >
                                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0"/>
                                    <span className="min-w-0">
                                        <span className={cn('block text-xs', selected && 'font-medium')}>{t(opt.labelKey)}</span>
                                        <span className="block text-[10px] leading-snug text-muted-foreground/80">{t(opt.descKey)}</span>
                                    </span>
                                </button>
                            );
                        })}
                        {error && <p className="px-2 py-1 text-[11px] text-destructive">{error}</p>}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
