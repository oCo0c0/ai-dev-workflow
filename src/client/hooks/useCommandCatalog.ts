/**
 * @file useCommandCatalog.ts
 * @description 命令与技能目录（`GET /api/commands`）的前端缓存 hook。
 *
 * 对齐 DSH 的 `ui-commands.directory`：目录按需拉取一次并缓存（进程内），
 * 支持显式刷新；菜单以「命令 / 技能」两组渲染。
 */
import {useCallback, useEffect, useState} from 'react';
import {apiGet} from '../api';

/** 单个命令/技能条目（与服务端 CommandEntry 对齐） */
export interface CatalogEntry {
    name: string;
    description: string;
    argsHint?: string;
    kind: 'command' | 'skill';
    source: string;
}

/** 分组（与服务端 CommandGroup 对齐） */
export interface CatalogGroup {
    source: 'command' | 'skill';
    items: CatalogEntry[];
}

interface CatalogResponse {
    groups: CatalogGroup[];
    dirs?: {commands: string; skills: string};
}

/** 模块级缓存：一次会话只拉一次，刷新走 refresh() */
let cached: CatalogGroup[] | null = null;
let inflight: Promise<CatalogGroup[]> | null = null;

async function fetchCatalog(): Promise<CatalogGroup[]> {
    if (cached) return cached;
    if (!inflight) {
        inflight = apiGet<CatalogResponse>('/commands')
            .then((resp) => {
                cached = resp?.groups ?? [];
                return cached;
            })
            .catch(() => [] as CatalogGroup[])
            .finally(() => {
                inflight = null;
            });
    }
    return inflight;
}

/** 命令与技能目录 hook */
export function useCommandCatalog(): {
    groups: CatalogGroup[];
    loading: boolean;
    refresh: () => Promise<void>;
} {
    const [groups, setGroups] = useState<CatalogGroup[]>(cached ?? []);
    const [loading, setLoading] = useState(cached === null);

    const refresh = useCallback(async () => {
        cached = null;
        setLoading(true);
        const next = await fetchCatalog();
        setGroups(next);
        setLoading(false);
    }, []);

    useEffect(() => {
        let alive = true;
        if (cached) {
            setGroups(cached);
            setLoading(false);
            return () => {
                alive = false;
            };
        }
        void fetchCatalog().then((next) => {
            if (!alive) return;
            setGroups(next);
            setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, []);

    return {groups, loading, refresh};
}
