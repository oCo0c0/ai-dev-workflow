/**
 * @file SlashMenu.tsx
 * @description 斜杠命令菜单 —— `/` 触发的候选浮层（分组：命令 / 技能）。
 *
 * 对齐 DSH 的 MenuView 交互：分组平铺、键盘上下移动高亮、Enter 选中、
 * 用 onMouseDown + preventDefault 拾取（不抢 textarea 焦点）、
 * 每组显示条目数与参数提示。
 */

import {useEffect, useRef} from 'react';
import {useTranslation} from 'react-i18next';
import {Terminal, Sparkles, ArrowRight} from 'lucide-react';
import {cn} from '../../lib/utils';
import type {CatalogEntry, CatalogGroup} from '../../hooks/useCommandCatalog';

export interface SlashMenuProps {
    /** 过滤后的分组（空组不渲染） */
    groups: Array<{source: 'command' | 'skill'; items: CatalogEntry[]}>;
    /** 当前高亮项的扁平下标 */
    activeIndex: number;
    /** 悬停/键盘变更高亮 */
    onActiveIndexChange: (index: number) => void;
    /** 选中某项 */
    onPick: (entry: CatalogEntry) => void;
    /** 当前查询（用于标题提示） */
    query: string;
}

/** 扁平化分组顺序（与键盘导航一致） */
export function flattenEntries(groups: SlashMenuProps['groups']): CatalogEntry[] {
    return groups.flatMap(g => g.items);
}

export function SlashMenu({groups, activeIndex, onActiveIndexChange, onPick, query}: SlashMenuProps) {
    const {t} = useTranslation();
    const listRef = useRef<HTMLDivElement>(null);
    const flat = flattenEntries(groups);

    // 高亮项滚动进视野
    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-slash-index="${activeIndex}"]`);
        el?.scrollIntoView({block: 'nearest'});
    }, [activeIndex]);

    if (flat.length === 0) return null;

    let cursor = -1;
    return (
        <div
            ref={listRef}
            role="listbox"
            aria-label={t('common.chatInput.slashMenu', {defaultValue: '命令与技能'})}
            className="absolute bottom-full mb-2 left-0 right-0 z-[600] max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-apple-lg"
        >
            {groups.map((group) => (
                <div key={group.source}>
                    <p className="px-2 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {group.source === 'command'
                            ? t('common.chatInput.slashCommands', {defaultValue: '命令'})
                            : t('common.chatInput.slashSkills', {defaultValue: '技能'})}
                        <span className="ml-1 opacity-60">{group.items.length}</span>
                    </p>
                    {group.items.map((item) => {
                        cursor += 1;
                        const index = cursor;
                        const active = index === activeIndex;
                        const Icon = group.source === 'command' ? Terminal : Sparkles;
                        return (
                            <button
                                key={`${group.source}-${item.name}`}
                                type="button"
                                role="option"
                                aria-selected={active}
                                data-slash-index={index}
                                onMouseDown={(e) => {
                                    e.preventDefault(); // 不抢 textarea 焦点
                                    onPick(item);
                                }}
                                onMouseEnter={() => onActiveIndexChange(index)}
                                className={cn(
                                    'w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                                    active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60',
                                )}
                            >
                                <Icon className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/70')}/>
                                <span className="shrink-0 font-mono text-xs">/{item.name}</span>
                                {item.argsHint && (
                                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{item.argsHint}</span>
                                )}
                                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/80">
                                    {item.description}
                                </span>
                                {active && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground"/>}
                            </button>
                        );
                    })}
                </div>
            ))}
            <p className="px-2 pt-1 pb-0.5 text-[10px] text-muted-foreground/60">
                {query
                    ? t('common.chatInput.slashFiltered', {defaultValue: '↑↓ 选择 · Enter 插入 · Esc 关闭'})
                    : t('common.chatInput.slashHint', {defaultValue: '↑↓ 选择 · Enter 插入 · Esc 关闭'})}
            </p>
        </div>
    );
}
