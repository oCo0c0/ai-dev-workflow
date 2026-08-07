#!/usr/bin/env node
/**
 * Claude Bridge - Claude Agent SDK 持久化桥接进程（JSON-RPC 2.0 协议）
 *
 * 作为独立子进程运行，封装 @anthropic-ai/claude-agent-sdk。
 * 采用 JSON-RPC 2.0 协议：从 stdin 逐行读取 JSON-RPC Request，
 * 向 stdout 逐行写入 JSON-RPC Response / Notification。
 *
 * === Server Methods（父进程 → Bridge，带 id，期待 Response）===
 *   agent.execute          — 执行 AI 对话（长时阻塞，完成时才响应）
 *   agent.confirmPermission — 反向写回工具权限决策
 *   agent.ping             — 健康检查
 *
 * === Notifications（Bridge → 父进程，无 id，不期待 Response）===
 *   agent.ready             — 进程启动就绪
 *   agent.output            — AI 文本输出
 *   agent.thinking          — AI 思考过程
 *   agent.tool_use          — 工具调用事件
 *   agent.tool_result       — 工具结果事件
 *   agent.session           — 会话标识
 *   agent.permission_required — 需要权限确认
 *
 * === JSON-RPC 错误码 ===
 *   -32700  Parse error
 *   -32600  Invalid Request
 *   -32601  Method not found
 *   -32602  Invalid params
 *   -32000  Agent execution error
 *   -32001  Agent rate limited (529/429)
 */

// 在导入 SDK 之前配置 CLI 身份标识
process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
process.env.USER_TYPE = 'external';
delete process.env.CLAUDE_AGENT_SDK_VERSION;

import {query} from '@anthropic-ai/claude-agent-sdk';
import {createRequire} from 'module';
import {existsSync, appendFileSync} from 'fs';
import {join} from 'path';
import os from 'os';
import readline from 'readline';
import crypto from 'crypto';

// 轻量诊断日志开关：通过环境变量 BRIDGE_DEBUG_LOG 指定日志文件路径，未指定则关闭
const DBG_FILE = process.env.BRIDGE_DEBUG_LOG || '';

function dbg(tag, data) {
    if (!DBG_FILE) return;
    try {
        const text = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 1200);
        appendFileSync(DBG_FILE, `[${new Date().toISOString()}] ${tag}: ${text}\n`);
    } catch { /* ignore */
    }
}

/**
 * 解析 Claude CLI 可执行文件路径
 *
 * 按优先级依次在以下位置查找 claude-code/cli.js：
 * 1. 用户全局 npm 目录（Windows）
 * 2. 当前项目 node_modules
 * 3. 通过 require.resolve 动态解析
 *
 * @returns CLI 路径字符串，未找到时返回 null
 */
function resolveClaudeCliPath() {
    // 允许通过环境变量显式指定 CLI 路径
    if (process.env.CLAUDE_CODE_CLI_PATH) {
        return existsSync(process.env.CLAUDE_CODE_CLI_PATH) ? process.env.CLAUDE_CODE_CLI_PATH : null;
    }

    const candidates = [
        join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    ];

    for (const p of candidates) {
        if (existsSync(p)) return p;
    }

    try {
        const require = createRequire(import.meta.url);
        return require.resolve('@anthropic-ai/claude-code/cli.js');
    } catch {
        return null;
    }
}

const CLI_PATH = resolveClaudeCliPath();

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * 向 stdout 写入 JSON-RPC 2.0 成功响应
 * @param {string|number} id - 请求 id
 * @param {object} result - 结果对象
 */
function emitJsonRpcResponse(id, result) {
    process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id,
        result,
    }) + '\n');
}

/**
 * 向 stdout 写入 JSON-RPC 2.0 错误响应
 * @param {string|number|null} id - 请求 id（Parse error 时可为 null）
 * @param {number} code - 错误码
 * @param {string} message - 错误消息
 * @param {object} [data] - 可选的附加数据
 */
function emitJsonRpcError(id, code, message, data) {
    const error = {code, message};
    if (data !== undefined) error.data = data;
    process.stdout.write(JSON.stringify({
        jsonrpc: '2.0',
        id: id ?? null,
        error,
    }) + '\n');
}

/**
 * 向 stdout 写入 JSON-RPC 2.0 通知（无 id）
 * @param {string} method - 通知方法名
 * @param {object} [params] - 通知参数
 */
