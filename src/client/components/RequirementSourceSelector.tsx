/**
 * @file RequirementSourceSelector.tsx
 * @description 需求源选择器（agent 中介模式）
 *
 * 需求源 = 任意已配置的 MCP server：拉取由 AI 引擎动态面对 MCP 工具完成
 * （读 schema → 自主选择与调用），应用侧零源硬编码。本选择器只决定
 * 「限定挂载哪个 server」（收敛 agent 工具面），数据来自 GET /api/mcp-servers。
 *
 * 未配置任何 server 时提示前往 MCP 设置页添加（GitLab/Jira/任何 MCP 均可），
 * 无安装对话框——server 的增删改走 MCP 设置页统一管理。
 */

import {useEffect, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {apiGet} from '../api';

/** MCP server 注册条目（/api/mcp-servers，仅用 name/enabled） */
interface McpServerEntry {
    name: string;
    enabled?: boolean;
}

interface RequirementSourceSelectorProps {
    /** 当前选中的 server 名（空 = 未选择，agent 面向全部已启用 server） */
    value: string;
    /** 选中变更（参数为 server 名） */
    onChange: (serverName: string) => void;
    /** 透传给 select 的样式 */
    className?: string;
}

export function RequirementSourceSelector({value, onChange, className}: RequirementSourceSelectorProps) {
    const {t} = useTranslation();
    const [servers, setServers] = useState<McpServerEntry[]>([]);
    const [loaded, setLoaded] = useState(false);

    const loadServers = useCallback(() => {
        apiGet<McpServerEntry[]>('/mcp-servers')
            .then((list) => {
                setServers(list.filter(s => s.enabled !== false));
                setLoaded(true);
            })
            .catch(() => {
                setLoaded(true);
            });
    }, []);

    useEffect(() => {
        loadServers();
    }, [loadServers]);

    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={className ?? 'rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'}
            title={t('requirements.sourceSelector')}
        >
            <option value="">{t('requirements.sourceSelector')}</option>
            {servers.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
            ))}
            {loaded && servers.length === 0 && (
                <option value="" disabled>{t('requirements.sourceEmptyHint')}</option>
            )}
            {!loaded && <option value="" disabled>…</option>}
        </select>
    );
}
