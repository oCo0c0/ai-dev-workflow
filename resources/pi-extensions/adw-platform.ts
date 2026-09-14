/**
 * adw 平台扩展（运行在 pi RPC 子进程内，经 `-e` 显式加载）
 *
 * 职责（pi 官方扩展 API，无 adw 运行时依赖）：
 * 1. 工具权限门：`pi.on("tool_call")` + `ctx.ui.confirm()`。
 *    RPC 模式下 confirm 自动映射为 extension_ui_request(confirm) ↔
 *    extension_ui_response，由 adw 主进程转发到前端弹窗——不再覆盖
 *    pi 内部 beforeToolCall 钩子（保持扩展管线完整）。
 * 2. MCP 桥：**异步 factory 顶层**从 adw 平台网关 REST 面拉取工具目录，
 *    `pi.registerTool()` 逐个注册；执行时 POST 回网关统一转发。
 *    必须在 factory（模块加载期）注册而非 session_start：pi 官方语义是
 *    "factory 返回 Promise 时 pi 先 await 再继续启动"（先于 session_start、
 *    先于首个模型调用）——session_start 内注册的工具实测不会进入 rpc 模式
 *    首轮 agent loop 的模型工具清单（模型看不到，实测 0 次工具调用）。
 *    参数 schema 直接使用标准 JSON Schema（pi 的参数校验器原生支持
 *    非 TypeBox 的纯 JSON Schema 路径）。
 *
 * 环境变量（由 adw 主进程注入）：
 * - ADW_PLATFORM_URL：平台网关基址（如 http://127.0.0.1:3000/api/platform）
 * - ADW_PLATFORM_KEY：可选 API Key（config.auth.apiKey 时设置）
 * - ADW_PLATFORM_SERVERS：可选 server 白名单（agent 拉取收敛工具面）
 *
 * 注意：本文件必须保持零运行时 import（仅 type-only），确保可被 pi 的
 * jiti 加载器在任意位置直接执行。
 */

/** 需要确认的 pi 内置工具（有副作用类；read/grep/find/ls 只读放行） */
const CONFIRM_BUILTIN_TOOLS = new Set(['bash', 'powershell', 'edit', 'write']);

/** 平台工具（网关注册，含 MCP 转发工具）的名称分隔符：<server>__<tool> */
const PLATFORM_TOOL_SEPARATOR = '__';

/**
 * 平台工具中「写类」动作关键词：命中才需要确认。
 * 只读工具（get/search/list/fetch/read 等命名）直接放行——agent 拉取需求等
 * 纯查询场景不弹窗；同时避免 MCP 上游语义变化时误放行写操作
 * （白名单反向风险高，故采用写类黑名单 + 读类命名不常见即确认的保守策略）。
 */
const WRITE_ACTION_PATTERN = /(create|update|delete|remove|apply|submit|post|put|patch|write|add|import|export|edit|set|send|move|copy|merge|close|assign|transition|upload|download_and_|prepare)/i;

/**
 * 判断平台工具是否需要确认。
 * 保守规则：local 名（__ 后部分）命中写类关键词 → 确认；
 * 明确的读类前缀（get/search/list/fetch/read/find/query/inspect/lookup）→ 放行；
 * 其余无法判断的一律确认（宁可多弹一次，不可漏放写操作）。
 */
function platformToolNeedsConfirm(toolName: string): boolean {
    const local = toolName.includes(PLATFORM_TOOL_SEPARATOR)
        ? toolName.slice(toolName.lastIndexOf(PLATFORM_TOOL_SEPARATOR) + PLATFORM_TOOL_SEPARATOR.length)
        : toolName;
    if (WRITE_ACTION_PATTERN.test(local)) return true;
    if (/^(get|search|list|fetch|read|find|query|inspect|lookup)[_-]/i.test(local)) return false;
    return true;
}

/** confirm 弹窗超时：超时视为拒绝（与 adw 侧 90 秒语义对齐） */
const CONFIRM_TIMEOUT_MS = 90_000;

/** 平台工具调用超时 */
const PLATFORM_CALL_TIMEOUT_MS = 180_000;

/** 工具目录空结果重试（上游 MCP 冷启动容错；延迟可经 ADW_CATALOG_RETRY_DELAY_MS 覆盖，测试用） */
const CATALOG_RETRY_COUNT = 4;
const CATALOG_RETRY_DELAY_MS = 3_000;

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
            confirm: (title: string, message: string, opts?: { timeout?: number }) => Promise<boolean>;
            notify?: (message: string, type?: 'info' | 'warning' | 'error') => void;
        };
    }) => Promise<{ block: boolean; reason: string } | undefined> | undefined): void;

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
            content: Array<{ type: 'text'; text: string }>;
            details: Record<string, unknown>;
        }>;
    }): void;
}

interface PlatformToolInfo {
    name: string;
    label?: string;
    description?: string;
    inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
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

export default async function adwPlatformExtension(pi: ExtensionAPIMinimal): Promise<void> {
    // === 权限门：副作用类工具 → confirm；只读工具直接放行 ===
    // ADW_PERMISSION_MODE=auto-allow（调用方未接权限回调，如经典 plan/execution
    // 流程）时全部放行——与 Claude bridge 未启用权限时的自动放行语义对齐。
    pi.on('tool_call', async (event, ctx) => {
        if (process.env.ADW_PERMISSION_MODE === 'auto-allow') return undefined;
        const name = event.toolName;
        const needsConfirm = CONFIRM_BUILTIN_TOOLS.has(name)
            || (name.includes(PLATFORM_TOOL_SEPARATOR) && platformToolNeedsConfirm(name));
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

    // === MCP 桥：factory 顶层拉取工具目录并注册（pi await 本函数后才继续启动） ===
    const base = process.env.ADW_PLATFORM_URL;
    if (!base) return; // 网关未启用（测试环境）：跳过，不注册平台工具

    // servers 白名单（可选）：与 Claude 侧 ?servers= 语义一致，收敛工具面
    const whitelist = (process.env.ADW_PLATFORM_SERVERS ?? '').trim();
    const catalogUrl = whitelist
        ? `${base}/tools?servers=${encodeURIComponent(whitelist)}`
        : `${base}/tools`;

    const key = process.env.ADW_PLATFORM_KEY;
    let tools: PlatformToolInfo[] = [];
    try {
        // 冷启动容错：上游 MCP（如 Windows npx）可能仍在启动，网关会先返回
        // 空目录（软超时降级）。拿到空目录时退避重试，避免 agent 看不到工具。
        for (let attempt = 0; attempt < CATALOG_RETRY_COUNT; attempt++) {
            const res = await fetch(catalogUrl, {
                headers: platformHeaders(key),
                signal: AbortSignal.timeout(15_000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            tools = (await res.json()) as PlatformToolInfo[];
            if (tools.length > 0) break;
            const delay = Number(process.env.ADW_CATALOG_RETRY_DELAY_MS ?? CATALOG_RETRY_DELAY_MS);
            await new Promise((r) => setTimeout(r, delay));
        }
    } catch (err) {
        // 加载失败不阻塞 pi 启动：本次会话无平台工具（agent 会自行上报）
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
                        | { text?: string; isError?: boolean }
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
}
