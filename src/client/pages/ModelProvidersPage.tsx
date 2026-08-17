/**
 * @file ModelProvidersPage.tsx
 * @description 模型供应商配置管理页面
 *
 * 本项目自有的模型供应商配置体系前端入口，提供以下能力：
 * - 查看所有已配置供应商（脱敏视图，API Key 仅显示掩码）
 * - 检测本地 Claude / Codex / Pi CLI 的外部配置源
 * - 一键导入外部配置（增量叠加、高优先级覆盖低优先级）
 * - 手动新增 / 编辑 / 删除供应商
 *
 * 布局：顶部操作栏 + 外部源检测区 + 左侧供应商列表 + 右侧编辑表单。
 */

import {useState, useEffect, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {apiGet, apiPost, apiDelete} from '../api';
import {cn} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Card, CardContent} from '../components/ui/card';
import {Badge} from '../components/ui/badge';
import {
    Plus,
    Trash2,
    RefreshCw,
    Loader2,
    Save,
    X,
    AlertCircle,
    Download,
    Bot,
    Terminal,
    Sparkles,
    Cpu,
    Server,
    KeyRound,
    Globe,
    Boxes,
} from 'lucide-react';
import type {
    SafeModelProviderRecord,
    ExternalSourceStatus,
    ModelProviderKind,
    ModelProviderSource,
    ModelProvidersListResponse,
    DetectResponse,
    ImportResponse,
    UpsertResponse,
} from '../types/model-provider-types';

/** 供应商种类对应的图标组件 */
const KIND_ICONS: Record<ModelProviderKind, typeof Bot> = {
    claude: Bot,
    codex: Terminal,
    pi: Sparkles,
    dsh: Boxes,
    custom: Cpu,
};

/** 来源徽章配置 */
const SOURCE_BADGE: Record<ModelProviderSource, { variant: 'default' | 'secondary' | 'outline'; labelKey: string }> = {
    external: {variant: 'outline', labelKey: 'modelProviders.sourceExternal'},
    manual: {variant: 'default', labelKey: 'modelProviders.sourceManual'},
    builtin: {variant: 'secondary', labelKey: 'modelProviders.sourceBuiltin'},
};

/** 供应商类型选项 */
const KIND_OPTIONS: { value: ModelProviderKind; label: string }[] = [
    {value: 'claude', label: 'Claude'},
    {value: 'codex', label: 'Codex'},
    {value: 'pi', label: 'Pi'},
    {value: 'dsh', label: 'DeepSeek Harness'},
    {value: 'custom', label: 'Custom'},
];

/** 新增/编辑表单的初始状态 */
function emptyForm() {
    return {
        id: '',
        kind: 'custom' as ModelProviderKind,
        label: '',
        enabled: true,
        apiKey: '',
        baseUrl: '',
        defaultModel: '',
        models: '',
        env: '',
    };
}

/**
 * 模型供应商配置管理页面
 */
