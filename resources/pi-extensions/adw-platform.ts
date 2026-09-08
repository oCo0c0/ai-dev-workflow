/**
 * adw 平台扩展（运行在 pi RPC 子进程内，经 `-e` 显式加载）
 *
 * 职责（pi 官方扩展 API，无 adw 运行时依赖）：
 * 1. 工具权限门：`pi.on("tool_call")` + `ctx.ui.confirm()`。
 *    RPC 模式下 confirm 自动映射为 extension_ui_request(confirm) ↔
 *    extension_ui_response，由 adw 主进程转发到前端弹窗——不再覆盖
 *    pi 内部 beforeToolCall 钩子（保持扩展管线完整）。
 * 2. MCP 桥：`session_start` 时从 adw 平台网关 REST 面拉取工具目录，
 *    `pi.registerTool()` 逐个注册；执行时 POST 回网关统一转发。
 *    参数 schema 直接使用标准 JSON Schema（pi 的参数校验器原生支持
 *    非 TypeBox 的纯 JSON Schema 路径）。
 *
 * 环境变量（由 adw 主进程注入）：
 * - ADW_PLATFORM_URL：平台网关基址（如 http://127.0.0.1:3000/api/platform）
 * - ADW_PLATFORM_KEY：可选 API Key（config.auth.apiKey 时设置）
 *
 * 注意：本文件必须保持零运行时 import（仅 type-only），确保可被 pi 的
 * jiti 加载器在任意位置直接执行。
 */

/** 需要确认的 pi 内置工具（有副作用类；read/grep/find/ls 只读放行） */
const CONFIRM_BUILTIN_TOOLS = new Set(['bash', 'powershell', 'edit', 'write']);

/** 平台工具（网关注册，含 MCP 转发工具）统一需要确认 */
const PLATFORM_TOOL_SEPARATOR = '__';

/** confirm 弹窗超时：超时视为拒绝（与 adw 侧 90 秒语义对齐） */
const CONFIRM_TIMEOUT_MS = 90_000;

/** 平台工具调用超时 */
const PLATFORM_CALL_TIMEOUT_MS = 180_000;

/** 工具入参摘要的最大长度（超长截断，避免弹窗爆炸） */
const INPUT_SUMMARY_LIMIT = 800;

interface ExtensionAPIMinimal {
    on(event: 'tool_call', handler: (event: {
        type: 'tool_call';
        toolCallId: string;
        toolName: string;
        input: Record<string, unknown>;
    }, ctx: {
        hasUI: boolean;
        ui: {
            confirm: (title: string, message: string, opts?: {timeout?: number}) => Promise<boolean>;
            notify?: (message: string, type?: 'info' | 'warning' | 'error') => void;
        };
    }) => Promise<{block: boolean; reason: string} | undefined> | undefined): void;
    on(event: 'session_start', handler: (event: unknown, ctx: {
        ui: {notify?: (message: string, type?: 'info' | 'warning' | 'error') => void};
    }) => void | Promise<void>): void;
    registerTool(tool: {
        name: string;
        label: string;
        description: string;
        parameters: unknown;
        execute: (
            toolCallId: string,
            params: Record<string, unknown>,
            signal?: AbortSignal,
        ) => Promise<{
            content: Array<{type: 'text'; text: string}>;
            details: Record<string, unknown>;
        }>;
    }): void;
}

interface PlatformToolInfo {
    name: string;
    label?: string;
    description?: string;
    inputSchema?: {type: 'object'; properties?: Record<string, unknown>; required?: string[]};
}

function platformHeaders(key: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {'content-type': 'application/json'};
    if (key) headers['x-api-key'] = key;
    return headers;
}

/** 构造给用户看的工具入参摘要 */
function summarizeInput(input: Record<string, unknown> | undefined): string {
    if (!input || Object.keys(input).length === 0) return '(无参数)';
    try {
        const text = JSON.stringify(input, null, 2);
        return text.length > INPUT_SUMMARY_LIMIT ? `${text.slice(0, INPUT_SUMMARY_LIMIT)}\n...(截断)` : text;
    } catch {
        return String(input);
    }
}

export default function adwPlatformExtension(pi: ExtensionAPIMinimal): void {
    // === 权限门：副作用类工具 → confirm；只读工具直接放行 ===
    // ADW_PERMISSION_MODE=auto-allow（调用方未接权限回调，如经典 plan/execution
    // 流程）时全部放行——与 Claude bridge 未启用权限时的自动放行语义对齐。
    pi.on('tool_call', async (event, ctx) => {
        if (process.env.ADW_PERMISSION_MODE === 'auto-allow') return undefined;
        const name = event.toolName;
        const needsConfirm = CONFIRM_BUILTIN_TOOLS.has(name) || name.includes(PLATFORM_TOOL_SEPARATOR);
        if (!needsConfirm) return undefined;
        if (!ctx.hasUI) return undefined; // 无 UI 模式（print）不阻断

        const confirmed = await ctx.ui.confirm(
            name,
            summarizeInput(event.input),
            {timeout: CONFIRM_TIMEOUT_MS},
        );
        if (!confirmed) {
            return {block: true, reason: '用户拒绝了该工具调用'};
        }
        return undefined;
    });

    // === MCP 桥：session_start 时从平台网关拉取工具目录并注册 ===
    pi.on('session_start', async (_event, ctx) => {
        const base = process.env.ADW_PLATFORM_URL;
        if (!base) return; // 网关未启用（测试环境）：跳过，不注册平台工具

        const key = process.env.ADW_PLATFORM_KEY;
        let tools: PlatformToolInfo[] = [];
        try {
            const res = await fetch(`${base}/tools`, {
                headers: platformHeaders(key),
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            tools = (await res.json()) as PlatformToolInfo[];
        } catch (err) {
            ctx.ui.notify?.(
                `[adw] 平台工具加载失败（已跳过）：${err instanceof Error ? err.message : String(err)}`,
                'warning',
            );
            return;
        }

        for (const tool of tools) {
            if (!tool.name || tool.name.includes(' ')) continue; // pi 工具名不含空格
            pi.registerTool({
                name: tool.name,
                label: tool.label || tool.name,
                description: tool.description || `adw platform tool "${tool.name}"`,
                parameters: tool.inputSchema || {type: 'object', properties: {}, required: []},
                async execute(_toolCallId, params) {
                    try {
                        const res = await fetch(`${base}/call`, {
                            method: 'POST',
                            headers: platformHeaders(key),
                            body: JSON.stringify({name: tool.name, args: params}),
                            signal: AbortSignal.timeout(PLATFORM_CALL_TIMEOUT_MS),
                        });
                        const payload = await res.json().catch(() => null) as
                            | {text?: string; isError?: boolean}
                            | null;
                        if (!res.ok || !payload) {
                            return {
                                content: [{type: 'text', text: `平台工具调用失败：HTTP ${res.status}`}],
                                details: {isError: true},
                            };
                        }
                        return {
                            content: [{type: 'text', text: payload.text ?? ''}],
                            details: {isError: payload.isError === true},
                        };
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        return {
                            content: [{type: 'text', text: `平台工具调用异常：${message}`}],
                            details: {isError: true},
                        };
                    }
                },
            });
        }
    });
}