function emitNotification(method, params) {
    const msg = {jsonrpc: '2.0', method};
    if (params !== undefined) msg.params = params;
    process.stdout.write(JSON.stringify(msg) + '\n');
}

// 保留旧 emit 作为底层兼容（供 uncaughtException 等无会话场景使用）
function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

// ═══════════════════════════════════════════════════════════════
// 权限确认机制
// ═══════════════════════════════════════════════════════════════

/**
 * 等待用户权限决策的 Promise resolver，按 permissionRequestId 索引。
 * canUseTool 触发时存入，agent.confirmPermission 方法唤醒。
 */
const pendingPermissionResolvers = new Map();

/**
 * 创建 canUseTool 回调（仅当调用方启用权限确认时注入到 options）。
 * 触发时发送 agent.permission_required 通知，等待 agent.confirmPermission 方法调用唤醒；
 * 叠加 10 分钟超时与 SDK abort 兜底，避免 query 永久挂起。
 */
function createCanUseTool() {
    return async (toolName, input, o) => {
        const permissionRequestId = crypto.randomUUID();
        emitNotification('agent.permission_required', {
            sessionId: currentSessionId,
            permissionRequestId,
            toolName: toolName || '',
            toolInput: input || {},
            toolUseId: o?.toolUseID || '',
            title: o?.title || '',
            displayName: o?.displayName || '',
        });

        // 等待 agent.confirmPermission 方法调用唤醒
        const resolverPromise = new Promise((resolve) => {
            pendingPermissionResolvers.set(permissionRequestId, resolve);
        });

        // 超时兜底：10 分钟无响应自动拒绝
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve({behavior: 'deny', message: '权限确认超时（10 分钟），已自动拒绝'}), 10 * 60 * 1000);
        });

        // abort 兜底：SDK 中止该 query 时立即拒绝
        const signalPromise = o?.signal
            ? new Promise((resolve) => {
                if (o.signal.aborted) resolve({behavior: 'deny', message: '执行已中止'});
                else o.signal.addEventListener('abort', () => resolve({
                    behavior: 'deny',
                    message: '执行已中止'
                }), {once: true});
            })
            : new Promise(() => {
            }); // 永不 resolve，被 race 忽略

        const decision = await Promise.race([resolverPromise, timeoutPromise, signalPromise]);
        pendingPermissionResolvers.delete(permissionRequestId);
        return decision; // {behavior:'allow'} | {behavior:'deny', message}
    };
}

// ═══════════════════════════════════════════════════════════════
// SDK 查询与重试
// ═══════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOverloaded = (msg) => /529|429|overloaded|访问量过大|使用上限|rate.?limit|too many requests/i.test(msg || '');

/** 当前执行中的 sessionId（由 SDK system 消息设置），用于通知关联 */
let currentSessionId = null;

/**
 * 执行一次 SDK query（流式发送通知，所有通知携带 sessionId 用于父进程关联）。
 * @param {string} prompt - 提示词
 * @param {object} options - SDK options
 * @returns {Promise<{status: 'done'|'overloaded'|'error', error?: string}>}
 */
async function runQueryOnce(prompt, options) {
    for await (const msg of query({prompt, options})) {
        if (msg.type === 'system' && msg.session_id) {
            currentSessionId = msg.session_id;
            emitNotification('agent.session', {sessionId: msg.session_id});
        }
        if (msg.type === 'assistant') {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'text' && block.text) {
                        emitNotification('agent.output', {sessionId: currentSessionId, content: block.text});
                    } else if (block.type === 'thinking' && block.thinking) {
                        emitNotification('agent.thinking', {sessionId: currentSessionId, content: block.thinking});
                    } else if (block.type === 'tool_use') {
                        emitNotification('agent.tool_use', {
                            sessionId: currentSessionId,
                            toolName: block.name || '',
                            toolInput: block.input || {},
                            toolUseId: block.id || '',
                        });
                    }
                }
            }
        }
        // SDK 的 tool_result 在 user 类型消息中（API 把工具结果作为 user turn 返回）
        if (msg.type === 'user') {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'tool_result') {
                        emitNotification('agent.tool_result', {
                            sessionId: currentSessionId,
                            toolUseId: block.tool_use_id || '',
                            isError: block.is_error || false,
                            content: typeof block.content === 'string'
                                ? block.content
                                : JSON.stringify(block.content ?? ''),
                        });
                    }
                }
            }
        }
        if (msg.type === 'result') {
            dbg('result', {
                is_error: msg.is_error,
                subtype: msg.subtype,
                result: msg.is_error ? msg.result : undefined,
                totalMs: msg.duration_ms,
                numTurns: msg.num_turns,
            });
            if (msg.is_error) {
                let errorMsg;
                if (typeof msg.result === 'string') {
                    errorMsg = msg.result;
                } else {
                    const detail = msg.result == null ? 'no detail' : JSON.stringify(msg.result);
                    errorMsg = `SDK error: ${msg.subtype || 'unknown'} | ${detail}`;
                }
                return isOverloaded(errorMsg)
                    ? {status: 'overloaded', error: errorMsg}
                    : {status: 'error', error: errorMsg};
            }
        }
    }
    return {status: 'done'};
}

