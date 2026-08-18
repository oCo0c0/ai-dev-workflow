/**
 * @file ModelConfigModal.tsx
 * @description 模型配置弹窗组件（数据驱动）
 *
 * 面板按当前激活 Provider 的能力声明（capabilities）渲染配置字段：
 * 支持推理强度的才显示推理强度，支持扩展思考的才显示扩展思考。
 * 新增 Provider 无需修改本组件——只要后端注册并声明能力，此处自动适配。
 * 仅 pi 的"LLM 提供商"下拉为 provider 特定区块（其选项来自 pi 的本地检测元数据）。
 */

import {useState, useEffect} from 'react';
import {useAppStore} from '../stores/app-store';
import {X, Bot, Terminal, Sparkles, Check, Loader2} from 'lucide-react';
import {Button} from './ui/button';

/** 推理强度选项 */
const REASONING_EFFORTS = [
    {value: 'low', label: 'Low'},
    {value: 'medium', label: 'Medium'},
    {value: 'high', label: 'High'},
    {value: 'xhigh', label: 'XHigh'},
    {value: 'max', label: 'Max'},
] as const;

/** Pi 支持的底层 LLM 提供商字典（pi 特定领域知识，仅 pi 区块使用） */
const PI_LLM_PROVIDERS = [
    {value: 'anthropic', label: 'Anthropic'},
    {value: 'openai', label: 'OpenAI'},
    {value: 'deepseek', label: 'DeepSeek'},
    {value: 'google', label: 'Google Gemini'},
    {value: 'groq', label: 'Groq'},
    {value: 'xai', label: 'xAI'},
    {value: 'openrouter', label: 'OpenRouter'},
    {value: 'ollama', label: 'Ollama (本地)'},
];

interface ModelConfigModalProps {
    open: boolean;
    onClose: () => void;
}

/** 模型设置（与后端 ProviderModelSettings 镜像的宽松形态） */
type ModelSettings = {
    model?: string;
    streaming?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    extendedThinking?: boolean;
    maxTokens?: number;
    modelProvider?: string;
};

/**
 * 模型配置弹窗
 */
