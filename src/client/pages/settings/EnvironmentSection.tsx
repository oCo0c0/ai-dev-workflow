/**
 * @file EnvironmentSection.tsx
 * @description 设置中心「环境体检」分区 —— AI 引擎与基础工具的就绪检测
 *
 * 面向「分发到别人电脑」的场景：裸机安装后一眼看清缺什么、去哪装。
 * - AI 执行引擎（三选一）：claude / codex / pi —— 任一可用即启用执行链路；
 * - 基础工具：node（MCP npx 服务器）/ git（工作区版本管理）；
 * - 检测事实来自 GET /api/system/env-check（服务端 spawn --version），
 *   标签/用途/安装指引由本组件 i18n 映射（服务端保持语言中立）。
 */
import {useCallback, useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CheckCircle2, CircleAlert, ExternalLink, RefreshCw} from 'lucide-react';
import {cn} from '../../lib/utils';
import {apiGet} from '../../api';
import {Card, CardContent} from '../../components/ui/card';

/** 检测项定义（id 对应服务端 checks 键） */
interface CheckDef {
    id: 'claude' | 'codex' | 'pi' | 'node' | 'git';
    group: 'engine' | 'base';
    labelKey: string;
    purposeKey: string;
    guide: string;
}

const CHECK_DEFS: CheckDef[] = [
    {id: 'claude', group: 'engine', labelKey: 'settings.env.claude', purposeKey: 'settings.env.purposeClaude', guide: 'https://docs.anthropic.com/en/docs/claude-code/overview'},
    {id: 'codex', group: 'engine', labelKey: 'settings.env.codex', purposeKey: 'settings.env.purposeCodex', guide: 'https://developers.openai.com/codex/cli/'},
    {id: 'pi', group: 'engine', labelKey: 'settings.env.pi', purposeKey: 'settings.env.purposePi', guide: 'https://github.com/earendil-works/pi-coding-agent'},
    {id: 'node', group: 'base', labelKey: 'settings.env.node', purposeKey: 'settings.env.purposeNode', guide: 'https://nodejs.org/zh-cn/download'},
    {id: 'git', group: 'base', labelKey: 'settings.env.git', purposeKey: 'settings.env.purposeGit', guide: 'https://git-scm.com/downloads'},
];

type CheckResult = {installed: boolean; version: string};
type EnvCheckResponse = {platform: string; checks: Record<string, CheckResult>};

/** 状态行：已装（绿 + 版本）/ 未装（灰 + 安装指南链接） */
function CheckRow({def, result}: {def: CheckDef; result: CheckResult | undefined}) {
    const {t} = useTranslation();
    const installed = result?.installed === true;
    return (
        <div className="flex items-center justify-between gap-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
                {installed
                    ? <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-500"/>
                    : <CircleAlert className="h-4.5 w-4.5 shrink-0 text-muted-foreground/50"/>}
                <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                        {t(def.labelKey)}
                        {installed && result?.version && (
                            <span className="truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                                {result.version}
                            </span>
                        )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t(def.purposeKey)}</p>
                </div>
            </div>
            {installed ? (
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    {t('settings.env.installed')}
                </span>
            ) : (
                <a
                    href={def.guide}
                    target="_blank"
                    rel="noreferrer"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-border/60 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                    {t('settings.env.installGuide')}
                    <ExternalLink className="h-3 w-3"/>
                </a>
            )}
        </div>
    );
}

/**
 * 环境体检分区
 */
export function EnvironmentSection() {
    const {t} = useTranslation();
    const [data, setData] = useState<EnvCheckResponse | null>(null);
    const [checking, setChecking] = useState(false);

    const run = useCallback(async () => {
        setChecking(true);
        try {
            setData(await apiGet<EnvCheckResponse>('/system/env-check'));
        } catch { /* 检测失败保留上次结果 */ }
        setChecking(false);
    }, []);

    // 挂载自动检测一次
    useEffect(() => {
        void run();
    }, [run]);

    const engineReady = CHECK_DEFS
        .filter(d => d.group === 'engine')
        .filter(d => data?.checks[d.id]?.installed)
        .map(d => t(d.labelKey));

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl space-y-4">
                {/* 总览横幅 */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold">{t('settings.env.title')}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{t('settings.env.subtitle')}</p>
                            </div>
                            <button
                                type="button"
                                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50"
                                onClick={() => void run()}
                                disabled={checking}
                            >
                                <RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')}/>
                                {checking ? t('settings.env.checking') : t('settings.env.recheck')}
                            </button>
                        </div>
                        <div className={cn(
                            'mt-4 rounded-xl px-4 py-3 text-sm font-medium',
                            engineReady.length > 0
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        )}>
                            {engineReady.length > 0
                                ? t('settings.env.ready', {names: engineReady.join(' / ')})
                                : t('settings.env.notReady')}
                        </div>
                        {engineReady.length === 0 && (
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                {t('settings.env.notReadyHint')}
                            </p>
                        )}
                    </CardContent>
                </Card>

                {/* AI 执行引擎（三选一） */}
                <Card>
                    <CardContent className="pt-6">
                        <p className="mb-1 text-sm font-semibold">{t('settings.env.engineTitle')}</p>
                        <p className="mb-2 text-xs text-muted-foreground">{t('settings.env.engineHint')}</p>
                        <div className="divide-y divide-border/40">
                            {CHECK_DEFS.filter(d => d.group === 'engine').map(def => (
                                <CheckRow key={def.id} def={def} result={data?.checks[def.id]}/>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* 基础工具 */}
                <Card>
                    <CardContent className="pt-6">
                        <p className="mb-1 text-sm font-semibold">{t('settings.env.baseTitle')}</p>
                        <p className="mb-2 text-xs text-muted-foreground">{t('settings.env.baseHint')}</p>
                        <div className="divide-y divide-border/40">
                            {CHECK_DEFS.filter(d => d.group === 'base').map(def => (
                                <CheckRow key={def.id} def={def} result={data?.checks[def.id]}/>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
