/**
 * 通用执行/测试状态图标。
 * 用法：`<StatusIcon status="running" />` 或 `<StatusIcon status="paused" defaultIcon={<TestTube .../>} />`
 */
import {CheckCircle2, XCircle, Loader2, AlertCircle, Square, Terminal} from 'lucide-react';

export type CommonStatus = 'running' | 'paused' | 'completed' | 'failed' | 'aborted' | string;

interface StatusIconProps {
    status: CommonStatus;
    /** 自定义 default 分支图标（如 TestsPage 用 TestTube） */
    defaultIcon?: React.ReactNode;
}

export function StatusIcon({status, defaultIcon}: StatusIconProps) {
    switch (status) {
        case 'completed':
            return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500"/>;
        case 'failed':
            return <XCircle className="h-3.5 w-3.5 text-destructive"/>;
        case 'running':
            return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin"/>;
        case 'paused':
            return <AlertCircle className="h-3.5 w-3.5 text-yellow-500"/>;
        case 'aborted':
            return <Square className="h-3.5 w-3.5 text-muted-foreground"/>;
        default:
            return defaultIcon ?? <Terminal className="h-3.5 w-3.5 text-muted-foreground"/>;
    }
}
