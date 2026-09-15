/**
 * @file DataSection.tsx
 * @description 设置中心 - 数据面板（配置导入/导出）。
 *
 * 导出：聚合 GET /model-providers、GET /mcp-servers、GET /skills（逐个补拉
 * /skills/:name 取 content，因列表接口不含正文）+ store 的外观设置
 * （字体/字号/主题/语言），打包为 JSON 备份文件下载。
 * 导出前剔除敏感凭据：
 * - 供应商记录的 hasApiKey / apiKeyMasked（以及任何命中凭据模式的顶层字段）；
 * - 供应商与 MCP 的 env 中键名疑似凭据（key/token/secret/password/auth 等）的条目；
 * 由于 env 取值无法完全识别，只要导出内容涉及凭据字段或任何 env 条目，
 * 下载前弹确认框提示"导出内容可能包含 API 凭据"。
 *
 * 导入：选择此前导出的 JSON → 解析（data 包装层/版本均可容错）→ 逐类
 * 逐条调用既有写入端点（POST /model-providers 为 upsert、POST /mcp-servers、
 * POST /skills，名称冲突计入"跳过"），外观设置写回 store（setFontFamily/
 * setFontSize/setTheme/setLocale + i18n.changeLanguage）→ 显示每类
 * 成功/跳过/失败统计，并提示用户刷新相关页面数据。
 */

import {useRef, useState} from 'react';
import type {ChangeEvent} from 'react';
import {useTranslation} from 'react-i18next';
import {
    AlertTriangle,
    CheckCircle2,
    Database,
    Download,
    Upload,
    XCircle,
} from 'lucide-react';
import {cn} from '../../lib/utils';
import {useAppStore} from '../../stores/app-store';
import type {Theme} from '../../stores/app-store';
import {ApiError, apiGet, apiPost} from '../../api';
import type {
    ModelProvidersListResponse,
    SafeModelProviderRecord,
} from '../../types/model-provider-types';
import {Card, CardContent, CardHeader, CardTitle} from '../../components/ui/card';

/** 导出文件格式版本 */
const EXPORT_VERSION = 1;

/**
 * 疑似凭据的字段名/环境变量键名匹配（大小写不敏感）。
 * 依据 model-provider-types.ts（hasApiKey/apiKeyMasked）与 MCPServerConfig（env）
 * 的实际字段归纳：api key、token、secret、password、credential、auth 类。
 */
const SENSITIVE_KEY_RE = /(api[-_]?key|token|secret|passw(or)?d|credential|auth)/i;

/** 供应商合法 kind（与后端 normalizeRecordInput 的 VALID_KINDS 一致） */
const VALID_KINDS = ['claude', 'codex', 'pi', 'custom'] as const;

/** 供应商合法 source（与后端一致，非法值导入时回落 'manual'） */
const VALID_SOURCES = ['external', 'manual', 'builtin'] as const;

/** MCP 服务器配置（与 MCPPage 内部 MCPServerConfig 结构一致；status 为运行时字段，导出时剔除） */
interface McpServerConfig {
    name: string;
    type: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    enabled: boolean;
    status?: 'connected' | 'disconnected' | 'error';
}

/** GET /skills 列表项（不含 content） */
interface SkillListItem {
    name: string;
    description: string;
    enabled: boolean;
    filePath: string;
    source?: string;
}

/** GET /skills/:name 详情（含 content） */
interface SkillDetail extends SkillListItem {
    content: string;
}

/** 导出文件中的技能条目 */
interface SkillExport {
    name: string;
    description?: string;
    enabled?: boolean;
    source?: string;
    content: string;
}

/** 导出文件中的外观设置 */
interface AppearanceExport {
    theme?: string;
    locale?: string;
    fontFamilyZh?: string;
    fontFamilyEn?: string;
    fontSize?: number;
}

/** 导出文件结构（data 包装层在导入时容错：缺失时回退到根对象） */
interface SettingsExport {
    app: 'ai-dev-workflow';
    version: number;
    exportedAt: string;
    data: {
        appearance: AppearanceExport;
        modelProviders: SafeModelProviderRecord[];
        mcpServers: McpServerConfig[];
        skills: SkillExport[];
    };
}

/** 导出结果摘要（结果区展示用） */
interface ExportResult {
    file: string;
    counts: {providers: number; servers: number; skills: number};
    /** 剔除的疑似凭据字段/env 条目总数 */
    stripped: number;
}

