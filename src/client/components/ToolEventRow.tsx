/**
 * @file ToolEventRow.tsx
 * @description 工具调用事件行 —— 完全对齐 DeepSeek Harness 的 ToolRow + 专属卡片设计。
 *
 *   折叠态：单行「[图标|状态] 标题 · 摘要」，每个工具都有专属图标与标题，
 *   摘要从参数挑关键字段（command / file_path / query / pattern…）；
 *   运行中 = 转圈，失败 = 红点 + 摘要替换为错误首行。
 *
 *   展开态：按变体渲染 DSH 同款专属卡片：
 *   - bash    → 终端卡（深色 mono：$ 命令 + 输出）
 *   - write/edit → Diff 卡（- 红 / + 绿 的差异行，从参数合成）
 *   - read    → 读取卡（行号 + 文件内容窗口）
 *   - search  → 搜索卡（模式 + 命中行）
 *   - web     → 网页卡（URL + 抓取结果）
 *   - 其余    → IN/OUT 卡（参数与结果并排分区）
 *   所有卡片限高内滚，默认折叠，保持消息流可扫读。
 */

import {useState} from 'react';
import {
    AlertTriangle,
    Bot,
    ChevronDown,
    FilePen,
    FileText,
    FolderSearch,
    Globe,
    ListTodo,
    Loader2,
    Plug,
    Search,
    Terminal,
    XCircle,
    type LucideIcon,
} from 'lucide-react';
import {cn} from '../lib/utils';

// ── 变体与图标（镜像 DSH tool-call-model 的变体分类） ──

export type ToolVariant = 'bash' | 'read' | 'edit' | 'search' | 'web' | 'task' | 'todo' | 'mcp' | 'others';

/** 单个工具的专属元数据：变体 + 标题 + 图标（每个步骤对应的图标） */
interface ToolMeta {
    variant: ToolVariant;
    title: string;
    icon: LucideIcon;
}

/** 已知工具 → 专属图标/标题（未列出的 mcp__ 前缀归 MCP，其余归通用 wrench） */
const TOOL_META: Record<string, ToolMeta> = {
    // 终端 / Shell
    Bash: {variant: 'bash', title: '终端', icon: Terminal},
    PowerShell: {variant: 'bash', title: '终端', icon: Terminal},
    // 文件读取
    Read: {variant: 'read', title: '读取文件', icon: FileText},
    NotebookRead: {variant: 'read', title: '读取 Notebook', icon: FileText},
    // 文件写入 / 编辑（Diff 卡）
    Write: {variant: 'edit', title: '写入文件', icon: FilePen},
    Edit: {variant: 'edit', title: '编辑文件', icon: FilePen},
    MultiEdit: {variant: 'edit', title: '多处编辑', icon: FilePen},
    NotebookEdit: {variant: 'edit', title: '编辑 Notebook', icon: FilePen},
    // 搜索
    Grep: {variant: 'search', title: '内容搜索', icon: Search},
    Glob: {variant: 'search', title: '文件匹配', icon: FolderSearch},
    LS: {variant: 'search', title: '列出目录', icon: FolderSearch},
    ToolSearch: {variant: 'search', title: '工具搜索', icon: Search},
    // 网络
    WebSearch: {variant: 'web', title: '网页搜索', icon: Globe},
    WebFetch: {variant: 'web', title: '网页抓取', icon: Globe},
    // 子任务 / 待办
    Task: {variant: 'task', title: '子任务', icon: Bot},
    Agent: {variant: 'task', title: '子代理', icon: Bot},
    TodoWrite: {variant: 'todo', title: '更新待办', icon: ListTodo},
    TaskCreate: {variant: 'todo', title: '创建任务', icon: ListTodo},
    TaskUpdate: {variant: 'todo', title: '更新任务', icon: ListTodo},
    TaskList: {variant: 'todo', title: '任务列表', icon: ListTodo},
    TaskGet: {variant: 'todo', title: '查询任务', icon: ListTodo},
    TaskStop: {variant: 'todo', title: '停止任务', icon: ListTodo},
};

