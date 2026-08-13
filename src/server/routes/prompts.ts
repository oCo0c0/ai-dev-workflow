/**
 * @file prompts.ts
 * @description 提示词优化路由模块
 *
 * 提供「提示词优化」能力：用户输入一段原始提示词，调用当前激活的 CLI Provider
 * （Claude / Codex / Pi / 自定义供应商）对文本进行润色、补充细节、结构化，
 * 返回优化后的文本给前端展示，由用户决定是否采纳。
 *
 * 路由前缀：/api/prompts
 *
 * 端点列表：
 * - POST /optimize  优化提示词
 */

import {Router} from 'express';
import type {CLIRunnerService} from '../services/cli-runner-service.js';
import {getErrorMessage} from '../utils/error-utils.js';

/** 允许优化的文本最大长度 */
const MAX_TEXT_LENGTH = 8000;
/** 单次优化超时时间 */
const OPTIMIZE_TIMEOUT_MS = 60_000;

/** 常见用途对应的优化上下文提示 */
const PURPOSE_HINTS: Record<string, string> = {
    reply: '这段文字是用户准备发送给 AI 编程助手的回复或补充说明，请优化使其意图明确、信息完整、表达清晰。',
    requirement: '这是一段需求描述，请优化使其更具体、可执行、无歧义。',
    plan: '这是一段开发计划或任务描述，请优化使其步骤清晰、目标明确。',
};

/**
 * 构建优化提示词
 */
function buildPrompt(text: string, purpose?: string): string {
    const hint = purpose && PURPOSE_HINTS[purpose] ? PURPOSE_HINTS[purpose] : '';
    return [
        '你是专业的提示词优化助手，请把用户输入的提示词优化得更清晰、更具体、结构更好。',
        hint,
        '',
        '严格要求：',
        '1. 保持原意和语言（中文输入输出中文，英文输入输出英文）',
        '2. 直接输出优化后的提示词正文，不要任何解释、前后缀、Markdown 代码块或标题',
        '3. 这是一个纯文本改写任务，不要调用任何工具（Read / Write / Bash 等）',
        '4. 如果原文已经足够清晰，仅做最小必要改动',
        '',
        '用户输入的提示词：',
        text,
    ]
        .filter(Boolean)
        .join('\n');
}

/**
 * 清洗模型返回结果：去首尾空白，并剥离模型偶尔额外包裹的 Markdown 代码围栏。
 */
function cleanOptimized(raw: string): string {
    let out = raw.trim();
    const fenced = out.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n\s*```$/);
    if (fenced) out = fenced[1].trim();
    return out;
}

/**
 * 创建提示词优化路由实例
 */
export function createPromptsRoutes(cliRunnerService: CLIRunnerService): Router {
    const router = Router();

    // POST /api/prompts/optimize - 优化提示词
    router.post('/optimize', async (req, res) => {
        try {
            const {text, purpose, workspacePath} = (req.body ?? {}) as {
                text?: unknown;
                purpose?: unknown;
                workspacePath?: unknown;
            };

            if (typeof text !== 'string' || !text.trim()) {
                res.status(400).json({code: 'INVALID_TEXT', message: 'text 不能为空'});
                return;
            }
            if (text.length > MAX_TEXT_LENGTH) {
                res.status(400).json({code: 'TEXT_TOO_LONG', message: `text 长度不能超过 ${MAX_TEXT_LENGTH} 字符`});
                return;
            }

            const cwd = typeof workspacePath === 'string' && workspacePath ? workspacePath : process.cwd();

            // 轻量一次性调用：maxTurns=1，不注入 skills/mcp。
            // 通过 onOutput 只累积纯文本（过滤 thinking / tool_use / tool_result），
            // 避免 extendedThinking 开启时思考内容混入结果。
            let plainText = '';
            const result = await Promise.race([
                cliRunnerService.runBridge(
                    {
                        prompt: buildPrompt(text, typeof purpose === 'string' ? purpose : undefined),
                        cwd,
                        maxTurns: 1,
                    },
                    {
                        workspacePath: cwd,
                        // 轻量调用：降低推理强度（跨 Provider 通用），并关闭扩展思考（Claude 专用，其他 Provider 忽略）
                        reasoningEffort: 'low',
                        extendedThinking: false,
                        onOutput: (data, meta) => {
                            if (meta === undefined && data) plainText += data;
                        },
                    }
                ),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('提示词优化超时')), OPTIMIZE_TIMEOUT_MS)
                ),
            ]);

            const optimized = cleanOptimized(plainText || result.stdout || '');
            if (!optimized) {
                const detail = result.stderr?.trim() || (result.exitCode !== 0 ? `退出码 ${result.exitCode}` : '');
                res.status(502).json({
                    code: 'EMPTY_RESULT',
                    message: detail ? `模型未返回有效内容：${detail}` : '模型未返回有效内容',
                });
                return;
            }

            res.json({optimized});
        } catch (err) {
            res.status(500).json({code: 'OPTIMIZE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
