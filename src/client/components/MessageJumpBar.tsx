/**
 * @file MessageJumpBar.tsx
 * @description 消息快速跳转栏 —— LogViewer 的用户消息锚点导航（悬浮竖条）。
 *
 *   形态：Portal 到 document.body 的 fixed 竖条，固定在「页面执行历史列表
 *   与主内容区的分界处」、垂直居中——不随日志滚动、也不随页面滚动移动，
 *   任何时刻都可点。（不能用 LogViewer 内的 absolute：页面滚动会把容器
 *   滚出视口；也不能在其内部用 fixed：glass-card 的 backdrop-filter 与
 *   framer-motion 的 transform 都会劫持 fixed 的定位基准，故必须 Portal）
 *
 *   交互：
 *     - 点击节点：平滑滚动定位到该消息（定位后目标消息闪烁高亮）
 *     - 滚动联动：当前视口所在段的节点放大高亮
 *     - 悬停预览：预览卡按节点实时坐标 fixed 定位（竖条容器 overflow 会
 *       裁剪 absolute 卡片，故不能挂在竖条内部）；同时回调 onHoverAnchor
 *       让日志区的目标消息同步高亮——不跳转也能确认要定位的是哪条
 *     - 节点全部平铺展示（会话内用户消息数量有限，不做内部滚动）
 */

import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {User} from 'lucide-react';
import {cn} from '../lib/utils';
import {useAppStore} from '../stores/app-store';

/** 跳转节点：一条用户消息的定位信息 */
export interface JumpAnchor {
    /** 在 LogViewer messages 数组中的原始下标（与 DOM data-jump-anchor 对应） */
    index: number;
    /** 消息内容（用于悬停摘要） */
    content: string;
    /** ISO 时间戳（可选，拼进摘要） */
    timestamp?: string;
}

interface MessageJumpBarProps {
    /** 用户消息锚点列表（按时间顺序） */
    anchors: JumpAnchor[];
    /** 当前高亮的锚点 index（可视区所在段） */
    activeIndex: number | null;
    /** 点击节点：滚动定位到对应消息 */
    onJump: (index: number) => void;
    /** 悬停节点（null = 离开）：供日志区同步高亮目标消息 */
    onHoverAnchor?: (index: number | null) => void;
}

/** 悬停预览的摘要长度上限 */
const PREVIEW_LIMIT = 120;

/** 去掉 Markdown 装饰符生成纯文本预览 */
function previewText(content: string): string {
    return content
        .replace(/[#*`>_~|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_LIMIT);
}

/** 悬停预览的实时坐标信息（fixed 定位需要节点在视口中的实际位置） */
interface HoverPreview {
    anchor: JumpAnchor;
    order: number;
    x: number;
    y: number;
}

export function MessageJumpBar({anchors, activeIndex, onJump, onHoverAnchor}: MessageJumpBarProps) {
    const [preview, setPreview] = useState<HoverPreview | null>(null);
    // 悬浮位置：应用侧边栏（52px 折叠 ↔ 220px 展开）+ 页面执行历史列表（w-64=256px，
    // 三页统一骨架）之后 12px —— 即历史列表与主内容区的分界处，不遮任何一侧
    const sidebarCollapsed = useAppStore((s) => s.ui.sidebarCollapsed);
    const railLeft = (sidebarCollapsed ? 52 : 220) + 256 + 12;

    // 卸载/空锚点时清掉日志区的高亮
    useEffect(() => {
        if (anchors.length === 0) onHoverAnchor?.(null);
    }, [anchors.length, onHoverAnchor]);

    if (anchors.length === 0) return null;

    /** 悬停节点：按节点实时视口坐标记录预览位置，并通知日志区高亮目标消息 */
    const handleNodeEnter = (event: React.MouseEvent<HTMLButtonElement>, anchor: JumpAnchor, order: number) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setPreview({anchor, order, x: rect.right + 12, y: rect.top - 6});
        onHoverAnchor?.(anchor.index);
    };

    const handleNodeLeave = () => {
        setPreview(null);
        onHoverAnchor?.(null);
    };

    // Portal 到 body：fixed 定位只认视口，不受任何祖先 transform/backdrop-filter 影响
    return createPortal(
        <>
            {/* 悬浮竖条：节点全部平铺（会话内用户消息有限，不做内部滚动） */}
            <div
                className="fixed top-1/2 -translate-y-1/2 z-40 flex rounded-full border border-border/50 bg-background/85 backdrop-blur-sm shadow-md px-0.5 py-2"
                style={{left: railLeft}}
            >
                <div className="flex flex-col items-center gap-1">
                    {/* 总数徽标 */}
                    <span
                        className="flex items-center gap-0.5 text-[9px] text-muted-foreground select-none shrink-0 pb-0.5 border-b border-border/40"
                        title={`共 ${anchors.length} 条用户消息`}
                    >
                        <User className="h-2 w-2"/>
                        {anchors.length > 99 ? '99+' : anchors.length}
                    </span>

                    {anchors.map((anchor, i) => {
                        const isActive = activeIndex === anchor.index;
                        return (
                            <div key={anchor.index} className="shrink-0" data-node-index={anchor.index}>
                                <button
                                    onClick={() => onJump(anchor.index)}
                                    onMouseEnter={(e) => handleNodeEnter(e, anchor, i)}
                                    onMouseLeave={handleNodeLeave}
                                    aria-label={`跳转到第 ${i + 1} 条用户消息`}
                                    className={cn(
                                        'flex items-center justify-center rounded-full text-[9px] font-mono transition-all',
                                        isActive
                                            ? 'h-5 w-5 bg-blue-500/25 text-blue-600 dark:text-blue-400 border border-blue-500/50 shadow-sm shadow-blue-500/20'
                                            : 'h-4 w-4 text-muted-foreground/70 border border-border/60 hover:h-5 hover:w-5 hover:bg-accent hover:text-foreground hover:border-border',
                                    )}
                                >
                                    {i + 1}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 悬停预览卡：按节点实时坐标 fixed 定位（挂在竖条 overflow 容器外，
                否则会被裁剪）；内容即目标消息，帮助确认是否跳转到这里 */}
            {preview && (
                <div
                    className="fixed z-50 w-56 max-w-[50vw] rounded-lg border border-border/70 bg-background shadow-lg p-2.5"
                    style={{left: preview.x, top: preview.y}}
                >
                    <div className="flex items-center gap-1.5 mb-1">
                        <span className="flex items-center gap-1 rounded px-1 py-px text-[9px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400">
                            <User className="h-2 w-2"/>
                            第 {preview.order + 1} 条
                        </span>
                        {preview.anchor.timestamp && (
                            <span className="text-[9px] text-muted-foreground">
                                {new Date(preview.anchor.timestamp).toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                    <p className="text-[11px] leading-relaxed text-foreground/90 break-words line-clamp-4">
                        {previewText(preview.anchor.content) || '（空消息）'}
                    </p>
                    <p className="mt-1 text-[9px] text-muted-foreground">点击定位到该消息</p>
                </div>
            )}
        </>,
        document.body,
    );
}
