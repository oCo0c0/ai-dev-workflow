/**
 * @file VoiceButton.tsx
 * @description 输入框工具栏的语音输入按钮：MediaRecorder 录音（audio/webm 优先），点击停止后
 *   组装 blob 经 POST /api/asr/transcribe（OpenAI 兼容 /audio/transcriptions 转发）转写，
 *   识别文本通过 onText 回传给 ChatInputBox 追加进输入框。
 *   三态：idle / recording（红色 pulse）/ transcribing（spinner）；
 *   麦克风不可用时提示 micDenied；错误行内红字展示并 3.5s 自动清除。
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Loader2, Mic} from 'lucide-react';
import {apiPostForm} from '../../api';

/** 错误提示自动清除时长（ms） */
const ERROR_TTL_MS = 3500;

export function VoiceButton({onText, disabled}: { onText: (text: string) => void; disabled?: boolean }) {
    const {t} = useTranslation();
    const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
    const [error, setError] = useState<string | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /** 行内展示错误，3.5s 后自动清除 */
    const showError = (msg: string) => {
        setError(msg);
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        errorTimerRef.current = setTimeout(() => setError(null), ERROR_TTL_MS);
    };

    // 卸载时清理：错误定时器 + 停止录音与麦克风流（摘掉 onstop，避免卸载后再触发转写）
    useEffect(() => () => {
        if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
        const recorder = recorderRef.current;
        if (recorder) recorder.onstop = null;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        streamRef.current?.getTracks().forEach(track => track.stop());
    }, []);

    const stopAndTranscribe = useCallback(async () => {
        const recorder = recorderRef.current;
        if (!recorder) return;
        recorder.stop(); // onstop 里组装 blob 并转写
    }, []);

    const start = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({audio: true});
            streamRef.current = stream;
            const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
            const recorder = new MediaRecorder(stream, mime ? {mimeType: mime} : undefined);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                setState('transcribing');
                try {
                    const blob = new Blob(chunksRef.current, {type: recorder.mimeType || 'audio/webm'});
                    const fd = new FormData();
                    fd.append('audio', blob, 'speech.webm');
                    const res = await apiPostForm<{text: string}>('/asr/transcribe', fd);
                    if (res.text?.trim()) onText(res.text.trim());
                } catch (err) {
                    showError(err instanceof Error ? err.message : String(err));
                } finally {
                    setState('idle');
                    recorderRef.current = null;
                }
            };
            recorder.start();
            recorderRef.current = recorder;
            setState('recording');
        } catch {
            showError(t('common.chatInput.micDenied'));
            setState('idle');
        }
    };

    return (
        <>
            <button
                type="button"
                onClick={() => (state === 'recording' ? void stopAndTranscribe() : state === 'idle' && start())}
                disabled={disabled || state === 'transcribing'}
                title={t('common.chatInput.voice')}
                aria-label={t('common.chatInput.voice')}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:opacity-40 disabled:pointer-events-none
                    ${state === 'recording'
                        ? 'bg-destructive/10 text-destructive animate-pulse'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            >
                {state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin"/> : <Mic className="h-4 w-4"/>}
            </button>
            {error && <span className="text-[11px] text-destructive">{error}</span>}
        </>
    );
}
