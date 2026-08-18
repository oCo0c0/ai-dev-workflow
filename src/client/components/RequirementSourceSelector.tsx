/**
 * @file RequirementSourceSelector.tsx
 * @description 需求源选择器（目录驱动，热插拔 UI 侧）
 *
 * 数据来自 GET /api/requirements/sources（适配器目录，非 MCP server 列表）：
 * - 已配置源：正常选项（"ONES · ones-api"），选中即用该 server
 * - 未配置源：选项标注"未配置"，选中弹出安装对话框（按适配器 installTemplate
 *   渲染凭据表单，POST install 一键创建 MCP server 并连接测试）
 * - 工具型 MCP（memory / playwright 等）不属于需求源，不会出现
 *
 * 新增需求源（适配器注册）后本组件自动展示，无需改动。
 */

import {useEffect, useState, useCallback} from 'react';
import {useTranslation} from 'react-i18next';
import {Cloud, Loader2, X} from 'lucide-react';
import {apiGet, apiPost} from '../api';
import {Button} from './ui/button';

/** 安装模板中的凭据规格 */
interface EnvKeySpec {
    key: string;
    label: string;
    required: boolean;
    hint?: string;
    secret?: boolean;
}

/** 适配器一键安装模板 */
interface SourceInstallTemplate {
    serverName: string;
    command: string;
    args: string[];
    envSpecs: EnvKeySpec[];
    instructions?: string;
}

/** 需求源目录条目（适配器视角） */
interface RequirementSourceEntry {
    adapterId: string;
    label: string;
    description: string;
    servers: string[];
    installTemplate?: SourceInstallTemplate;
}

interface RequirementSourceSelectorProps {
    /** 当前选中的 server 名（空 = 未选择） */
    value: string;
    /** 选中变更（参数为 server 名） */
    onChange: (serverName: string) => void;
    /** 透传给 select 的样式 */
    className?: string;
}

/** 未配置项的 option 值前缀（触发安装对话框） */
const UNCONFIGURED_PREFIX = '__setup__:';