const FALLBACK_META: ToolMeta = {variant: 'others', title: '工具调用', icon: Plug};

/** 工具名 → 专属元数据（mcp__ 前缀优先，标题带真实工具名） */
export function toolMetaOf(toolName: string): ToolMeta {
    if (toolName.startsWith('mcp__')) {
        // mcp__server__tool → 展示 server · tool
        const parts = toolName.split('__');
        const short = parts.length >= 3 ? `${parts[1]} · ${parts.slice(2).join('__')}` : toolName;
        return {variant: 'mcp', title: `MCP ${short}`, icon: Plug};
    }
    return TOOL_META[toolName] ?? FALLBACK_META;
}

/** 向后兼容的变体分类（旧导出） */
export function classifyTool(toolName: string): ToolVariant {
    return toolMetaOf(toolName).variant;
}

// ── 摘要与参数解析 ──

/** 摘要取材键（按变体优先级，镜像 DSH SUMMARY_KEYS） */
const SUMMARY_KEYS: Record<ToolVariant, readonly string[]> = {
    bash: ['description', 'command'],
    read: ['path', 'file_path', 'url'],
    edit: ['path', 'file_path'],
    search: ['query', 'pattern', 'url'],
    web: ['url', 'query'],
    task: ['description', 'prompt'],
    todo: [],
    mcp: [],
    others: [],
};

function firstLine(text: string): string {
    const nl = text.indexOf('\n');
    return nl === -1 ? text : text.slice(0, nl);
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
    for (const key of keys) {
        const v = args[key];
        if (typeof v === 'string' && v !== '') return v;
    }
    return undefined;
}

