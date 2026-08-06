/**
 * @file ModelConfigModal.tsx
 * @description 模型配置弹窗组件
 *
 * 提供对 Claude Code 和 Codex 的模型选择、streaming/thinking 开关、
 * 以及推理强度（max/high/默认）的配置能力。配置全局生效，
 * 底层调用 CLI Provider SDK 时使用所选模型和参数。
 */

import {useState, useEffect} from 'react';
import {useAppStore} from '../stores/app-store';
import {X, Bot, Terminal, Check, Loader2} from 'lucide-react';
import {Button} from './ui/button';

/** 推理强度选项 */
const REASONING_EFFORTS = [
    {value: 'low', label: 'Low'},
    {value: 'medium', label: 'Medium'},
    {value: 'high', label: 'High'},
    {value: 'xhigh', label: 'XHigh'},
    {value: 'max', label: 'Max'},
] as const;

interface ModelConfigModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 模型配置弹窗
 */
export function ModelConfigModal({open, onClose}: ModelConfigModalProps) {
    const activeProvider = useAppStore((s) => s.cliProvider.active);
    const modelConfig = useAppStore((s) => s.cliProvider.modelConfig);
    const claudeModelTiers = useAppStore((s) => s.claudeModelTiers);
    const codexModel = useAppStore((s) => s.codexModel);
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

    const isClaude = activeProvider === 'claude';
    const claudeConfig = modelConfig.claude;
    const codexConfig = modelConfig.codex;

    /** 保存当前 Provider 配置 */
    const handleSave = async () => {
        setSaving(true);
        try {
            if (isClaude) {
                await saveModelConfig('claude', claudeConfig);
            } else {
                await saveModelConfig('codex', codexConfig);
            }
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
                        {isClaude
                            ? <Bot className="h-5 w-5 text-primary"/>
                            : <Terminal className="h-5 w-5 text-primary"/>
                        }
                        <h2 className="text-lg font-semibold text-foreground">
                            模型配置 — {isClaude ? 'Claude Code' : 'Codex'}
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

                    {isClaude ? (
                        <ClaudeConfigPanel
                            config={claudeConfig}
                            modelTiers={claudeModelTiers}
                            onChange={(updates) => setModelConfig('claude', updates)}
                        />
                    ) : (
                        <CodexConfigPanel
                            config={codexConfig}
                            currentModel={codexModel}
                            onChange={(updates) => setModelConfig('codex', updates)}
                        />
                    )}
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

/** Claude 配置面板 */
function ClaudeConfigPanel({
    config,
    modelTiers,
    onChange,
}: {
    config: {
        model: string;
        extendedThinking: boolean;
        reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
        streaming: boolean;
    };
    modelTiers: Array<{tier: string; label: string; model: string}>;
    onChange: (updates: Partial<typeof config>) => void;
}) {
    return (
        <div className="space-y-4">
            {/* 模型选择 */}
            <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">模型档位</label>
                {modelTiers.length > 0 ? (
                    <select
                        value={config.model}
                        onChange={(e) => onChange({model: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                        {modelTiers.map(t => (
                            <option key={t.tier} value={t.tier}>
                                {t.label} → {t.model}
                            </option>
                        ))}
                    </select>
                ) : (
                    <input
                        type="text"
                        value={config.model}
                        onChange={(e) => onChange({model: e.target.value})}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="未读取到配置，手动输入模型名"
                    />
                )}
                <p className="text-xs text-muted-foreground/70 mt-1.5">
                    来源：~/.claude/settings.json 的 env 模型映射，选中档位由 SDK 解析实际模型
                </p>
            </div>

            {/* 推理强度 */}
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

            {/* 开关组 */}
            <div className="space-y-2">
                <ToggleRow
                    label="扩展思考（Extended Thinking）"
                    description="启用后模型会进行更深入的思考"
                    checked={config.extendedThinking}
                    onChange={(v) => onChange({extendedThinking: v})}
                />
                <ToggleRow
                    label="流式输出（Streaming）"
                    description="启用后实时输出响应内容"
                    checked={config.streaming}
                    onChange={(v) => onChange({streaming: v})}
                />
            </div>
        </div>
    );
}

/** Codex 配置面板 */
function CodexConfigPanel({
    config,
    currentModel,
    onChange,
}: {
    config: {
        model: string;
        streaming: boolean;
    };
    currentModel: string | null;
    onChange: (updates: Partial<typeof config>) => void;
}) {
    return (
        <div className="space-y-4">
            {/* 模型选择 */}
            <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">模型</label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={config.model}
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
                {currentModel && (
                    <p className="text-xs text-muted-foreground/70 mt-1.5">
                        当前 ~/.codex/config.toml 配置：<code className="bg-muted px-1 rounded">{currentModel}</code>
                    </p>
                )}
            </div>

            {/* 流式开关 */}
            <ToggleRow
                label="流式输出（Streaming）"
                description="启用后实时输出响应内容"
                checked={config.streaming}
                onChange={(v) => onChange({streaming: v})}
            />
        </div>
    );
}

/** 开关行组件 */
function ToggleRow({
    label,
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