/**
 * 发送限流重试通知，并按指数退避等待。
 */
async function waitForRetry(attempt, errorMsg, maxRetries) {
    const wait = Math.min(2 ** attempt * 1000, 8000);
    emitNotification('agent.output', {
        sessionId: currentSessionId,
        content: `\n\n[模型限流(${errorMsg?.includes('429') ? '429' : '529'})，${Math.round(wait / 1000)}s 后重试 ${attempt + 1}/${maxRetries}...]\n\n`,
    });
    dbg('retry-rate-limit', {attempt: attempt + 1, wait, error: errorMsg});
    await sleep(wait);
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC Method 处理
// ═══════════════════════════════════════════════════════════════

/**
 * 处理 agent.execute — 执行 AI 对话（含 529 限流自动重试）
 *
 * 长时阻塞：Agent 完全结束（含所有权限确认）后才发 JSON-RPC Response。
 * 期间流式事件通过 Notification 发送。
 */
async function handleExecute(msg) {
    const params = msg.params || {};
    const {
        prompt,
        cwd,
        sessionId,
        maxTurns = 10,
        skills,
        mcpServers,
        model,
        reasoningEffort,
        extendedThinking,
        permissionEnabled,
    } = params;

    if (!prompt) {
        emitJsonRpcError(msg.id, -32602, 'Invalid params: prompt is required');
        return;
    }

    dbg('req-start', {
        id: msg.id,
        model,
        extendedThinking,
        maxTurns,
        sessionId: !!sessionId,
        promptLen: prompt?.length,
        cwd,
        skills,
        mcpServers: mcpServers ? Object.keys(mcpServers) : undefined,
        permissionEnabled,
    });

    // 重置当前执行会话 ID（新的 execute 开始）
    currentSessionId = null;

    const options = {
        cwd: cwd || process.cwd(),
        maxTurns,
        permissionMode: 'acceptEdits',
        ...(sessionId ? {resume: sessionId} : {}),
        ...(skills ? {skills} : {}),
        ...(mcpServers ? {mcpServers} : {}),
        // 启用自动压缩：限制上下文窗口大小
        compactWindow: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ? parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 10) : undefined,
    };

    // 权限确认：仅当调用方启用时注入 canUseTool
    // permissionMode 保持 acceptEdits，Bash 等仍需 prompt 的工具会触发回调
    if (permissionEnabled) {
        options.canUseTool = createCanUseTool();
    }

    if (model) {
        options.model = model;
    }

    // 通过 additionalArgs 传递高级参数给 CLI
    const extraArgs = [];
    if (extendedThinking) {
        extraArgs.push('--thinking');
    }
    if (reasoningEffort) {
        const effortMap = {
            low: '--reasoning-effort-low',
            medium: '--reasoning-effort-medium',
            high: '--reasoning-effort-high',
            xhigh: '--reasoning-effort-xhigh',
            max: '--reasoning-effort-max',
        };
        if (effortMap[reasoningEffort]) {
            extraArgs.push(effortMap[reasoningEffort]);
        } else {
            dbg('warning', {message: `Unknown reasoningEffort value: ${reasoningEffort}`});
        }
    }
    if (extraArgs.length > 0) {
        options.additionalArgs = [...(options.additionalArgs || []), ...extraArgs];
    }
    if (CLI_PATH) {
        options.pathToClaudeCodeExecutable = CLI_PATH;
    }

    // 529/429 限流指数退避重试：1s/2s/4s（封顶 8s），最多 3 次。
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const runResult = await runQueryOnce(prompt, options);
            if (runResult.status === 'done') {
                emitJsonRpcResponse(msg.id, {
                    exitCode: 0,
                    sessionId: currentSessionId || '',
                });
                return;
            }
            const lastError = runResult.error || 'Unknown error';
            if (runResult.status === 'overloaded' && attempt < maxRetries) {
                await waitForRetry(attempt, lastError, maxRetries);
                continue;
            }
            emitJsonRpcError(msg.id, -32000, lastError, {sessionId: currentSessionId || ''});
            return;
        } catch (err) {
            const lastError = err.message || String(err);
            dbg('catch', {attempt, message: lastError});
            if (isOverloaded(lastError) && attempt < maxRetries) {
                await waitForRetry(attempt, lastError, maxRetries);
                continue;
            }
            const errorCode = isOverloaded(lastError) ? -32001 : -32000;
            emitJsonRpcError(msg.id, errorCode, lastError, {sessionId: currentSessionId || ''});
            return;
        }
    }
}

