/**
 * @file agent-workspace-groups.ts
 * @description 执行历史按工作空间（项目）分组 —— Agent 执行页左侧列表的数据派生（纯函数）。
 *
 *   关键语义：**已保存但还没有执行记录的工作空间也要成组列出**。
 *   列表此前只遍历执行记录，导致「添加工作空间」选中新文件夹后界面没有任何变化
 *   （保存成功、但没有任何执行记录 → 派生不出分组）。空组置顶，便于刚添加后立即使用。
 */

/** 执行记录的最小形状（AgentExecutionSummary 的子集） */
export interface HistoryItemLike {
    workspacePath?: string;
    createdAt: string;
}

/** 已保存工作区的最小形状 */
export interface SavedWorkspaceLike {
    path: string;
    name?: string;
}

/** 分组结果 */
export interface WorkspaceGroup<T> {
    label: string;
    /** 未指定工作空间的兜底组无 path */
    path?: string;
    items: T[];
}

/** 路径末段（无分隔符时返回原串） */
function basename(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/**
 * 执行历史 + 已保存工作区 → 左侧列表分组。
 * - 组名优先用已保存工作区的名称，否则取目录名
 * - 已有执行的组按最近一条执行时间倒序；无执行的已保存工作空间（空组）置顶
 */
export function groupExecutionsByWorkspace<T extends HistoryItemLike>(
    history: T[],
    saved: SavedWorkspaceLike[],
): Array<WorkspaceGroup<T>> {
    const groups = new Map<string, WorkspaceGroup<T>>();

    const labelFor = (path: string): string => {
        const matched = saved.find((ws) => ws.path === path);
        return matched?.name || basename(path);
    };

    for (const exec of history) {
        const key = exec.workspacePath || '__none__';
        const existing = groups.get(key);
        if (existing) {
            existing.items.push(exec);
            continue;
        }
        groups.set(key, {
            label: exec.workspacePath ? labelFor(exec.workspacePath) : '未指定工作空间',
            path: exec.workspacePath,
            items: [exec],
        });
    }

    // 补上尚无执行记录的已保存工作空间（空组：可见、可就近新建执行）
    for (const ws of saved) {
        if (!ws?.path || groups.has(ws.path)) continue;
        groups.set(ws.path, {label: ws.name || basename(ws.path), path: ws.path, items: []});
    }

    const all = [...groups.values()];
    const sortKey = (g: WorkspaceGroup<T>): number => (g.items.length > 0
        ? new Date(g.items[0].createdAt).getTime()
        : Number.POSITIVE_INFINITY); // 空组置顶
    return all.sort((a, b) => sortKey(b) - sortKey(a));
}
