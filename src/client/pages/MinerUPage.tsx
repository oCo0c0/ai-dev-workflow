/**
 * @file MinerU 文档解析页面
 * @description 提供文件上传、解析配置、实时状态展示和结果预览的完整交互界面。
 *   解析结果自动持久化到 localStorage，支持查看历史和删除。
 */

import {useState, useEffect, useCallback, useRef} from 'react';
import {cn} from '../lib/utils';
import {Button} from '../components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '../components/ui/card';
import {MarkdownContent} from '../components/MarkdownContent';
import {
    Upload,
    FileText,
    Image as ImageIcon,
    Loader2,
    CheckCircle2,
    XCircle,
    Copy,
    Check,
    Trash2,
    Settings2,
    FileSearch,
    Save,
    History,
    ChevronLeft,
} from 'lucide-react';

// ========== 类型定义 ==========

type Backend = 'pipeline' | 'vlm-auto-engine' | 'vlm-http-client' | 'hybrid-auto-engine' | 'hybrid-http-client';

type TaskPhase = 'idle' | 'uploading' | 'submitting' | 'queued' | 'processing' | 'downloading' | 'completed' | 'failed';

interface ParseResult {
    success: boolean;
    markdown?: string;
    images?: string[];
    error?: string;
    raw?: unknown;
}

/** 持久化的解析记录 */
interface SavedResult {
    id: string;
    fileName: string;
    markdown: string;
    backend: string;
    createdAt: string;
}

interface TaskInfo {
    taskId: string;
    fileName: string;
}

// ========== 常量 ==========

const API_BASE = '/api';
const STORAGE_KEY = 'mineru-saved-results';

const BACKEND_OPTIONS: { value: Backend; label: string; desc: string }[] = [
    {value: 'hybrid-auto-engine', label: 'Hybrid (推荐)', desc: '高精度，支持多语言'},
    {value: 'pipeline', label: 'Pipeline', desc: '通用，无幻觉'},
    {value: 'vlm-auto-engine', label: 'VLM', desc: '高精度，仅中英文'},
    {value: 'hybrid-http-client', label: 'Hybrid Remote', desc: '远程算力'},
    {value: 'vlm-http-client', label: 'VLM Remote', desc: '远程算力，仅中英文'},
];

const LANG_OPTIONS = [
    {value: 'ch', label: '中文/英文/繁体'},
    {value: 'en', label: 'English'},
    {value: 'korean', label: '한국어/English'},
    {value: 'japan', label: '日本語/English'},
    {value: 'chinese_cht', label: '繁體中文/English'},
    {value: 'latin', label: 'Latin (法语/德语/西班牙等)'},
    {value: 'arabic', label: 'العربية/English'},
    {value: 'east_slavic', label: 'Русский/English'},
    {value: 'cyrillic', label: 'Cyrillic (俄/白/乌/塞等)'},
    {value: 'devanagari', label: 'हिन्दी/English'},
];

const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.pptx', '.xlsx'];
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// ========== 持久化工具 ==========

function loadSavedResults(): SavedResult[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveSavedResults(results: SavedResult[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results));
}

// ========== 页面组件 ==========