/**
 * 处理 agent.confirmPermission — 反向写回工具权限决策
 *
 * 父进程调用此方法以响应当前的 agent.permission_required 通知，
 * 唤醒挂起的 canUseTool Promise。
 */
function handleConfirmPermission(msg) {
    const {permissionRequestId, decision, message} = msg.params || {};

    if (!permissionRequestId) {
        emitJsonRpcError(msg.id, -32602, 'Invalid params: permissionRequestId is required');
        return;
    }

    const resolver = pendingPermissionResolvers.get(permissionRequestId);
    if (!resolver) {
        emitJsonRpcError(msg.id, -32602, `Unknown permissionRequestId: ${permissionRequestId}`);
        return;
    }

    // SDK 的 deny 要求 message 必填，此处兜底；allow 的 message 可空
    const behavior = decision === 'allow' ? 'allow' : 'deny';
    const responseMessage = behavior === 'deny'
        ? (message || '用户拒绝了该工具')
        : message;
    resolver({behavior, message: responseMessage});
    pendingPermissionResolvers.delete(permissionRequestId);

    emitJsonRpcResponse(msg.id, {acknowledged: true});
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 消息路由
// ═══════════════════════════════════════════════════════════════

/**
 * 路由 JSON-RPC Method Call 到对应处理器
 */
function handleMethodCall(msg) {
    switch (msg.method) {
        case 'agent.execute':
            handleExecute(msg).catch((err) => {
                emitJsonRpcError(msg.id, -32000, err.message || String(err));
            });
            break;
        case 'agent.confirmPermission':
            handleConfirmPermission(msg);
            break;
        case 'agent.ping':
            emitJsonRpcResponse(msg.id, {status: 'ok'});
            break;
        default:
            emitJsonRpcError(msg.id, -32601, `Method not found: ${msg.method}`);
    }
}

// ═══════════════════════════════════════════════════════════════
// 主循环：stdin → JSON-RPC 解析 → 路由
// ═══════════════════════════════════════════════════════════════

const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
});

// 发送就绪通知
emitNotification('agent.ready');

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg;
    try {
        msg = JSON.parse(trimmed);
    } catch {
        emitJsonRpcError(null, -32700, 'Parse error');
        return;
    }

    // 校验 jsonrpc 版本
    if (!msg.jsonrpc || msg.jsonrpc !== '2.0') {
        emitJsonRpcError(msg.id ?? null, -32600, 'Invalid Request: jsonrpc must be "2.0"');
        return;
    }

    // JSON-RPC Request（有 id + method） — 期待 Response
    if (msg.id !== undefined && msg.method) {
        handleMethodCall(msg);
        return;
    }

    // JSON-RPC Notification（有 method，无 id） — 不期待 Response
    // Bridge 当前不接收来自父进程的通知，但保留兼容性
    if (msg.method && msg.id === undefined) {
        dbg('unhandled-notification', {method: msg.method});
        return;
    }

    // 无效消息
    emitJsonRpcError(msg.id ?? null, -32600, 'Invalid Request');
});

rl.on('close', () => {
    process.exit(0);
});

// 全局异常捕获，防止进程崩溃
process.on('uncaughtException', (err) => {
    emit({type: 'error', message: `Uncaught: ${err.message}`});
    // 不可恢复的错误，优雅退出
    process.exit(1);
});