/** 导入统计的类别键 */
type ImportClassKey = 'appearance' | 'modelProviders' | 'mcpServers' | 'skills';

/** 单类导入统计 */
interface ClassStat {
    ok: number;
    skipped: number;
    failed: number;
}

type ImportStats = Record<ImportClassKey, ClassStat>;

/** 各类别对应的 i18n 标签键（结果区展示顺序） */
const CLASS_LABEL_KEYS: Record<ImportClassKey, string> = {
    appearance: 'settings.data.catAppearance',
    modelProviders: 'settings.data.catModelProviders',
    mcpServers: 'settings.data.catMcp',
    skills: 'settings.data.catSkills',
};

/** 空统计初值 */
function emptyStats(): ImportStats {
    const zero = {ok: 0, skipped: 0, failed: 0};
    return {
        appearance: {...zero},
        modelProviders: {...zero},
        mcpServers: {...zero},
        skills: {...zero},
    };
}

/** 结构容错：把"数组 | {providers: 数组}"统一成数组（未知结构返回空数组） */
function asArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === 'object' && Array.isArray((value as {providers?: unknown}).providers)) {
        return (value as {providers: T[]}).providers;
    }
    return [];
}

/** 判断是否为字符串键值对象（env 校验） */
function isStringRecord(value: unknown): value is Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}

/** 后端错误是否为"名称已存在"类冲突（导入时计入跳过而非失败） */
function isDuplicateError(err: unknown): boolean {
    return err instanceof ApiError && /exist/i.test(String(err.body?.message ?? ''));
}

/**
 * 剔除对象顶层命中凭据模式的字段（如 hasApiKey / apiKeyMasked / apiKey）
 * @returns 清理后的浅拷贝与剔除数量
 */
function stripSensitiveFields(record: Record<string, unknown>): {clean: Record<string, unknown>; removed: number} {
    const clean: Record<string, unknown> = {};
    let removed = 0;
    for (const [key, value] of Object.entries(record)) {
        if (SENSITIVE_KEY_RE.test(key)) {
            removed++;
            continue;
        }
        clean[key] = value;
    }
    return {clean, removed};
}

/**
 * 剔除 env 中键名疑似凭据的条目（保留其余条目，避免破坏服务器启动配置）
 * @returns 清理后的 env 与剔除数量
 */
function sanitizeEnv(env: Record<string, string>): {env: Record<string, string>; removed: number} {
    const clean: Record<string, string> = {};
    let removed = 0;
    for (const [key, value] of Object.entries(env)) {
        if (SENSITIVE_KEY_RE.test(key)) {
            removed++;
            continue;
        }
        clean[key] = value;
    }
    return {env: clean, removed};
}

/** 生成本地日期戳 YYYYMMDD（导出文件名用） */
function dateStamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/**
 * 数据面板组件
 * @returns 导出/导入两个大按钮卡片 + 说明文案 + 结果摘要区
 */