export default function MinerUPage() {
    // 文件状态
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 解析选项
    const [backend, setBackend] = useState<Backend>('hybrid-auto-engine');
    const [langList, setLangList] = useState<string[]>(['ch']);
    const [formulaEnable, setFormulaEnable] = useState(true);
    const [tableEnable, setTableEnable] = useState(true);
    const [imageAnalysis, setimageAnalysis] = useState(true);
    const [showOptions, setShowOptions] = useState(false);

    // 任务状态
    const [phase, setPhase] = useState<TaskPhase>('idle');
    const [statusText, setStatusText] = useState('');
    const [currentTask, setCurrentTask] = useState<TaskInfo | null>(null);
    const [parseResult, setParseResult] = useState<ParseResult | null>(null);
    const [elapsed, setElapsed] = useState(0);

    // 持久化结果
    const [savedResults, setSavedResults] = useState<SavedResult[]>(loadSavedResults);
    const [viewingSaved, setViewingSaved] = useState<SavedResult | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    // UI 状态
    const [activeTab, setActiveTab] = useState<'rendered' | 'raw'>('rendered');
    const [copied, setCopied] = useState(false);

    // 计时器
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    // ========== 文件处理 ==========

    const validateFile = useCallback((file: File): string | null => {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        if (!ACCEPTED_EXTENSIONS.includes(ext)) return `不支持的文件类型: ${ext}`;
        if (file.size > MAX_FILE_SIZE) return `文件过大: ${(file.size / 1024 / 1024).toFixed(1)}MB (最大 100MB)`;
        return null;
    }, []);

    /** 新文件替换旧文件（单文件模式） */
    const addFiles = useCallback((newFiles: FileList | File[]) => {
        for (const f of Array.from(newFiles)) {
            const err = validateFile(f);
            if (err) {
                setStatusText(err);
                continue;
            }
            // 替换为新文件
            setFiles([f]);
            setStatusText('');
            break; // 只取第一个有效文件
        }
    }, [validateFile]);

    const clearFile = useCallback(() => {
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, []);

    const clearAll = useCallback(() => {
        clearFile();
        setPhase('idle');
        setStatusText('');
        setParseResult(null);
        setCurrentTask(null);
        setElapsed(0);
        setViewingSaved(null);
        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
    }, [clearFile]);

    // ========== 拖拽处理 ==========

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    }, [addFiles]);

    // ========== 解析流程 ==========

    const startParse = useCallback(async () => {
        if (files.length === 0) return;

        setParseResult(null);
        setViewingSaved(null);
        setPhase('uploading');
        setStatusText('正在上传文件...');
        setElapsed(0);

        timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);

        try {
            const formData = new FormData();
            formData.append('files', files[0]);
            formData.append('backend', backend);
            formData.append('parseMethod', 'auto');
            formData.append('formulaEnable', String(formulaEnable));
            formData.append('tableEnable', String(tableEnable));
            formData.append('imageAnalysis', String(imageAnalysis));
            formData.append('returnMd', 'true');
            formData.append('returnImages', 'true');
            formData.append('returnContentList', 'true');
            for (const lang of langList) formData.append('langList', lang);

            setPhase('submitting');
            setStatusText('正在提交解析任务...');

            const submitRes = await fetch(`${API_BASE}/mineru/tasks`, {method: 'POST', body: formData});
            if (!submitRes.ok) {
                const errData = await submitRes.json().catch(() => ({message: '提交失败'}));
                throw new Error(errData.message || '提交任务失败');
            }

            const submitData = await submitRes.json();
            const taskId = submitData.tasks?.[0]?.task_id;
            if (!taskId) throw new Error(submitData.tasks?.[0]?.error || '未获取到任务 ID');

            setCurrentTask({taskId, fileName: files[0].name});
            setPhase('queued');
            setStatusText(`任务已提交: ${taskId.slice(0, 8)}...`);

            pollRef.current = setInterval(async () => {
                try {
                    const statusRes = await fetch(`${API_BASE}/mineru/tasks/${taskId}`);
                    const statusData = await statusRes.json();
                    const st = (statusData.status || '').toLowerCase();

                    if (st === 'completed' || st === 'done' || st === 'success' || st === 'finished') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        setPhase('downloading');
                        setStatusText('正在获取解析结果...');

                        try {
                            const resultRes = await fetch(`${API_BASE}/mineru/tasks/${taskId}/result`);
                            const resultData = await resultRes.json();
                            if (timerRef.current) clearInterval(timerRef.current);
                            setParseResult(resultData);
                            setPhase('completed');
                            setStatusText('解析完成');
                        } catch {
                            if (timerRef.current) clearInterval(timerRef.current);
                            setParseResult({
                                success: true,
                                markdown: statusData.md_content || statusData.markdown || '',
                                raw: statusData
                            });
                            setPhase('completed');
                            setStatusText('解析完成');
                        }
                    } else if (st === 'failed' || st === 'error') {
                        if (pollRef.current) clearInterval(pollRef.current);
                        if (timerRef.current) clearInterval(timerRef.current);
                        setPhase('failed');
                        setStatusText(statusData.message || statusData.error || '解析失败');
                    } else if (st === 'processing' || st === 'running') {
                        setPhase('processing');
                        setStatusText(`正在解析中... (${elapsed}s)`);
                    } else {
                        setPhase('queued');
                        setStatusText(`排队中... (${elapsed}s)`);
                    }
                } catch (err) {
                    console.error('Poll error:', err);
                }
            }, 2000);
        } catch (err) {
            if (timerRef.current) clearInterval(timerRef.current);
            setPhase('failed');
            setStatusText(err instanceof Error ? err.message : '未知错误');
        }
    }, [files, backend, langList, formulaEnable, tableEnable, imageAnalysis, elapsed]);

    // ========== 结果持久化 ==========

    /** 固化当前结果到 localStorage */
    const saveResult = useCallback(() => {
        if (!parseResult?.markdown || !currentTask) return;
        const record: SavedResult = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            fileName: currentTask.fileName,
            markdown: parseResult.markdown,
            backend,
            createdAt: new Date().toISOString(),
        };
        const updated = [record, ...savedResults];
        setSavedResults(updated);
        saveSavedResults(updated);
        setViewingSaved(record);
    }, [parseResult, currentTask, backend, savedResults]);

    /** 删除已保存结果 */
    const deleteSavedResult = useCallback((id: string) => {
        const updated = savedResults.filter(r => r.id !== id);
        setSavedResults(updated);
        saveSavedResults(updated);
        if (viewingSaved?.id === id) setViewingSaved(null);
    }, [savedResults, viewingSaved]);

    /** 查看已保存结果 */
    const viewSaved = useCallback((result: SavedResult) => {
        setViewingSaved(result);
        setParseResult({success: true, markdown: result.markdown});
        setPhase('completed');
        setStatusText('');
    }, []);

    // 复制 Markdown
    const copyMarkdown = useCallback(async () => {
        const md = parseResult?.markdown || viewingSaved?.markdown;
        if (!md) return;
        await navigator.clipboard.writeText(md);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [parseResult, viewingSaved]);

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    };

    // 当前展示的 markdown
    const displayMarkdown = parseResult?.markdown || viewingSaved?.markdown || '';
    const isParsing = phase === 'uploading' || phase === 'submitting' || phase === 'queued' || phase === 'processing' || phase === 'downloading';

    // ========== 渲染 ==========

    return (
        <div className="flex h-full">
            {/* ===== 左侧面板：上传 + 配置 + 历史 ===== */}
            <div className="w-[420px] border-r border-border/50 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* 文件上传区域 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Upload className="h-4 w-4"/>
                                文件上传
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={cn(
                                    'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                                    isDragging
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border hover:border-primary/50 hover:bg-accent/30',
                                )}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPTED_EXTENSIONS.join(',')}
                                    className="hidden"
                                    onChange={(e) => {
                                        if (e.target.files) addFiles(e.target.files);
                                        // 重置 input value 以便同一文件可再次选择
                                        e.target.value = '';
                                    }}
                                />
                                <FileSearch className="h-8 w-8 mx-auto mb-2 text-muted-foreground"/>
                                <p className="text-sm text-muted-foreground">
                                    拖拽文件到此处，或点击选择
                                </p>
                                <p className="text-xs text-muted-foreground/60 mt-1">
                                    支持 PDF、图片、DOCX、PPTX、XLSX
                                </p>
                            </div>

                            {/* 已选文件 */}
                            {files.length > 0 && (
                                <div className="mt-3 flex items-center gap-2 text-sm bg-accent/30 rounded-lg px-3 py-2">
                                    {files[0].type.startsWith('image/') ? (
                                        <ImageIcon className="h-3.5 w-3.5 text-blue-400 shrink-0"/>
                                    ) : (
                                        <FileText className="h-3.5 w-3.5 text-orange-400 shrink-0"/>
                                    )}
                                    <span className="truncate flex-1">{files[0].name}</span>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {(files[0].size / 1024).toFixed(0)}KB
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            clearFile();
                                        }}
                                        className="text-muted-foreground hover:text-destructive shrink-0"
                                        title="移除文件"
                                    >
                                        <XCircle className="h-3.5 w-3.5"/>
                                    </button>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* 解析配置 */}
                    <Card>
                        <CardHeader className="pb-3">
                            <div
                                className="flex items-center justify-between cursor-pointer"
                                onClick={() => setShowOptions(!showOptions)}
                            >
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Settings2 className="h-4 w-4"/>
                                    解析配置
                                </CardTitle>
                                <span className="text-xs text-muted-foreground">
                                    {showOptions ? '收起' : '展开'}
                                </span>
                            </div>
                        </CardHeader>
                        {showOptions && (
                            <CardContent className="space-y-3">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">解析后端</label>
                                    <div className="space-y-1">
                                        {BACKEND_OPTIONS.map(opt => (
                                            <label
                                                key={opt.value}
                                                className={cn(
                                                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition-colors',
                                                    backend === opt.value
                                                        ? 'bg-primary/10 text-primary border border-primary/20'
                                                        : 'hover:bg-accent/50 border border-transparent',
                                                )}
                                            >
                                                <input
                                                    type="radio"
                                                    name="backend"
                                                    value={opt.value}
                                                    checked={backend === opt.value}
                                                    onChange={() => setBackend(opt.value)}
                                                    className="sr-only"
                                                />
                                                <span className="font-medium">{opt.label}</span>
                                                <span className="text-muted-foreground">{opt.desc}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs text-muted-foreground mb-1 block">OCR 语言</label>
                                    <select
                                        value={langList[0]}
                                        onChange={(e) => setLangList([e.target.value])}
                                        className="w-full bg-card border border-border rounded-lg px-3 py-1.5 text-sm"
                                    >
                                        {LANG_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <ToggleOption label="公式识别" checked={formulaEnable} onChange={setFormulaEnable}/>
                                    <ToggleOption label="表格识别" checked={tableEnable} onChange={setTableEnable}/>
                                    <ToggleOption label="图片分析" checked={imageAnalysis} onChange={setimageAnalysis}/>
                                </div>
                            </CardContent>
                        )}
                    </Card>

                    {/* 操作按钮 */}
                    <div className="flex gap-2">
                        <Button
                            onClick={startParse}
                            disabled={files.length === 0 || isParsing}
                            className="flex-1"
                        >
                            {isParsing ? (
                                <><Loader2 className="h-4 w-4 mr-2 animate-spin"/>解析中...</>
                            ) : (
                                <><FileSearch className="h-4 w-4 mr-2"/>开始解析</>
                            )}
                        </Button>
                        {phase === 'completed' && parseResult?.markdown && !viewingSaved && (
                            <Button variant="outline" onClick={saveResult} title="保存结果">
                                <Save className="h-4 w-4"/>
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            onClick={clearAll}
                            disabled={isParsing}
                        >
                            <Trash2 className="h-4 w-4"/>
                        </Button>
                    </div>

                    {/* 状态信息 */}
                    {phase !== 'idle' && phase !== 'completed' && (
                        <div className={cn(
                            'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
                            phase === 'failed' && 'bg-red-500/10 text-red-400',
                            phase !== 'failed' && 'bg-primary/10 text-primary',
                        )}>
                            {phase === 'failed' ? (
                                <XCircle className="h-4 w-4 shrink-0"/>
                            ) : (
                                <Loader2 className="h-4 w-4 shrink-0 animate-spin"/>
                            )}
                            <span className="flex-1">{statusText}</span>
                            {isParsing && <span className="text-xs opacity-60">{formatTime(elapsed)}</span>}
                        </div>
                    )}
                    {phase === 'completed' && currentTask && !viewingSaved && (
                        <div
                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-emerald-500/10 text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 shrink-0"/>
                            <span className="flex-1">解析完成 — {currentTask.fileName}</span>
                        </div>
                    )}

                    {/* 历史记录 */}
                    {savedResults.length > 0 && (
                        <Card>
                            <CardHeader className="pb-2">
                                <div
                                    className="flex items-center justify-between cursor-pointer"
                                    onClick={() => setShowHistory(!showHistory)}
                                >
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <History className="h-4 w-4"/>
                                        已保存记录 ({savedResults.length})
                                    </CardTitle>
                                    <span className="text-xs text-muted-foreground">
                                        {showHistory ? '收起' : '展开'}
                                    </span>
                                </div>
                            </CardHeader>
                            {showHistory && (
                                <CardContent className="space-y-1.5">
                                    {savedResults.map(result => (
                                        <div
                                            key={result.id}
                                            className={cn(
                                                'flex items-center gap-2 text-sm rounded-lg px-3 py-2 cursor-pointer transition-colors group',
                                                viewingSaved?.id === result.id
                                                    ? 'bg-primary/10 text-primary'
                                                    : 'hover:bg-accent/50',
                                            )}
                                            onClick={() => viewSaved(result)}
                                        >
                                            <FileText className="h-3.5 w-3.5 shrink-0"/>
                                            <div className="flex-1 min-w-0">
                                                <p className="truncate text-xs font-medium">{result.fileName}</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {new Date(result.createdAt).toLocaleString('zh-CN')}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteSavedResult(result.id);
                                                }}
                                                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                title="删除"
                                            >
                                                <Trash2 className="h-3 w-3"/>
                                            </button>
                                        </div>
                                    ))}
                                </CardContent>
                            )}
                        </Card>
                    )}
                </div>
            </div>

            {/* ===== 右侧面板：结果展示 ===== */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {(displayMarkdown || parseResult?.error) ? (
                    <>
                        {/* 结果标签页 */}
                        <div className="flex items-center gap-1 px-5 pt-4 pb-2 border-b border-border/50">
                            {/* 查看历史记录时显示返回按钮 */}
                            {viewingSaved && (
                                <button
                                    onClick={() => {
                                        setViewingSaved(null);
                                        setParseResult(null);
                                        setPhase('idle');
                                    }}
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mr-2"
                                >
                                    <ChevronLeft className="h-3.5 w-3.5"/>
                                    返回
                                </button>
                            )}
                            <button
                                className={cn(
                                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                                    activeTab === 'rendered'
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                                onClick={() => setActiveTab('rendered')}
                            >
                                Markdown 渲染
                            </button>
                            <button
                                className={cn(
                                    'px-3 py-1.5 text-sm rounded-lg transition-colors',
                                    activeTab === 'raw'
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'text-muted-foreground hover:text-foreground',
                                )}
                                onClick={() => setActiveTab('raw')}
                            >
                                原始 Markdown
                            </button>
                            <div className="flex-1"/>
                            {viewingSaved && (
                                <span className="text-xs text-muted-foreground mr-2">
                                    {viewingSaved.fileName}
                                </span>
                            )}
                            <Button variant="ghost" size="sm" onClick={copyMarkdown} className="text-xs">
                                {copied ? <Check className="h-3.5 w-3.5 mr-1"/> : <Copy className="h-3.5 w-3.5 mr-1"/>}
                                {copied ? '已复制' : '复制'}
                            </Button>
                        </div>

                        {/* 结果内容 */}
                        <div className="flex-1 overflow-y-auto p-5">
                            {parseResult?.error ? (
                                <div className="bg-red-500/10 text-red-400 rounded-lg p-4 text-sm">
                                    <p className="font-medium mb-1">解析失败</p>
                                    <p className="text-red-300">{parseResult.error}</p>
                                </div>
                            ) : activeTab === 'rendered' ? (
                                <MarkdownContent content={displayMarkdown} className="min-h-0"/>
                            ) : (
                                <pre
                                    className="text-sm bg-muted/30 border border-border rounded-lg p-4 whitespace-pre-wrap break-words font-mono leading-relaxed">
                                    {displayMarkdown}
                                </pre>
                            )}

                            {parseResult?.images && parseResult.images.length > 0 && (
                                <div className="mt-6">
                                    <h3 className="text-sm font-medium mb-3 text-muted-foreground">
                                        提取的图片 ({parseResult.images.length})
                                    </h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        {parseResult.images.map((img, i) => (
                                            <div key={i} className="rounded-lg border border-border overflow-hidden">
                                                <img
                                                    src={img.startsWith('data:') ? img : `data:image/png;base64,${img}`}
                                                    alt={`Image ${i + 1}`}
                                                    className="w-full h-auto"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-muted-foreground">
                            <FileSearch className="h-12 w-12 mx-auto mb-3 opacity-30"/>
                            <p className="text-sm">上传文件并开始解析</p>
                            <p className="text-xs mt-1 opacity-60">
                                支持 PDF、图片、Office 文档，解析结果将展示在此处
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ========== 子组件 ==========

function ToggleOption({label, checked, onChange}: {
    label: string;
    checked: boolean;
    onChange: (val: boolean) => void;
}) {
    return (
        <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={cn(
                    'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                    checked ? 'bg-primary' : 'bg-muted',
                )}
            >
                <span
                    className={cn(
                        'inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform',
                        checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
                    )}
                />
            </button>
        </label>
    );
}