export function RequirementSourceSelector({value, onChange, className}: RequirementSourceSelectorProps) {
    const {t} = useTranslation();
    const [entries, setEntries] = useState<RequirementSourceEntry[]>([]);
    const [loaded, setLoaded] = useState(false);
    /** 待安装的适配器（非空时显示安装对话框） */
    const [setupAdapter, setSetupAdapter] = useState<RequirementSourceEntry | null>(null);
    const [envValues, setEnvValues] = useState<Record<string, string>>({});
    const [installing, setInstalling] = useState(false);
    const [installResult, setInstallResult] = useState<{ok: boolean; message: string} | null>(null);

    /** 加载源目录 */
    const loadSources = useCallback(() => {
        apiGet<RequirementSourceEntry[]>('/requirements/sources')
            .then((list) => {
                setEntries(list);
                setLoaded(true);
            })
            .catch(() => {
                // 目录加载失败保持空列表；选择器仍可显示占位
                setLoaded(true);
            });
    }, []);

    useEffect(() => {
        loadSources();
    }, [loadSources]);

    const configured = entries.filter(e => e.servers.length > 0);
    const unconfigured = entries.filter(e => e.servers.length === 0 && e.installTemplate);
    const manualOnly = entries.filter(e => e.servers.length === 0 && !e.installTemplate);

    /** 选中"未配置"项：打开安装对话框并保持原选择不变 */
    const handleSelect = (raw: string) => {
        if (raw.startsWith(UNCONFIGURED_PREFIX)) {
            const adapter = entries.find(e => e.adapterId === raw.slice(UNCONFIGURED_PREFIX.length));
            if (adapter?.installTemplate) {
                setSetupAdapter(adapter);
                setEnvValues({});
                setInstallResult(null);
            }
            return;
        }
        onChange(raw);
    };

    /** 提交安装：创建 MCP server + 连接测试，成功后自动选中 */
    const handleInstall = async () => {
        if (!setupAdapter?.installTemplate) return;
        setInstalling(true);
        setInstallResult(null);
        try {
            const res = await apiPost<{serverName: string; connectionTest?: {ok: boolean; message: string}}>(
                `/requirements/sources/${setupAdapter.adapterId}/install`,
                {env: envValues},
            );
            loadSources();
            if (res.connectionTest && !res.connectionTest.ok) {
                setInstallResult({ok: false, message: t('requirements.sourceInstallTestFailed', {message: res.connectionTest.message})});
            } else {
                setInstallResult({ok: true, message: t('requirements.sourceInstallOk')});
                onChange(res.serverName);
                setTimeout(() => setSetupAdapter(null), 800);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Install failed';
            setInstallResult({ok: false, message: t('requirements.sourceInstallFailed', {message})});
        } finally {
            setInstalling(false);
        }
    };

    return (
        <>
            <select
                value={value}
                onChange={(e) => handleSelect(e.target.value)}
                className={className ?? 'rounded-md border border-input bg-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring'}
                title={t('requirements.sourceSelector')}
            >
                <option value="">{t('requirements.sourceSelector')}</option>
                {configured.map(e => e.servers.map(server => (
                    <option key={server} value={server}>{e.label} · {server}</option>
                )))}
                {unconfigured.length > 0 && (
                    <optgroup label={`⟳ ${t('requirements.sourceUnconfigured')}`}>
                        {unconfigured.map(e => (
                            <option key={e.adapterId} value={`${UNCONFIGURED_PREFIX}${e.adapterId}`}>
                                {e.label}（{t('requirements.sourceUnconfigured')}）
                            </option>
                        ))}
                    </optgroup>
                )}
                {manualOnly.map(e => (
                    <option key={e.adapterId} value={`${UNCONFIGURED_PREFIX}${e.adapterId}`} disabled>
                        {e.label}（{t('requirements.sourceUnconfigured')}）
                    </option>
                ))}
                {!loaded && <option value="" disabled>…</option>}
            </select>

            {/* 安装对话框：按模板渲染凭据表单 */}
            {setupAdapter?.installTemplate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="glass-panel rounded-xl shadow-2xl w-full max-w-md mx-4">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                            <div className="flex items-center gap-2">
                                <Cloud className="h-5 w-5 text-primary"/>
                                <h2 className="text-lg font-semibold text-foreground">
                                    {t('requirements.sourceInstallTitle', {label: setupAdapter.label})}
                                </h2>
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSetupAdapter(null)}>
                                <X className="h-4 w-4"/>
                            </Button>
                        </div>

                        <div className="px-6 py-4 space-y-4">
                            <p className="text-sm text-muted-foreground">
                                {t('requirements.sourceInstallBody', {description: setupAdapter.description})}
                            </p>
                            {setupAdapter.installTemplate.instructions && (
                                <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                                    {t('requirements.sourceInstallInstructions', {instructions: setupAdapter.installTemplate.instructions})}
                                </p>
                            )}

                            <div className="space-y-3">
                                {setupAdapter.installTemplate.envSpecs.map(spec => (
                                    <div key={spec.key}>
                                        <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                                            {spec.label}
                                            {spec.required && <span className="text-red-500 ml-0.5">*</span>}
                                        </label>
                                        <input
                                            type={spec.secret ? 'password' : 'text'}
                                            value={envValues[spec.key] ?? ''}
                                            onChange={(e) => setEnvValues(prev => ({...prev, [spec.key]: e.target.value}))}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                            placeholder={spec.hint}
                                        />
                                        {spec.hint && (
                                            <p className="mt-1 text-[11px] text-muted-foreground">{spec.hint}</p>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {installResult && (
                                <p className={`text-xs rounded-md px-3 py-2 ${installResult.ok ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
                                    {installResult.message}
                                </p>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
                            <Button variant="outline" onClick={() => setSetupAdapter(null)} disabled={installing}>
                                取消
                            </Button>
                            <Button onClick={handleInstall} disabled={installing}>
                                {installing && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                                {installing ? t('requirements.sourceInstalling') : t('requirements.sourceInstallButton')}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