/** 安全解析参数 JSON（可能被截断），失败返回 undefined */
function parseArgs(inputJson?: string): Record<string, unknown> | undefined {
    if (!inputJson) return undefined;
    try {
        const parsed = JSON.parse(inputJson);
        return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

/** 从工具名 + 参数 JSON 派生单行摘要（镜像 DSH deriveSummary） */
export function summarizeToolArgs(toolName: string, inputJson?: string): string {
    const args = parseArgs(inputJson);
    if (!args) return inputJson ? firstLine(inputJson) : '';
    const meta = toolMetaOf(toolName);
    const picked = pickString(args, SUMMARY_KEYS[meta.variant]);
    if (picked !== undefined) return firstLine(picked);
    for (const v of Object.values(args)) {
        if (typeof v === 'string' && v !== '') return firstLine(v);
    }
    return inputJson ? firstLine(inputJson) : '';
}

// ── Diff 合成（write/edit 专属卡片材料） ──

interface DiffLine {
    sign: '+' | '-' | ' ';
    text: string;
}

/** 从工具参数合成 diff 行：Write 全 +；Edit 取 -old/+new；MultiEdit 逐组展开 */
function buildDiffLines(toolName: string, args?: Record<string, unknown>): DiffLine[] {
    const lines: DiffLine[] = [];
    const pushSide = (sign: '+' | '-', text?: unknown) => {
        if (typeof text !== 'string' || text === '') return;
        for (const l of text.split('\n')) lines.push({sign, text: l});
    };
    if (toolName === 'Write') {
        pushSide('+', args?.content);
    } else if (toolName === 'Edit') {
        pushSide('-', args?.old_string);
        pushSide('+', args?.new_string);
    } else if (toolName === 'MultiEdit' && Array.isArray(args?.edits)) {
        for (const edit of args.edits as Array<Record<string, unknown>>) {
            pushSide('-', edit?.old_string);
            pushSide('+', edit?.new_string);
        }
    } else if (toolName === 'NotebookEdit') {
        pushSide('+', args?.new_source);
    }
    return lines;
}

/** 读取卡的行号窗口（结果文本 → 行号 + 内容） */
function buildNumberedLines(text: string): Array<{no: number; text: string}> {
    return text.split('\n').map((l, i) => ({no: i + 1, text: l}));
}

// ── 组件 ──

/** 工具事件行数据（由 LogMessage.tool 传入） */
export interface ToolEventInfo {
    /** 工具名（如 Bash / Edit / mcp__ones-api__xxx） */
    name: string;
    /** 参数 JSON 文本（可截断），展开卡片使用 */
    input?: string;
    /** 工具结果文本（配对的 tool_result 填充） */
    result?: string;
    /**
     * 运行状态：
     * - running：tool_use 已发出、结果未到（转圈）
     * - ok / error：已配对到结果
     * - stopped：未拿到工具真实结果 —— 由服务端补写的合成结果（中断/轮末未返回）
     *   或 useParsedLogs 的 finalizeRunning 兜底置入，避免永远转圈
     */
    state: 'running' | 'ok' | 'error' | 'stopped';
    /** stopped 的原因：interrupted（用户中断本轮）/ unsettled（轮末仍未返回） */
    stopReason?: 'interrupted' | 'unsettled';
}

export function ToolEventRow({tool}: { tool: ToolEventInfo }) {
    const [expanded, setExpanded] = useState(false);
    const meta = toolMetaOf(tool.name);
    const Icon = meta.icon;
    const isError = tool.state === 'error';
    const isStopped = tool.state === 'stopped';
    const args = parseArgs(tool.input);

    // 失败行的折叠摘要就是失败本身：错误首行（红色）替换参数摘要
    const errorLine = isError && tool.result ? firstLine(tool.result) : null;
    const summary = summarizeToolArgs(tool.name, tool.input);
    const summaryText = errorLine ?? summary;

    // 展开材料（按变体派生专属卡片）
    const diffLines = meta.variant === 'edit' ? buildDiffLines(tool.name, args) : [];
    const bashCommand = meta.variant === 'bash'
        ? pickString(args ?? {}, ['command']) ?? (typeof args?.script === 'string' ? args.script : undefined)
        : undefined;
    const webUrl = meta.variant === 'web' ? pickString(args ?? {}, ['url']) : undefined;
    const searchPattern = meta.variant === 'search'
        ? pickString(args ?? {}, ['pattern', 'query']) ?? firstLine(tool.input ?? '')
        : undefined;
    const readLines = meta.variant === 'read' && tool.result ? buildNumberedLines(tool.result) : [];

    const expandable = !!tool.input || !!tool.result;

    return (
        <div>
            {/* ── 折叠态：单行摘要 ── */}
            <button
                type="button"
                onClick={() => expandable && setExpanded(v => !v)}
                className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors',
                    isError
                        ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10'
                        : isStopped
                            ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                            : 'border-border/50 bg-muted/20 hover:bg-muted/40',
                    !expandable && 'cursor-default',
                )}
                data-variant={meta.variant}
                data-tool={tool.name}
                data-state={tool.state}
            >
                {/* 状态槽：running 转圈 / error 红叉 / stopped 琥珀告警 / 成功显示该工具的专属图标 */}
                {tool.state === 'running'
                    ? <Loader2 className="h-3.5 w-3.5 shrink-0 text-blue-500 animate-spin"/>
                    : isError
                        ? <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive"/>
                        : isStopped
                            ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500"/>
                            : <Icon className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400"/>}
                <span className="shrink-0 text-[11px] font-semibold text-foreground/90">{meta.title}</span>
                <span className="h-0.5 w-0.5 rounded-full bg-muted-foreground/40 shrink-0" aria-hidden/>
                <span
                    className={cn(
                        'flex-1 min-w-0 truncate text-[11px] font-mono',
                        isError ? 'text-destructive' : isStopped ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                >
                    {summaryText || tool.name}
                </span>
                {isStopped && (
                    <span className="shrink-0 text-[10px] text-amber-600 dark:text-amber-400">
                        {tool.stopReason === 'interrupted' ? '已中断' : '未返回结果'}
                    </span>
                )}
                {expandable && (
                    <ChevronDown
                        className={cn(
                            'h-3 w-3 shrink-0 text-muted-foreground transition-transform',
                            expanded && 'rotate-180',
                        )}
                    />
                )}
            </button>

            {/* ── 展开态：变体专属卡片 ── */}
            {expanded && expandable && (
                <div className="mx-1 mt-1 rounded-lg border border-border/50 overflow-hidden">
                    {/* 终端卡：$ 命令 + 输出（配色跟随代码主题 --code-*） */}
                    {meta.variant === 'bash' && (
                        <div className="bg-[hsl(var(--code-bg))] max-h-[260px] overflow-y-auto">
                            {bashCommand && (
                                <div className="flex items-start gap-1.5 px-3 pt-2 font-mono text-[10px] leading-relaxed">
                                    <span className="text-emerald-400 shrink-0 select-none">$</span>
                                    <span className="text-[hsl(var(--code-fg))] break-all">{bashCommand}</span>
                                </div>
                            )}
                            {tool.result && (
                                <pre
                                    className={cn(
                                        'px-3 pb-2 pt-1 text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed',
                                        isError ? 'text-[hsl(var(--code-del-fg))]' : 'text-[hsl(var(--code-fg))]/85',
                                        !bashCommand && 'pt-2',
                                    )}
                                >
                                    {tool.result}
                                </pre>
                            )}
                            {!bashCommand && !tool.result && tool.input && <JsonInBlock input={tool.input}/>}
                        </div>
                    )}

                    {/* Diff 卡：- 红 / + 绿（write / edit / multiedit；配色跟随代码主题） */}
                    {meta.variant === 'edit' && diffLines.length > 0 && (
                        <div className="max-h-[260px] overflow-y-auto bg-[hsl(var(--code-bg))]">
                            <div className="px-3 py-1.5 border-b border-[hsl(var(--code-border))] font-mono text-[10px] text-[hsl(var(--code-muted))] truncate">
                                {pickString(args ?? {}, ['path', 'file_path']) ?? tool.name}
                            </div>
                            <pre className="py-1 font-mono text-[10px] leading-[1.5]">
                                {diffLines.slice(0, 400).map((l, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'px-3 whitespace-pre-wrap break-all',
                                            l.sign === '+' && 'bg-[hsl(var(--code-add-bg))] text-[hsl(var(--code-add-fg))]',
                                            l.sign === '-' && 'bg-[hsl(var(--code-del-bg))] text-[hsl(var(--code-del-fg))]',
                                            l.sign === ' ' && 'text-[hsl(var(--code-fg))]/80',
                                        )}
                                    >
                                        <span className="select-none opacity-60">{l.sign} </span>
                                        {l.text}
                                    </div>
                                ))}
                                {diffLines.length > 400 && (
                                    <div className="px-3 py-1 text-[10px] text-muted-foreground">
                                        … 其余 {diffLines.length - 400} 行省略
                                    </div>
                                )}
                            </pre>
                        </div>
                    )}
                    {meta.variant === 'edit' && diffLines.length === 0 && <InOutCard tool={tool}/>}

                    {/* 读取卡：行号 + 文件内容窗口 */}
                    {meta.variant === 'read' && readLines.length > 0 && (
                        <div className="max-h-[260px] overflow-y-auto bg-[hsl(var(--code-bg))]">
                            <div className="px-3 py-1.5 border-b border-[hsl(var(--code-border))] font-mono text-[10px] text-muted-foreground truncate">
                                {pickString(args ?? {}, ['path', 'file_path']) ?? tool.name}
                                <span className="ml-2 opacity-60">共 {readLines.length} 行</span>
                            </div>
                            <pre className="py-1 font-mono text-[10px] leading-[1.5]">
                                {readLines.slice(0, 500).map((l) => (
                                    <div key={l.no} className="px-3 flex gap-3 whitespace-pre-wrap break-all text-[hsl(var(--code-fg))]/85">
                                        <span className="shrink-0 select-none text-right w-8 text-muted-foreground/40">{l.no}</span>
                                        <span className="flex-1 min-w-0">{l.text}</span>
                                    </div>
                                ))}
                                {readLines.length > 500 && (
                                    <div className="px-3 py-1 text-[10px] text-muted-foreground">
                                        … 其余 {readLines.length - 500} 行省略
                                    </div>
                                )}
                            </pre>
                        </div>
                    )}
                    {meta.variant === 'read' && readLines.length === 0 && <InOutCard tool={tool}/>}

                    {/* 搜索卡：模式 + 命中行 */}
                    {meta.variant === 'search' && (
                        <div className="max-h-[260px] overflow-y-auto bg-[hsl(var(--code-bg))]">
                            {searchPattern && (
                                <div className="px-3 py-1.5 border-b border-[hsl(var(--code-border))] font-mono text-[10px] text-muted-foreground truncate">
                                    /{searchPattern}/
                                </div>
                            )}
                            {tool.result && (
                                <pre className="px-3 py-1.5 text-[10px] font-mono whitespace-pre-wrap break-all text-[hsl(var(--code-fg))]/85 leading-relaxed">
                                    {tool.result}
                                </pre>
                            )}
                            {!tool.result && tool.input && <JsonInBlock input={tool.input}/>}
                        </div>
                    )}

                    {/* 网页卡：URL + 抓取结果 */}
                    {meta.variant === 'web' && (
                        <div className="max-h-[260px] overflow-y-auto bg-[hsl(var(--code-bg))]">
                            {webUrl && (
                                <div className="px-3 py-1.5 border-b border-[hsl(var(--code-border))] font-mono text-[10px] text-[hsl(var(--code-muted))] truncate">
                                    {webUrl}
                                </div>
                            )}
                            {tool.result && (
                                <pre className="px-3 py-1.5 text-[10px] font-mono whitespace-pre-wrap break-all text-[hsl(var(--code-fg))]/85 leading-relaxed">
                                    {tool.result}
                                </pre>
                            )}
                            {!tool.result && tool.input && <JsonInBlock input={tool.input}/>}
                        </div>
                    )}

                    {/* 其余变体（task / todo / mcp / others）：IN/OUT 卡 */}
                    {(meta.variant === 'task' || meta.variant === 'todo' || meta.variant === 'mcp' || meta.variant === 'others') && (
                        <InOutCard tool={tool}/>
                    )}
                </div>
            )}
        </div>
    );
}

/** IN/OUT 卡（DSH ioCard：参数与结果分区展示），mcp/others/task/todo 及缺材料的兜底 */
function InOutCard({tool}: { tool: ToolEventInfo }) {
    const isError = tool.state === 'error';
    return (
        <div className="max-h-[260px] overflow-y-auto bg-[hsl(var(--code-bg))]">
            {tool.input && (
                <div className="px-3 py-2 border-b border-[hsl(var(--code-border))]">
                    <span className="text-[9px] font-bold tracking-widest text-[hsl(var(--code-muted))]">IN</span>
                    <pre className="mt-1 text-[10px] font-mono whitespace-pre-wrap break-all text-[hsl(var(--code-fg))]/85 leading-relaxed">
                        {tool.input}
                    </pre>
                </div>
            )}
            {tool.result && (
                <div className="px-3 py-2">
                    <span className="text-[9px] font-bold tracking-widest text-[hsl(var(--code-muted))]">OUT</span>
                    <pre
                        className={cn(
                            'mt-1 text-[10px] font-mono whitespace-pre-wrap break-all leading-relaxed',
                            isError ? 'text-[hsl(var(--code-del-fg))]' : 'text-[hsl(var(--code-fg))]/85',
                        )}
                    >
                        {tool.result}
                    </pre>
                </div>
            )}
        </div>
    );
}

/** 参数 JSON 兜底块（无结果可展示时） */
function JsonInBlock({input}: { input: string }) {
    return (
        <pre className="px-3 py-2 text-[10px] font-mono whitespace-pre-wrap break-all text-[hsl(var(--code-fg))]/85 leading-relaxed">
            {input}
        </pre>
    );
}