export default function ModelProvidersPage() {
    const {t} = useTranslation();

    // 列表与外部源状态
    const [providers, setProviders] = useState<SafeModelProviderRecord[]>([]);
    const [configFile, setConfigFile] = useState<string>('');
    const [sources, setSources] = useState<ExternalSourceStatus[]>([]);
    const [loading, setLoading] = useState(false);
    const [detecting, setDetecting] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    // 编辑状态
    const [editing, setEditing] = useState<SafeModelProviderRecord | null>(null);
    const [creating, setCreating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyForm());

    // 模型拉取状态（对齐 dsh Models 页：候选只供挑选，不自动写配置）
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelCandidates, setModelCandidates] = useState<string[]>([]);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [modelInput, setModelInput] = useState('');

    /** 拉取供应商列表 */
    const fetchProviders = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet<ModelProvidersListResponse>('/model-providers');
            setProviders(data.providers);
            setConfigFile(data.file);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch providers');
        } finally {
            setLoading(false);
        }
    }, []);

    /** 检测外部 CLI 配置源 */
    const detectSources = useCallback(async () => {
        setDetecting(true);
        setError(null);
        try {
            const data = await apiGet<DetectResponse>('/model-providers/detect');
            setSources(data.sources);
            setNotice(
                t('modelProviders.detectResult', {
                    count: data.sources.filter((s) => s.available).length,
                }),
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to detect sources');
        } finally {
            setDetecting(false);
        }
    }, [t]);

    /** 一键导入外部配置 */
    const handleImport = async () => {
        setImporting(true);
        setError(null);
        try {
            const data = await apiPost<ImportResponse>('/model-providers/import', {});
            setProviders(data.providers);
            setNotice(
                t('modelProviders.importSuccess', {total: data.summary.total}),
            );
            await detectSources();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to import');
        } finally {
            setImporting(false);
        }
    };

    // 首次加载：拉列表 + 检测外部源
    useEffect(() => {
        fetchProviders();
        detectSources();
    }, [fetchProviders, detectSources]);

    /** 进入新增模式 */
    const startCreate = () => {
        setCreating(true);
        setEditing(null);
        setForm(emptyForm());
    };

    /** 进入编辑模式 */
    const startEdit = (provider: SafeModelProviderRecord) => {
        setCreating(false);
        setEditing(provider);
        setForm({
            id: provider.id,
            kind: provider.kind,
            label: provider.label,
            enabled: provider.enabled,
            apiKey: '', // 编辑时留空 = 不修改
            baseUrl: provider.baseUrl ?? '',
            defaultModel: provider.defaultModel ?? '',
            models: (provider.models ?? []).join('\n'),
            env: Object.entries(provider.env ?? {})
                .map(([k, v]) => `${k}=${v}`)
                .join('\n'),
        });
    };

    /** 取消编辑/新增 */
    const cancelForm = () => {
        setCreating(false);
        setEditing(null);
        setForm(emptyForm());
        setModelCandidates([]);
        setFetchError(null);
        setModelInput('');
    };

    /** 更新表单单个字段 */
    const setField = <K extends keyof ReturnType<typeof emptyForm>>(
        key: K,
        value: ReturnType<typeof emptyForm>[K],
    ) => {
        setForm((prev) => ({...prev, [key]: value}));
    };

    /** 解析 env 文本（每行 KEY=VALUE） */
    const parseEnv = (envStr: string): Record<string, string> => {
        const env: Record<string, string> = {};
        envStr.split('\n').filter(Boolean).forEach((line) => {
            const idx = line.indexOf('=');
            if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });
        return env;
    };

    // --- 模型列表（chip 编辑 + 端点拉取） ---
    const modelsList = form.models.split('\n').map((m) => m.trim()).filter(Boolean);
    const setModels = (list: string[]) => setField('models', list.join('\n'));
    const addModel = (id: string) => {
        const v = id.trim();
        if (v && !modelsList.includes(v)) setModels([...modelsList, v]);
    };
    const removeModel = (id: string) => setModels(modelsList.filter((m) => m !== id));

    /** 切换类型时预填 id/label（仅新增且用户未自定义时） */
    const handleKindChange = (kind: ModelProviderKind) => {
        setField('kind', kind);
        if (creating) {
            const opt = KIND_OPTIONS.find((k) => k.value === kind);
            if (!form.id.trim()) setField('id', kind === 'dsh' ? 'dsh' : kind);
            if (!form.label.trim() && opt) setField('label', opt.label);
        }
    };

    /** 用表单当前凭据（未保存也可）向端点拉取模型清单；失败就地展示，可手填 */
    const fetchModels = async () => {
        setFetchingModels(true);
        setFetchError(null);
        try {
            const resp = await apiPost<{ models: string[] }>('/model-providers/models/fetch', {
                apiKey: form.apiKey.trim() || undefined,
                baseUrl: form.baseUrl.trim() || undefined,
                kind: form.kind,
                id: editing?.id,
            });
            setModelCandidates(resp.models ?? []);
            if ((resp.models ?? []).length === 0) setFetchError(t('modelProviders.fetchEmpty'));
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'Failed to fetch');
            setModelCandidates([]);
        } finally {
            setFetchingModels(false);
        }
    };

    /** 保存（新增/编辑） */
    const handleSave = async () => {
        const id = form.id.trim();
        if (!id) {
            setError(t('modelProviders.idRequired'));
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                id,
                kind: form.kind,
                label: form.label.trim() || id,
                enabled: form.enabled,
                apiKey: form.apiKey.trim() || undefined,
                baseUrl: form.baseUrl.trim() || undefined,
                defaultModel: form.defaultModel.trim() || undefined,
                models: form.models
                    .split('\n')
                    .map((m) => m.trim())
                    .filter(Boolean),
                env: parseEnv(form.env),
                source: editing ? editing.source : 'manual',
            };
            await apiPost<UpsertResponse>('/model-providers', payload);
            cancelForm();
            await fetchProviders();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    /** 删除供应商 */
    const handleDelete = async (provider: SafeModelProviderRecord) => {
        if (!confirm(t('modelProviders.deleteConfirm', {name: provider.label}))) return;
        try {
            await apiDelete(`/model-providers/${encodeURIComponent(provider.id)}`);
            if (editing?.id === provider.id) cancelForm();
            await fetchProviders();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete');
        }
    };

    /** 外部源可用状态圆点 */
    const statusDot = (available: boolean) => (
        <span className={cn('h-2.5 w-2.5 rounded-full', available ? 'bg-emerald-500' : 'bg-muted-foreground/30')}/>
    );

    return (
        <div className="p-6 h-full flex flex-col">
            {/* 错误横幅 */}
            {error && (
                <div
                    className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3">
                    <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0"/>
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            )}

            {/* 提示横幅 */}
            {notice && (
                <div
                    className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
                    <span className="h-4 w-4 mt-0.5 flex-shrink-0 text-emerald-500">✓</span>
                    <p className="text-sm text-emerald-600">{notice}</p>
                </div>
            )}

            {/* 顶部操作栏 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="mr-auto">
                    <h2 className="text-base font-semibold text-foreground">{t('pageTitle.modelProviders')}</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('modelProviders.subtitle')}</p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchProviders} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin"/> : <RefreshCw className="h-4 w-4"/>}
                </Button>
                <Button variant="outline" size="sm" onClick={detectSources} disabled={detecting}>
                    {detecting ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : <Server className="h-4 w-4 mr-1"/>}
                    {t('modelProviders.detect')}
                </Button>
                <Button size="sm" onClick={handleImport} disabled={importing}>
                    {importing ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> :
                        <Download className="h-4 w-4 mr-1"/>}
                    {t('modelProviders.import')}
                </Button>
                <Button size="sm" onClick={startCreate}>
                    <Plus className="h-4 w-4 mr-1"/>
                    {t('modelProviders.add')}
                </Button>
            </div>

            {/* 外部源检测区 */}
            <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground"/>
                    <span className="text-xs font-medium text-muted-foreground">
                        {t('modelProviders.externalSources')}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">
                        {t('modelProviders.externalHint')}
                    </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {sources.length === 0 && (
                        <div
                            className="sm:col-span-3 rounded-lg border border-border/50 px-3 py-2 text-xs text-muted-foreground">
                            {t('modelProviders.noSourceYet')}
                        </div>
                    )}
                    {sources.map((source) => (
                        <div
                            key={source.source}
                            className={cn(
                                'rounded-lg border px-3 py-2',
                                source.available ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border/60 bg-muted/20',
                            )}
                        >
                            <div className="flex items-center gap-2">
                                {statusDot(source.available)}
                                <span className="text-sm font-medium">{source.label}</span>
                                <Badge variant={source.available ? 'success' : 'secondary'}
                                       className="ml-auto text-[10px]">
                                    {source.available ? t('modelProviders.available') : t('modelProviders.unavailable')}
                                </Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-1 truncate font-mono"
                               title={source.paths.join(', ')}>
                                {source.available
                                    ? source.paths.join(', ') || '-'
                                    : (source.error || t('modelProviders.unavailable'))}
                            </p>
                            {source.available && source.providerCount != null && (
                                <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                                    {t('modelProviders.providerCount', {count: source.providerCount})}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* 主体：列表 + 表单 */}
            <div className="flex-1 flex gap-4 min-h-0">
                {/* 左侧供应商列表 */}
                <div className="w-80 flex flex-col flex-shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <span
                            className="text-xs font-medium text-muted-foreground">{t('modelProviders.providers')}</span>
                        <span className="text-[11px] text-muted-foreground/70" title={configFile}>
                            {configFile ? t('modelProviders.configFileLabel') : ''}
                        </span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {loading && (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
                            </div>
                        )}
                        {!loading && providers.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-8 gap-2">
                                <Server className="h-8 w-8 text-muted-foreground/50"/>
                                <p className="text-xs text-muted-foreground text-center">{t('modelProviders.noProviders')}</p>
                            </div>
                        )}
                        {providers.map((provider) => {
                            const Icon = KIND_ICONS[provider.kind] ?? Cpu;
                            const sourceBadge = SOURCE_BADGE[provider.source] ?? SOURCE_BADGE.manual;
                            return (
                                <Card
                                    key={provider.id}
                                    className={cn(
                                        'cursor-pointer transition-all duration-150 hover:border-primary/50',
                                        editing?.id === provider.id && 'border-primary ring-1 ring-primary/20',
                                    )}
                                    onClick={() => startEdit(provider)}
                                >
                                    <CardContent className="p-3">
                                        <div className="flex items-center gap-2">
                                            <Icon className="h-4 w-4 text-primary flex-shrink-0"/>
                                            <span
                                                className="text-sm font-medium flex-1 truncate">{provider.label}</span>
                                            <Badge variant={provider.enabled ? 'success' : 'secondary'}
                                                   className="text-[10px]">
                                                {provider.enabled ? t('modelProviders.on') : t('modelProviders.off')}
                                            </Badge>
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                            <Badge variant={sourceBadge.variant} className="text-[10px]">
                                                {t(sourceBadge.labelKey)}
                                            </Badge>
                                            <span
                                                className="text-[11px] text-muted-foreground truncate font-mono">{provider.id}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                                            <KeyRound className="h-3 w-3 flex-shrink-0"/>
                                            {provider.hasApiKey
                                                ? <span className="font-mono">{provider.apiKeyMasked}</span>
                                                : <span>{t('modelProviders.noApiKey')}</span>
                                            }
                                        </div>
                                        {provider.baseUrl && (
                                            <p className="text-[11px] text-muted-foreground/80 mt-1 truncate font-mono">
                                                {provider.baseUrl}
                                            </p>
                                        )}
                                        <p className="text-[11px] text-muted-foreground/70 mt-1 truncate">
                                            {provider.models.length > 0
                                                ? provider.models.join(', ')
                                                : t('modelProviders.noModels')}
                                        </p>
                                        <div className="mt-2.5 flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs text-destructive hover:text-destructive"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDelete(provider);
                                                }}
                                            >
                                                <Trash2 className="h-3 w-3 mr-1"/>
                                                {t('common.delete')}
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </div>

                {/* 右侧表单 */}
                {(creating || editing) ? (
                    <Card className="flex-1 overflow-y-auto">
                        <div className="p-4">
                            <h3 className="text-sm font-medium mb-4">
                                {creating
                                    ? t('modelProviders.addTitle')
                                    : t('modelProviders.editTitle', {name: editing?.label ?? editing?.id})}
                            </h3>
                            <div className="space-y-5">
                                {/* ── 分区：基础信息 ── */}
                                <section className="space-y-3">
                                    <div>
                                        <h4 className="text-sm font-medium">
                                            {t('modelProviders.sectionBasic')}
                                        </h4>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t('modelProviders.sectionBasicHint')}
                                        </p>
                                    </div>
                                    {/* 类型：按钮组（视觉选择器） */}
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                        {KIND_OPTIONS.map((k) => {
                                            const KindIcon = KIND_ICONS[k.value];
                                            const active = form.kind === k.value;
                                            return (
                                                <button
                                                    key={k.value}
                                                    type="button"
                                                    onClick={() => handleKindChange(k.value)}
                                                    className={cn(
                                                        'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs transition-colors',
                                                        active
                                                            ? 'border-primary bg-primary/10 font-medium text-primary'
                                                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                                                    )}
                                                >
                                                    <KindIcon className="h-4 w-4"/>
                                                    {k.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                {t('modelProviders.id')}
                                            </label>
                                            <Input
                                                value={form.id}
                                                onChange={(e) => setField('id', e.target.value)}
                                                disabled={!!editing}
                                                placeholder="my-provider"
                                                className="font-mono"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                {t('modelProviders.label')}
                                            </label>
                                            <Input
                                                value={form.label}
                                                onChange={(e) => setField('label', e.target.value)}
                                                placeholder={t('modelProviders.labelPlaceholder')}
                                            />
                                        </div>
                                    </div>
                                </section>

                                {/* ── 分区：连接 ── */}
                                <section className="space-y-3">
                                    <div>
                                        <h4 className="text-sm font-medium">
                                            {t('modelProviders.sectionConnection')}
                                        </h4>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {t('modelProviders.sectionConnectionHint')}
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                {t('modelProviders.apiKey')}
                                            </label>
                                            <Input
                                                type="password"
                                                value={form.apiKey}
                                                onChange={(e) => setField('apiKey', e.target.value)}
                                                placeholder={editing
                                                    ? t('modelProviders.apiKeyEditPlaceholder')
                                                    : t('modelProviders.apiKeyPlaceholder')}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                                {t('modelProviders.baseUrl')}
                                                <span className="ml-1 font-normal text-muted-foreground/60">
                                                    ({t('modelProviders.optional')})
                                                </span>
                                            </label>
                                            <Input
                                                value={form.baseUrl}
                                                onChange={(e) => setField('baseUrl', e.target.value)}
                                                placeholder="https://api.deepseek.com"
                                            />
                                        </div>
                                    </div>
                                </section>

                                {/* ── 分区：模型 ── */}
                                <section className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <div className="mr-auto">
                                            <h4 className="text-sm font-medium">
                                                {t('modelProviders.sectionModels')}
                                            </h4>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t('modelProviders.sectionModelsHint')}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={fetchModels}
                                            disabled={fetchingModels}
                                        >
                                            {fetchingModels
                                                ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/>
                                                : <Sparkles className="h-4 w-4 mr-1"/>}
                                            {fetchingModels
                                                ? t('modelProviders.fetchingModels')
                                                : t('modelProviders.fetchModels')}
                                        </Button>
                                    </div>
                                    {fetchError && (
                                        <p className="text-xs text-destructive">{fetchError}</p>
                                    )}
                                    {/* 候选模型（端点返回，点击切换选中） */}
                                    {modelCandidates.length > 0 && (
                                        <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
                                            <p className="text-[11px] text-muted-foreground mb-1.5">
                                                {t('modelProviders.candidatesHint')}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5">
                                                {modelCandidates.map((m) => {
                                                    const picked = modelsList.includes(m);
                                                    return (
                                                        <button
                                                            key={m}
                                                            type="button"
                                                            onClick={() => (picked ? removeModel(m) : addModel(m))}
                                                            className={cn(
                                                                'rounded-full border px-2.5 py-1 font-mono text-xs transition-colors',
                                                                picked
                                                                    ? 'border-primary bg-primary/10 text-primary'
                                                                    : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                                                            )}
                                                        >
                                                            {m}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                    {/* 已选模型 chips */}
                                    <div className="flex flex-wrap items-center gap-1.5 min-h-[2rem]">
                                        {modelsList.length === 0 && (
                                            <span className="text-xs text-muted-foreground/60">
                                                {t('modelProviders.noModelsSelected')}
                                            </span>
                                        )}
                                        {modelsList.map((m) => (
                                            <span
                                                key={m}
                                                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 font-mono text-xs"
                                            >
                                                {m}
                                                <button
                                                    type="button"
                                                    onClick={() => removeModel(m)}
                                                    className="text-muted-foreground hover:text-destructive"
                                                    title={t('modelProviders.removeModel')}
                                                >
                                                    <X className="h-3 w-3"/>
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    {/* 手动添加 */}
                                    <Input
                                        value={modelInput}
                                        onChange={(e) => setModelInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                addModel(modelInput);
                                                setModelInput('');
                                            }
                                        }}
                                        placeholder={t('modelProviders.addModelPlaceholder')}
                                        className="font-mono"
                                    />
                                    {/* 默认模型 */}
                                    <div>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {t('modelProviders.defaultModel')}
                                        </label>
                                        {modelsList.length > 0 ? (
                                            <select
                                                value={form.defaultModel}
                                                onChange={(e) => setField('defaultModel', e.target.value)}
                                                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            >
                                                <option value="">{t('modelProviders.defaultModelNone')}</option>
                                                {modelsList.map((m) => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                        ) : (
                                            <Input
                                                value={form.defaultModel}
                                                onChange={(e) => setField('defaultModel', e.target.value)}
                                                placeholder="deepseek-chat / …"
                                                className="font-mono"
                                            />
                                        )}
                                    </div>
                                </section>

                                {/* ── 分区：高级（折叠） ── */}
                                <details className="rounded-lg border border-border/60">
                                    <summary
                                        className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground">
                                        {t('modelProviders.sectionAdvanced')}
                                    </summary>
                                    <div className="px-3 pb-3">
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {t('modelProviders.env')}
                                        </label>
                                        <textarea
                                            value={form.env}
                                            onChange={(e) => setField('env', e.target.value)}
                                            placeholder={t('modelProviders.envPlaceholder')}
                                            rows={3}
                                            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                                        />
                                    </div>
                                </details>

                                {/* ── 底部操作 ── */}
                                <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                                    <input
                                        type="checkbox"
                                        checked={form.enabled}
                                        onChange={(e) => setField('enabled', e.target.checked)}
                                        className="rounded border-input"
                                        id="provider-enabled-check"
                                    />
                                    <label htmlFor="provider-enabled-check" className="text-sm">
                                        {t('modelProviders.enabled')}
                                    </label>
                                    <div className="ml-auto flex gap-2">
                                        <Button onClick={handleSave} size="sm" disabled={saving}>
                                            {saving
                                                ? <Loader2 className="h-4 w-4 mr-1 animate-spin"/>
                                                : <Save className="h-4 w-4 mr-1"/>}
                                            {creating ? t('common.create') : t('common.save')}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={cancelForm}>
                                            <X className="h-4 w-4 mr-1"/>
                                            {t('common.cancel')}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                ) : (
                    <Card className="flex-1 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <Cpu className="h-10 w-10 text-muted-foreground/30"/>
                            <p className="text-sm text-muted-foreground">{t('modelProviders.emptyState')}</p>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
}