export function DataSection() {
    const {t, i18n} = useTranslation();
    // 外观设置当前值（导出用；导入回写经 set 系列 action，自动持久化并生效）
    const theme = useAppStore((s) => s.ui.theme);
    const locale = useAppStore((s) => s.ui.locale);
    const fontFamilyZh = useAppStore((s) => s.ui.fontFamilyZh);
    const fontFamilyEn = useAppStore((s) => s.ui.fontFamilyEn);
    const fontSize = useAppStore((s) => s.ui.fontSize);
    const setTheme = useAppStore((s) => s.setTheme);
    const setLocale = useAppStore((s) => s.setLocale);
    const setFontFamily = useAppStore((s) => s.setFontFamily);
    const setFontSize = useAppStore((s) => s.setFontSize);

    const [exporting, setExporting] = useState(false);
    const [exportResult, setExportResult] = useState<ExportResult | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportStats | null>(null);
    const [importError, setImportError] = useState<string | null>(null);

    /** 隐藏的文件选择 input（导入入口卡片点击触发） */
    const fileInputRef = useRef<HTMLInputElement>(null);

    /** 触发浏览器下载 */
    const downloadJson = (filename: string, payload: SettingsExport) => {
        const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    /** 导出：聚合三类配置 + 外观设置，脱敏后打包下载 */
    const handleExport = async () => {
        setExportError(null);
        setExportResult(null);
        setExporting(true);
        try {
            const [providersRes, servers, skillList] = await Promise.all([
                apiGet<ModelProvidersListResponse>('/model-providers'),
                apiGet<McpServerConfig[]>('/mcp-servers'),
                apiGet<SkillListItem[]>('/skills'),
            ]);

            // GET /skills 不含 content，逐个取详情补全（导入端 POST /skills 必填 content）
            const skills: SkillExport[] = await Promise.all(
                skillList.map(async (skill) => {
                    try {
                        const detail = await apiGet<SkillDetail>(`/skills/${encodeURIComponent(skill.name)}`);
                        return {
                            name: skill.name,
                            description: detail.description,
                            enabled: detail.enabled,
                            source: detail.source,
                            content: detail.content,
                        };
                    } catch {
                        // 详情拉取失败：仍导出条目（content 为空，导入时该条会被跳过）
                        return {
                            name: skill.name,
                            description: skill.description,
                            enabled: skill.enabled,
                            source: skill.source,
                            content: '',
                        };
                    }
                })
            );

            // 脱敏：剔除凭据字段 + env 中疑似凭据条目
            let stripped = 0;
            let envEntries = 0;
            const providers = providersRes.providers.map((provider) => {
                const {clean, removed} = stripSensitiveFields(provider as unknown as Record<string, unknown>);
                stripped += removed;
                const {env, removed: envRemoved} = sanitizeEnv(isStringRecord(clean.env) ? clean.env : {});
                stripped += envRemoved;
                envEntries += Object.keys(env).length;
                return {...clean, env} as SafeModelProviderRecord;
            });
            const mcpServers = servers.map((server) => {
                const {clean, removed} = stripSensitiveFields(server as unknown as Record<string, unknown>);
                stripped += removed;
                const {env, removed: envRemoved} = sanitizeEnv(isStringRecord(clean.env) ? clean.env : {});
                stripped += envRemoved;
                envEntries += Object.keys(env).length;
                // status 为运行时字段，不随配置导出
                const {status: _status, ...rest} = clean;
                return {...rest, env} as unknown as McpServerConfig;
            });

            // env 取值无法完全识别是否含密钥：涉及凭据字段或任何 env 条目时弹确认框
            if ((stripped > 0 || envEntries > 0) && !window.confirm(t('settings.data.exportConfirm'))) {
                return;
            }

            const payload: SettingsExport = {
                app: 'ai-dev-workflow',
                version: EXPORT_VERSION,
                exportedAt: new Date().toISOString(),
                data: {
                    appearance: {theme, locale, fontFamilyZh, fontFamilyEn, fontSize},
                    modelProviders: providers,
                    mcpServers,
                    skills,
                },
            };
            const filename = `ai-dev-workflow-settings-${dateStamp()}.json`;
            downloadJson(filename, payload);
            setExportResult({
                file: filename,
                counts: {providers: providers.length, servers: mcpServers.length, skills: skills.length},
                stripped,
            });
        } catch (err) {
            setExportError(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    /** 把导入文件中的外观设置写回 store（带类型/范围校验，缺省项保留当前值） */
    const applyImportedAppearance = (appearance: AppearanceExport) => {
        const zh = typeof appearance.fontFamilyZh === 'string' && appearance.fontFamilyZh.trim()
            ? appearance.fontFamilyZh : fontFamilyZh;
        const en = typeof appearance.fontFamilyEn === 'string' && appearance.fontFamilyEn.trim()
            ? appearance.fontFamilyEn : fontFamilyEn;
        setFontFamily(zh, en);
        if (typeof appearance.fontSize === 'number' && Number.isFinite(appearance.fontSize)) {
            setFontSize(Math.min(18, Math.max(12, Math.round(appearance.fontSize))));
        }
        if (appearance.theme === 'light' || appearance.theme === 'dark') {
            setTheme(appearance.theme as Theme);
        }
        if (appearance.locale === 'zh' || appearance.locale === 'en') {
            setLocale(appearance.locale);
            i18n.changeLanguage(appearance.locale);
        }
    };

    /** 导入：解析文件 → 逐类逐条写入 → 汇总统计 */
    const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        // 允许重复选择同一个文件（不清空的话 onChange 不会再次触发）
        event.target.value = '';
        if (!file) return;

        setImportError(null);
        setImportResult(null);

        let parsed: unknown;
        try {
            parsed = JSON.parse(await file.text());
        } catch {
            setImportError(t('settings.data.invalidFile'));
            return;
        }
        // 结构容错：优先取 data 包装层，缺失时直接用根对象（版本号仅记录不阻断）
        const root = (
            parsed !== null && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)
                ? (parsed as {data: unknown}).data
                : parsed
        ) as Record<string, unknown> | null;
        const data = (root ?? {}) as Record<string, unknown>;

        const stats = emptyStats();
        setImporting(true);
        try {
            // --- 模型供应商（POST /model-providers 为 upsert，按 id 幂等） ---
            for (const provider of asArray<SafeModelProviderRecord>(data.modelProviders)) {
                if (
                    !provider || typeof provider.id !== 'string' || !provider.id.trim()
                    || typeof provider.kind !== 'string'
                    || !(VALID_KINDS as readonly string[]).includes(provider.kind)
                ) {
                    stats.modelProviders.skipped++;
                    continue;
                }
                try {
                    await apiPost('/model-providers', {
                        id: provider.id.trim(),
                        kind: provider.kind,
                        label: typeof provider.label === 'string' ? provider.label : undefined,
                        enabled: provider.enabled !== false,
                        baseUrl: typeof provider.baseUrl === 'string' ? provider.baseUrl : undefined,
                        env: isStringRecord(provider.env) ? provider.env : undefined,
                        models: Array.isArray(provider.models)
                            ? provider.models.filter((m): m is string => typeof m === 'string')
                            : undefined,
                        defaultModel: typeof provider.defaultModel === 'string' ? provider.defaultModel : undefined,
                        source: typeof provider.source === 'string'
                            && (VALID_SOURCES as readonly string[]).includes(provider.source)
                            ? provider.source
                            : 'manual',
                    });
                    stats.modelProviders.ok++;
                } catch {
                    stats.modelProviders.failed++;
                }
            }

            // --- MCP 服务器（名称冲突由后端拒绝，计入跳过） ---
            for (const server of asArray<McpServerConfig>(data.mcpServers)) {
                if (
                    !server || typeof server.name !== 'string' || !server.name.trim()
                    || typeof server.command !== 'string' || !server.command.trim()
                ) {
                    stats.mcpServers.skipped++;
                    continue;
                }
                try {
                    await apiPost('/mcp-servers', {
                        name: server.name.trim(),
                        type: typeof server.type === 'string' && server.type ? server.type : 'custom',
                        command: server.command.trim(),
                        args: Array.isArray(server.args)
                            ? server.args.filter((a): a is string => typeof a === 'string')
                            : [],
                        env: isStringRecord(server.env) ? server.env : {},
                        enabled: server.enabled !== false,
                    });
                    stats.mcpServers.ok++;
                } catch (err) {
                    if (isDuplicateError(err)) stats.mcpServers.skipped++;
                    else stats.mcpServers.failed++;
                }
            }

            // --- Skills（名称冲突计入跳过；content 为空的条目直接跳过） ---
            for (const skill of asArray<SkillExport>(data.skills)) {
                if (
                    !skill || typeof skill.name !== 'string' || !skill.name.trim()
                    || typeof skill.content !== 'string' || !skill.content.trim()
                ) {
                    stats.skills.skipped++;
                    continue;
                }
                try {
                    await apiPost('/skills', {
                        name: skill.name.trim(),
                        description: typeof skill.description === 'string' ? skill.description : '',
                        content: skill.content,
                        enabled: skill.enabled !== false,
                    });
                    stats.skills.ok++;
                } catch (err) {
                    if (isDuplicateError(err)) stats.skills.skipped++;
                    else stats.skills.failed++;
                }
            }

            // --- 外观设置写回 store（最后执行，避免中途切换语言影响统计展示） ---
            try {
                applyImportedAppearance((data.appearance ?? {}) as AppearanceExport);
                stats.appearance.ok++;
            } catch {
                stats.appearance.failed++;
            }

            setImportResult(stats);
        } catch (err) {
            // 未预期的整体异常：展示错误并保留已完成部分的统计
            setImportError(err instanceof Error ? err.message : String(err));
            setImportResult(stats);
        } finally {
            setImporting(false);
        }
    };

    /** 渲染单类导入统计行 */
    const renderStatRow = (cls: ImportClassKey, stat: ClassStat) => (
        <div key={cls} className="flex items-center justify-between gap-4 py-1">
            <span className="text-xs font-medium">{t(CLASS_LABEL_KEYS[cls])}</span>
            <span className="flex gap-3 text-xs tabular-nums text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400">
                    {t('settings.data.statImported')} {stat.ok}
                </span>
                <span>
                    {t('settings.data.statSkipped')} {stat.skipped}
                </span>
                <span className={cn(stat.failed > 0 && 'text-red-600 dark:text-red-400')}>
                    {t('settings.data.statFailed')} {stat.failed}
                </span>
            </span>
        </div>
    );

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t('settings.nav.data')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            {t('settings.data.description')}
                        </p>

                        {/* 导出 / 导入：两个大按钮卡片 */}
                        <div className="grid gap-4 sm:grid-cols-2">
                            <button
                                type="button"
                                disabled={exporting || importing}
                                onClick={handleExport}
                                className="group rounded-xl border border-border/50 bg-card p-5 text-left transition-all duration-200 hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
                            >
                                <span className="flex items-center gap-3">
                                    <span
                                        className="brand-gradient-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary"
                                    >
                                        <Download className="h-5 w-5"/>
                                    </span>
                                    <span className="text-sm font-semibold">{t('settings.data.export')}</span>
                                </span>
                                <span className="mt-3 block text-xs leading-relaxed text-muted-foreground">
                                    {t('settings.data.exportDescription')}
                                </span>
                                {exporting && (
                                    <span className="mt-3 block text-xs font-medium text-primary">
                                        {t('settings.data.exporting')}
                                    </span>
                                )}
                            </button>

                            <button
                                type="button"
                                disabled={exporting || importing}
                                onClick={() => fileInputRef.current?.click()}
                                className="group rounded-xl border border-border/50 bg-card p-5 text-left transition-all duration-200 hover:border-primary/50 hover:shadow-md disabled:pointer-events-none disabled:opacity-60"
                            >
                                <span className="flex items-center gap-3">
                                    <span
                                        className="brand-gradient-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary"
                                    >
                                        <Upload className="h-5 w-5"/>
                                    </span>
                                    <span className="text-sm font-semibold">{t('settings.data.import')}</span>
                                </span>
                                <span className="mt-3 block text-xs leading-relaxed text-muted-foreground">
                                    {t('settings.data.importDescription')}
                                </span>
                                {importing && (
                                    <span className="mt-3 block text-xs font-medium text-primary">
                                        {t('settings.data.importing')}
                                    </span>
                                )}
                            </button>
                        </div>

                        {/* 隐藏的文件选择框：仅接受 JSON */}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={handleImportFile}
                        />

                        {/* 导出结果摘要 */}
                        {exportResult && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                                <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="h-4 w-4 shrink-0"/>
                                    {t('settings.data.exportDone')}
                                </p>
                                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                    {exportResult.file}
                                </p>
                                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                                    <p>
                                        {t('settings.data.catModelProviders')} {exportResult.counts.providers}
                                        {' · '}
                                        {t('settings.data.catMcp')} {exportResult.counts.servers}
                                        {' · '}
                                        {t('settings.data.catSkills')} {exportResult.counts.skills}
                                    </p>
                                    {exportResult.stripped > 0 && (
                                        <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                            <AlertTriangle className="h-3 w-3 shrink-0"/>
                                            {t('settings.data.strippedCount', {count: exportResult.stripped})}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                        {exportError && (
                            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                                    <XCircle className="h-4 w-4 shrink-0"/>
                                    {t('settings.data.exportFailed')}
                                </p>
                                <p className="mt-1 break-all text-xs text-destructive/80">{exportError}</p>
                            </div>
                        )}

                        {/* 导入结果摘要 */}
                        {importResult && (
                            <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                                <p className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                    <CheckCircle2 className="h-4 w-4 shrink-0"/>
                                    {t('settings.data.importDone')}
                                </p>
                                <p className="mt-2 text-xs font-medium text-muted-foreground">
                                    {t('settings.data.importSummary')}
                                </p>
                                <div className="mt-1 divide-y divide-border/40">
                                    {(Object.keys(CLASS_LABEL_KEYS) as ImportClassKey[]).map((cls) =>
                                        renderStatRow(cls, importResult[cls])
                                    )}
                                </div>
                                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0"/>
                                    {t('settings.data.importRefreshHint')}
                                </p>
                            </div>
                        )}
                        {importError && (
                            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
                                <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                                    <XCircle className="h-4 w-4 shrink-0"/>
                                    {t('settings.data.importFailed')}
                                </p>
                                <p className="mt-1 break-all text-xs text-destructive/80">{importError}</p>
                            </div>
                        )}

                        {/* 底部说明：数据覆盖范围 */}
                        <div className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
                            <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"/>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                                {t('settings.data.scopeNote')}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
