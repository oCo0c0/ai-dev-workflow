#!/usr/bin/env node
/**
 * Claude Bridge - Claude Agent SDK 持久化桥接进程
 *
 * 作为独立子进程运行，封装 @anthropic-ai/claude-agent-sdk。
 * 采用持久模式：从 stdin 逐行读取 JSON 请求，向 stdout 逐行写入 JSON 响应。
 *
 * 请求格式（每行一个 JSON）：
 *   { requestId, prompt, cwd, sessionId?, maxTurns?, skills? }
 *
 * 响应格式（每个请求对应多条 JSON 行，通过 requestId 关联）：
 *   { requestId, type: 'output', content: '...' }   - AI 输出文本
 *   { requestId, type: 'session', sessionId: '...' } - 会话标识
 *   { requestId, type: 'done', exitCode: 0 }        - 请求完成
 *   { requestId, type: 'error', message: '...' }    - 错误信息
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
 * 2. NVM 安装目录
 * 3. 当前项目 node_modules
 * 4. 通过 require.resolve 动态解析
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

/**
 * 向 stdout 发送 JSON 行响应
 *
 * @param obj - 响应数据对象
 */
function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
}

/**
 * 等待用户权限决策的 Promise resolver，按 permissionRequestId 索引。
 * canUseTool 触发时存入，主进程反向写回 permission_response 时唤醒。
 */
const pendingPermissionResolvers = new Map();

/**
 * 创建 canUseTool 回调（仅当调用方启用权限确认时注入到 options）。
 * 触发时 emit permission_request，等待主进程回传决策；
 * 叠加 10 分钟超时与 SDK abort 兜底，避免 query 永久挂起。
 */
function createCanUseTool(requestId) {
    return async (toolName, input, o) => {
        const permissionRequestId = crypto.randomUUID();
        emit({
            requestId,
            type: 'permission_request',
            permissionRequestId,
            toolName: toolName || '',
            toolInput: input || {},
            toolUseId: o?.toolUseID || '',
            title: o?.title || '',
            displayName: o?.displayName || '',
        });

        // 等待主进程反向写回 permission_response（由 rl.on('line') 唤醒）
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
                else o.signal.addEventListener('abort', () => resolve({behavior: 'deny', message: '执行已中止'}), {once: true});
            })
            : new Promise(() => {}); // 永不 resolve，被 race 忽略

        const decision = await Promise.race([resolverPromise, timeoutPromise, signalPromise]);
        pendingPermissionResolvers.delete(permissionRequestId);
        return decision; // {behavior:'allow'} | {behavior:'deny', message}
    };
}

/**
 * 处理单个 AI 查询请求
 *
 * 调用 Claude Agent SDK 的 query() 函数，流式处理响应消息：
 * - system 类型：提取 session_id 并发送 session 事件
 * - assistant 类型：提取文本内容并逐块发送 output 事件
 * - result 类型：检查错误状态，发送 done 或 error 事件
 *
 * @param request - 查询请求对象
 * @param request.requestId - 请求唯一标识
 * @param request.prompt - 用户提示词（必填）
 * @param request.cwd - 工作目录
 * @param request.sessionId - 可选，用于恢复已有会话
 * @param request.maxTurns - 最大交互轮数（默认 10）
 * @param request.skills - 可选，技能配置
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOverloaded = (msg) => /529|429|overloaded|访问量过大|使用上限|rate.?limit|too many requests/i.test(msg || '');

/**
 * 执行一次 SDK query（流式 emit output/session）。
 * @returns {{status: 'done'|'overloaded'|'error', error?: string}} done=成功；overloaded=限流（可重试）；error=其他错误
 */