export function ModelConfigModal({open, onClose}: ModelConfigModalProps) {
    const activeProvider = useAppStore((s) => s.cliProvider.active);
    const modelConfig = useAppStore((s) => s.cliProvider.modelConfig);
    const providerCatalog = useAppStore((s) => s.providerCatalog);
    const availableModels = useAppStore((s) => s.availableModels);
    const piMeta = useAppStore((s) => s.piMeta);
    const fetchModelConfig = useAppStore((s) => s.fetchModelConfig);
    const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels);
    const saveModelConfig = useAppStore((s) => s.saveModelConfig);
    const setModelConfig = useAppStore((s) => s.setModelConfig);

    const [saving, setSaving] = useState(false);

    // 弹窗打开时加载最新配置和可用模型（串行避免覆盖）
    useEffect(() => {
        if (!open) return;
        (async () => {
            await fetchModelConfig();
            await fetchAvailableModels();
        })();
    }, [open, fetchModelConfig, fetchAvailableModels]);

    if (!open) return null;

    // Provider 目录条目（能力声明 + 显示名），未加载时降级
    const entry = providerCatalog.find(p => p.id === activeProvider);
    const label = entry?.label ?? activeProvider;
    const caps = entry?.capabilities;
    const config: ModelSettings = modelConfig[activeProvider] ?? {};
    const modelOptions = availableModels[activeProvider];

    /** 保存当前 Provider 配置 */
    const handleSave = async () => {
        setSaving(true);
        try {
            await saveModelConfig(activeProvider, config);
            onClose();
        } catch {
            // 错误已在 store 中记录
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="glass-panel rounded-xl shadow-2xl w-full max-w-lg mx-4">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div className="flex items-center gap-2">
                        {activeProvider === 'codex'
                            ? <Terminal className="h-5 w-5 text-primary"/>
                            : activeProvider === 'pi'
                            ? <Sparkles className="h-5 w-5 text-primary"/>
                            : <Bot className="h-5 w-5 text-primary"/>
                        }
                        <h2 className="text-lg font-semibold text-foreground">
                            模型配置 — {label}
                        </h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                        <X className="h-4 w-4"/>
                    </Button>
                </div>

                {/* 内容 */}
                <div className="px-6 py-4 space-y-4">
                    {/* 当前 Provider 提示 */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
                        <span>当前激活：</span>
                        <code className="bg-background px-1.5 py-0.5 rounded font-mono">{activeProvider}</code>
                        <span className="ml-auto">在顶部切换 Provider 后重新配置</span>
                    </div>

                    <ProviderConfigPanel
                        providerId={activeProvider}
                        config={config}
                        capabilities={caps}
                        modelTiers={modelOptions?.tiers}
                        currentModel={modelOptions?.current ?? null}
                        piMeta={piMeta}
                        onChange={(updates) => setModelConfig(activeProvider, updates)}
                    />
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        取消
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                        保存配置
                    </Button>
                </div>
            </div>
        </div>
    );
}

/**
 * 通用 Provider 配置面板（按能力声明渲染字段）
 */
function ProviderConfigPanel({
    providerId,
    config,
    capabilities,
    modelTiers,
    currentModel,
    piMeta,
    onChange,
}: {
    providerId: string;
    config: ModelSettings;
    capabilities?: {
        supportsReasoningEffort?: boolean;
        supportsExtendedThinking?: boolean;
    };
    modelTiers?: Array<{ value: string; label: string; model: string }>;
    currentModel: string | null;
    piMeta: {
        availableProviders: string[];
        availableModels: Array<{ provider: string; id: string; name: string }>;
    } | null;
    onChange: (updates: Partial<ModelSettings>) => void;
}) {
    // 能力声明未加载时保守渲染（仅模型 + 流式），避免给不支持的 Provider 显示无效控件
    const supportsReasoning = capabilities?.supportsReasoningEffort ?? false;
    const supportsExtendedThinking = capabilities?.supportsExtendedThinking ?? false;
    // pi 特定区块：底层 LLM 提供商选择（其余 Provider 无此概念）
    const isPi = providerId === 'pi';

    // pi：根据检测到的可用提供商过滤和标记
    const detectedProviders = piMeta?.availableProviders || [];
    const currentModels = isPi
        ? (piMeta?.availableModels || []).filter(m => m.provider === config.modelProvider)
        : [];
    const hasDetected = detectedProviders.length > 0;

    // pi：当前模型不在可用列表中时，自动选第一个（延迟到下个渲染周期，避免 render 中 setState）
    if (isPi && currentModels.length > 0 && config.model && !currentModels.some(m => m.id === config.model)) {
        setTimeout(() => onChange({model: currentModels[0].id}), 0);
    }

    return (
        <div className="space-y-4">
            {/* pi 检测状态提示 */}
            {isPi && (hasDetected ? (
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 text-xs text-emerald-600">
                    已检测到 {detectedProviders.length} 个已配置 API Key 的提供商：{detectedProviders.join(', ')}
                </div>
            ) : (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-600">
                    未检测到 API Key 配置。请在 ~/.pi/agent/auth.json 或环境变量中设置 API Key
                </div>
            ))}

            {/* pi 底层 LLM 提供商选择 */}
            {isPi && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">LLM 提供商</label>
                    <select
                        value={config.modelProvider || 'anthropic'}
                        onChange={(e) => onChange({modelProvider: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {PI_LLM_PROVIDERS.map(p => (
                            <option key={p.value} value={p.value}>
                                {p.label}{detectedProviders.includes(p.value) ? ' ✓ 已配置' : ''}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                        {hasDetected
                            ? '选择 pi 连接的底层 LLM 服务商。API Key 从 ~/.pi/agent/auth.json 或环境变量读取'
                            : '需先在 ~/.pi/agent/auth.json 或环境变量中配置对应提供商的 API Key'
                        }
                    </p>
                </div>
            )}

            {/* 模型选择：有档位列表用下拉（如 Claude），否则手动输入；pi 用检测到的模型列表 */}
            <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">模型</label>
                {isPi && currentModels.length > 0 ? (
                    <select
                        value={config.model || ''}
                        onChange={(e) => onChange({model: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {currentModels.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.name || m.id}
                            </option>
                        ))}
                    </select>
                ) : modelTiers && modelTiers.length > 0 ? (
                    <select
                        value={config.model || ''}
                        onChange={(e) => onChange({model: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {modelTiers.map(t => (
                            <option key={t.value} value={t.value}>
                                {t.label} → {t.model}
                            </option>
                        ))}
                    </select>
                ) : (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={config.model || ''}
                            onChange={(e) => onChange({model: e.target.value})}
                            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="输入模型名"
                        />
                        {currentModel && currentModel !== config.model && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onChange({model: currentModel})}
                            >
                                使用配置值: {currentModel}
                            </Button>
                        )}
                    </div>
                )}
                {modelTiers && modelTiers.length > 0 && (
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                        档位别名由 Provider 本地配置解析（如 ~/.claude/settings.json 的 env 映射），选中档位由 SDK 解析实际模型
                    </p>
                )}
                {currentModel && !(modelTiers && modelTiers.length > 0) && !isPi && (
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                        Provider 本地配置的当前模型：<code className="bg-muted px-1 rounded">{currentModel}</code>
                    </p>
                )}
            </div>

            {/* 推理强度：按能力声明渲染 */}
            {supportsReasoning && (
                <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                        推理强度（Reasoning Effort）
                    </label>
                    <div className="flex gap-1.5 flex-wrap">
                        {REASONING_EFFORTS.map(effort => (
                            <button
                                key={effort.value}
                                onClick={() => onChange({reasoningEffort: effort.value})}
                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                    config.reasoningEffort === effort.value
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                                }`}
                            >
                                {effort.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                        Max 为最强推理，Low 为最快速响应
                    </p>
                </div>
            )}

            {/* 开关组 */}
            <div className="space-y-2">
                {supportsExtendedThinking && (
                    <ToggleRow
                        label="扩展思考（Extended Thinking）"
                        description="启用后模型会进行更深入的思考"
                        checked={config.extendedThinking ?? false}
                        onChange={(v) => onChange({extendedThinking: v})}
                    />
                )}
                <ToggleRow
                    label="流式输出（Streaming）"
                    description="启用后实时输出响应内容"
                    checked={config.streaming ?? true}
                    onChange={(v) => onChange({streaming: v})}
                />
            </div>
        </div>
    );
}

/** 开关行组件 */
function ToggleRow({    label,
    description,
    checked,
    onChange,
}: {
    label: string;
    description?: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">{label}</div>
                {description && (
                    <div className="text-xs text-muted-foreground/70 mt-0.5">{description}</div>
                )}
            </div>
            <button
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    checked ? 'bg-primary' : 'bg-muted'
                }`}
            >
                <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background shadow transition-transform ${
                        checked ? 'translate-x-4' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
}
