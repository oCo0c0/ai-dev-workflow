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
import {existsSync} from 'fs';
import {join} from 'path';
import os from 'os';
import readline from 'readline';

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
    const candidates = [
        join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
        join('D:', 'javaSE', 'nvm', 'nodejs', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
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
async function handleRequest(request) {
    const {requestId, prompt, cwd, sessionId, maxTurns = 10, skills} = request;

    if (!prompt) {
        emit({requestId, type: 'error', message: 'prompt is required'});
        return;
    }

    try {
        const options = {
            cwd: cwd || process.cwd(),
            maxTurns,
            permissionMode: 'acceptEdits',
            ...(sessionId ? {resume: sessionId} : {}),
            ...(skills ? {skills} : {}),
        };

        if (CLI_PATH) {
            options.pathToClaudeCodeExecutable = CLI_PATH;
        }

        // 流式处理 SDK 响应
        for await (const msg of query({prompt, options})) {
            // 提取会话 ID
            if (msg.type === 'system' && msg.session_id) {
                emit({requestId, type: 'session', sessionId: msg.session_id});
            }

            // 提取 AI 输出
            if (msg.type === 'assistant') {
                const content = msg.message?.content;
                if (Array.isArray(content)) {
                    for (const block of content) {
                        if (block.type === 'text' && block.text) {
                            emit({requestId, type: 'output', content: block.text});
                        }
                    }
                }
            }

            // 处理错误结果
            if (msg.type === 'result' && msg.is_error) {
                emit({requestId, type: 'error', message: msg.result || 'Claude returned an error'});
                return;
            }
        }

        emit({requestId, type: 'done', exitCode: 0});

    } catch (err) {
        emit({requestId, type: 'error', message: err.message});
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
});