async function runQueryOnce(prompt, requestId, options) {
    for await (const msg of query({prompt, options})) {
        if (msg.type === 'system' && msg.session_id) {
            emit({requestId, type: 'session', sessionId: msg.session_id});
        }
        if (msg.type === 'assistant') {
            const content = msg.message?.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'text' && block.text) {
                        emit({requestId, type: 'output', content: block.text});
                    } else if (block.type === 'thinking' && block.thinking) {
                        emit({requestId, type: 'thinking', content: block.thinking});
                    } else if (block.type === 'tool_use') {
                        emit({
                            requestId,
                            type: 'tool_use',
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
                        emit({
                            requestId,
                            type: 'tool_result',
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
                const errorMsg = typeof msg.result === 'string' ? msg.result : `SDK error: ${msg.subtype || 'unknown'}`;
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
 *
 * @param requestId - 请求 ID
 * @param attempt - 当前尝试次数（从 0 开始）
 * @param errorMsg - 错误信息，用于判断是 429 还是 529
 * @param maxRetries - 最大重试次数
 * @returns {Promise<void>}
 */
async function waitForRetry(requestId, attempt, errorMsg, maxRetries) {
    const wait = Math.min(2 ** attempt * 1000, 8000);
    emit({
        requestId,
        type: 'output',
        content: `\n\n[模型限流(${errorMsg?.includes('429') ? '429' : '529'})，${Math.round(wait / 1000)}s 后重试 ${attempt + 1}/${maxRetries}...]\n\n`
    });
    dbg('retry-rate-limit', {attempt: attempt + 1, wait, error: errorMsg});
    await sleep(wait);
}

/**
 * 处理单个 AI 查询请求（含 529 限流自动重试）
 *
 * 中转 API（如 open.bigmodel.cn）高峰期对 claude agent 多轮密集调用限流，
 * 529 是临时错误。此处指数退避重试，对调用方透明。
 */
async function handleRequest(request) {
    const {
        requestId,
        prompt,
        cwd,
        sessionId,
        maxTurns = 10,
        skills,
        mcpServers,
        model,
        reasoningEffort,
        extendedThinking,
        permission,
    } = request;

    if (!requestId) {
        emit({type: 'error', message: 'requestId is required'});
        return;
    }

    dbg('req-start', {
        requestId,
        model,
        extendedThinking,
        maxTurns,
        sessionId: !!sessionId,
        promptLen: prompt?.length,
        cwd,
        skills,
        mcpServers: mcpServers ? Object.keys(mcpServers) : undefined
    });

    if (!prompt) {
        emit({requestId, type: 'error', message: 'prompt is required'});
        return;
    }

    const options = {
        cwd: cwd || process.cwd(),
        maxTurns,
        permissionMode: 'acceptEdits',
        ...(sessionId ? {resume: sessionId} : {}),
        ...(skills ? {skills} : {}),
        ...(mcpServers ? {mcpServers} : {}),
        // 启用自动压缩：限制上下文窗口大小（从 env CLAUUDE_CODE_AUTO_COMPACT_WINDOW 读取）
        compactWindow: process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW ? parseInt(process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, 10) : undefined,
    };

    // 权限确认：仅当调用方启用时注入 canUseTool（permissionMode 保持 acceptEdits，
    // Bash 等仍需 prompt 的工具会触发回调；Edit/Write 由 acceptEdits 自动放行）
    if (permission && permission.enabled) {
        options.canUseTool = createCanUseTool(requestId);
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
        // reasoningEffort 映射到 CLI 参数（如果 CLI 支持）
        const effortMap = {
            low: '--reasoning-effort-low',
            medium: '--reasoning-effort-medium',
            high: '--reasoning-effort-high',
            xhigh: '--reasoning-effort-xhigh',
            max: '--reasoning-effort-max'
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
    // 次数不宜多：每次重试 claude CLI 重新启动 + MCP 重连，开销大（多时数十秒）。
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const runResult = await runQueryOnce(prompt, requestId, options);
            if (runResult.status === 'done') {
                emit({requestId, type: 'done', exitCode: 0});
                return;
            }
            const lastError = runResult.error || 'Unknown error';
            if (runResult.status === 'overloaded' && attempt < maxRetries) {
                await waitForRetry(requestId, attempt, lastError, maxRetries);
                continue;
            }
            emit({requestId, type: 'error', message: lastError});
            return;
        } catch (err) {
            const lastError = err.message || String(err);
            dbg('catch', {attempt, message: lastError});
            if (isOverloaded(lastError) && attempt < maxRetries) {
                await waitForRetry(requestId, attempt, lastError, maxRetries);
                continue;
            }
            emit({requestId, type: 'error', message: lastError});
            return;
        }
    }
}

// 持久模式：从 stdin 逐行读取请求
const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
});

// 发送就绪信号，通知父进程桥接进程已准备就绪
emit({type: 'ready'});

rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
        request = JSON.parse(trimmed);
    } catch {
        emit({type: 'error', message: 'Invalid JSON request'});
        return;
    }

    // 反向权限响应：唤醒挂起的 canUseTool，不作为新请求处理
    if (request.type === 'permission_response') {
        const resolver = pendingPermissionResolvers.get(request.permissionRequestId);
        if (resolver) {
            // SDK 的 deny 要求 message 必填，此处兜底；allow 的 message 可空
            const behavior = request.decision === 'allow' ? 'allow' : 'deny';
            const message = behavior === 'deny'
                ? (request.message || '用户拒绝了该工具')
                : request.message;
            resolver({behavior, message});
        }
        return;
    }

    if (!request || typeof request.requestId !== 'string' || request.requestId.trim() === '') {
        emit({type: 'error', message: 'requestId is required'});
        return;
    }

    // 异步处理每个请求
    handleRequest(request).catch((err) => {
        emit({requestId: request.requestId, type: 'error', message: err.message});
    });
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
