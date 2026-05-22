/**
 * @file CLI Provider 引导弹窗
 * @description 首次启动时检测本地已安装的 CLI（Claude Code / OpenAI Codex），
 *   让用户选择使用哪个 CLI 后端。选择后持久化配置并初始化连接。
 */

import {useState, useEffect} from 'react';
import {apiGet, apiPost} from '../api';
import {X, Check, Loader2, Terminal, Bot} from 'lucide-react';
import {Button} from './ui/button';

/** 检测到的 Provider 状态 */
interface DetectedProvider {
    id: string;
    label: string;
    available: boolean;
    version?: string;
    path?: string;
    error?: string;
}

/** Provider 状态查询响应 */
interface ProviderStatusResponse {
    configured: boolean;
    active: string;
    detected: DetectedProvider[];
}

/** 选择响应 */
interface SelectResponse {
    success: boolean;
    provider: { id: string; label: string };
}

interface ProviderSetupModalProps {
    open: boolean;
    onClose: () => void;
    onSelected?: (providerId: string) => void;
}

export function ProviderSetupModal({open, onClose, onSelected}: ProviderSetupModalProps) {
    const [detected, setDetected] = useState<DetectedProvider[]>([]);
    const [loading, setLoading] = useState(true);
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // 加载检测到的 Provider 列表
    useEffect(() => {
        if (!open) return;
        setLoading(true);
        setError(null);
        apiGet<ProviderStatusResponse>('/system/cli-provider/status')
            .then((data) => {
                setDetected(data.detected);
                // 如果已配置过，直接关闭
                if (data.configured) {
                    onSelected?.(data.active);
                    onClose();
                }
            })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [open, onClose, onSelected]);

    const handleSelect = async () => {
        if (!selected) return;
        setSelecting(true);
        setError(null);
        try {
            await apiPost<SelectResponse>('/system/cli-provider/select', {providerId: selected});
            onSelected?.(selected);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSelecting(false);
        }
    };

    if (!open) return null;

    const availableCount = detected.filter(p => p.available).length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg mx-4">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">选择 CLI 工具</h2>
                    <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
                        <X className="h-4 w-4"/>
                    </Button>
                </div>

                {/* 内容 */}
                <div className="px-6 py-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                        检测到以下 CLI 工具，请选择一个作为默认后端。
                        你可以随时在设置中切换。
                    </p>

                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground"/>
                            <span className="ml-2 text-sm text-muted-foreground">正在检测...</span>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {detected.map((provider) => (
                                <ProviderCard
                                    key={provider.id}
                                    provider={provider}
                                    selected={selected === provider.id}
                                    onSelect={() => provider.available && setSelected(provider.id)}
                                />
                            ))}
                        </div>
                    )}

                    {error && (
                        <p className="text-sm text-red-500">{error}</p>
                    )}
                </div>

                {/* 底部按钮 */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
                    <Button variant="outline" onClick={onClose} disabled={selecting}>
                        稍后配置
                    </Button>
                    <Button
                        onClick={handleSelect}
                        disabled={!selected || selecting || availableCount === 0}
                    >
                        {selecting && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                        确认选择
                    </Button>
                </div>
            </div>
        </div>
    );
}

/** 单个 Provider 卡片 */
function ProviderCard(
    {provider, selected, onSelect}: {
        provider: DetectedProvider;
        selected: boolean;
        onSelect: () => void;
    }
) {
    const icon = provider.id === 'claude' ? <Bot className="h-5 w-5"/> : <Terminal className="h-5 w-5"/>;

    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={!provider.available}
            className={`w-full text-left p-4 rounded-lg border transition-colors ${
                selected
                    ? 'border-primary bg-primary/10'
                    : provider.available
                        ? 'border-border hover:border-primary/50 hover:bg-muted/50'
                        : 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
            }`}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-md ${selected ? 'bg-primary/20' : 'bg-muted'}`}>
                        {icon}
                    </div>
                    <div>
                        <div className="font-medium text-foreground">{provider.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                            {provider.available
                                ? provider.version
                                    ? `${provider.version} — ${provider.path ?? '已检测到'}`
                                    : '已安装'
                                : provider.error ?? '未安装'}
                        </div>
                    </div>
                </div>
                {selected && <Check className="h-5 w-5 text-primary"/>}
            </div>
        </button>
    );
}
