/**
 * @file AttachmentButton.tsx
 * @description 输入框工具栏的附件上传按钮：多选文件逐个经 POST /api/chat-attachments/upload
 *   （MinerU 解析为 markdown 暂存，返回 attachmentId）后通过 onUploaded 回传，
 *   由 ChatInputBox 追加为附件 chips。上传中显示 spinner；错误行内红字展示并 3.5s 自动清除。
 */

import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2, Paperclip} from 'lucide-react';
import {apiPostForm} from '../../api';
import type {PendingAttachment} from '../ChatInputBox';

/** 可解析的附件类型：文本/代码直接读取、Excel 表格解析，其余交给 MinerU */
const ACCEPT = [
    '.pdf', '.docx', '.pptx', '.xlsx',
    '.png', '.jpg', '.jpeg', '.webp', '.bmp',
    '.txt', '.md', '.json', '.csv', '.tsv', '.log', '.xml', '.yml', '.yaml', '.ini', '.toml', '.sql',
    '.java', '.py', '.js', '.jsx', '.ts', '.tsx', '.vue', '.go', '.rs', '.c', '.h', '.cpp', '.cs', '.php',
    '.rb', '.kt', '.swift', '.scala', '.sh', '.bat', '.ps1', '.html', '.css', '.scss',
].join(',');
/** 错误提示自动清除时长（ms） */
const ERROR_TTL_MS = 3500;

export function AttachmentButton({onUploaded, disabled}: {
    onUploaded: (att: PendingAttachment) => void;
    disabled?: boolean;
}) {
    const {t} = useTranslation();
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** 行内展示错误，3.5s 后自动清除 */
    const showError = (msg: string) => {
        setError(msg);
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(null), ERROR_TTL_MS);
    };

    // 卸载时清理错误自动清除的定时器
    useEffect(() => () => {
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    }, []);

    const handleFiles = async (files: FileList | null) => {
        if (!files?.length) return;
        setUploading(true);
        setError(null);
        try {
            for (const file of Array.from(files)) {
                const fd = new FormData();
                fd.append('file', file);
                const res = await apiPostForm<PendingAttachment>('/chat-attachments/upload', fd);
                onUploaded(res);
            }
        } catch (err) {
            showError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                className="sr-only"
                multiple
                accept={ACCEPT}
                onChange={(e) => void handleFiles(e.target.files)}
            />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || uploading}
                title={t('common.chatInput.attach')}
                aria-label={t('common.chatInput.attach')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin"/> : <Paperclip className="h-4 w-4"/>}
            </button>
            {error && (
                <span className="text-[11px] text-destructive max-w-40 truncate" title={error}>{error}</span>
            )}
        </>
    );
}
