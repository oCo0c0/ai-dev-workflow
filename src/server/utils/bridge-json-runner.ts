/**
 * @module bridge-json-runner
 * @description 调用 CLI Bridge 并要求结构化 JSON 输出的封装（注入式，避免循环依赖）。
 *
 * 流程：runBridge → 累积 stdout（provider 已把 output+thinking 都累进 result.stdout）
 * → extractJsonValue → validateShape → 校验失败把错误列表拼回 prompt 重试（默认 2 次）。
 *
 * 调用方注意：validator 校验失败时返回 ok:false 但带完整 raw，
 * 可自行用 raw 做 markdown 表格等兜底解析（见 plan.ts export-tasks）。
 */

import type {CLIRunnerService} from '../services/cli-runner-service.js';
import type {McpStdioMap} from '../services/cli-providers/types.js';
import {extractJsonValue} from './structured-json.js';
import type {ValidationResult} from './json-validator.js';

export interface RunBridgeJsonOptions<T = unknown> {
    /** CLIRunnerService 实例（注入，不 import 服务） */
    cliRunner: CLIRunnerService;
    /** 已 render + enrich 的 prompt */
    prompt: string;
    cwd: string;
    sessionId?: string;
    skills?: string[] | 'all';
    mcpServers?: McpStdioMap;
    /** 中止信号（透传给 runBridge，abort 时不再重试） */
    signal?: AbortSignal;
    /** 单次最大轮数，默认 20 */
    maxTurns?: number;
    /** 校验失败重试次数，默认 2；0 = 不重试 */
    maxRetries?: number;
    /** 单次调用超时（毫秒），默认 30 分钟 */
    timeoutMs?: number;
    /** 结构化输出校验器 */
    validator: (value: unknown) => ValidationResult;
    /** 透传进度（同 runBridge 的 onOutput） */
    onOutput?: (data: string, meta?: Record<string, unknown>) => void;
}

export interface RunBridgeJsonResult<T = unknown> {
    ok: boolean;
    /** 校验通过的数据 */
    data?: T;
    /** 完整累积输出（调用方可用 fallback 解析） */
    raw: string;
    /** 实际尝试次数（含重试） */
    attempts: number;
    /** 保留 session 续接 */
    bridgeSessionId?: string;
    /** 校验失败时的错误列表 */
    validationErrors?: string[];
    /** 失败原因 */
    error?: string;
}

/** 未解析出 JSON 时的纠错提示 */
const NO_JSON_FEEDBACK = '\n\n输出必须是可解析的 JSON，不要包含多余解释。请重新输出。';

/** 校验失败时的纠错提示（前缀，后接错误列表） */
const VALIDATION_FEEDBACK_HEADER = '\n\n输出校验失败：\n- ';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Bridge call timed out after ${ms}ms`)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

/**
 * 运行一次结构化 JSON 输出请求（含校验失败自动重试）。
 */
export async function runBridgeJson<T>(opts: RunBridgeJsonOptions<T>): Promise<RunBridgeJsonResult<T>> {
    const maxRetries = opts.maxRetries ?? 2;
    const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
    let attemptPrompt = opts.prompt;
    let lastErrors: string[] | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let result;
        try {
            result = await withTimeout(
                opts.cliRunner.runBridge(
                    {
                        prompt: attemptPrompt,
                        cwd: opts.cwd,
                        sessionId: opts.sessionId,
                        maxTurns: opts.maxTurns ?? 20,
                        skills: opts.skills,
                        mcpServers: opts.mcpServers,
                    },
                    {
                        workspacePath: opts.cwd,
                        signal: opts.signal,
                        onOutput: opts.onOutput,
                    },
                ),
                timeoutMs,
            );
        } catch (err) {
            return {
                ok: false,
                raw: '',
                attempts: attempt + 1,
                bridgeSessionId: opts.sessionId,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        const raw = result.stdout ?? '';
        if (result.aborted) {
            return {ok: false, raw, attempts: attempt + 1, bridgeSessionId: result.sessionId, error: 'aborted'};
        }

        const value = extractJsonValue(raw);
        if (value === undefined) {
            if (attempt < maxRetries) {
                attemptPrompt += NO_JSON_FEEDBACK;
                continue;
            }
            return {
                ok: false, raw, attempts: attempt + 1, bridgeSessionId: result.sessionId,
                error: '未从输出中解析出 JSON',
            };
        }

        const vr = opts.validator(value);
        if (vr.ok) {
            return {ok: true, data: value as T, raw, attempts: attempt + 1, bridgeSessionId: result.sessionId};
        }
        lastErrors = vr.errors;
        if (attempt < maxRetries) {
            attemptPrompt += VALIDATION_FEEDBACK_HEADER + vr.errors.join('\n- ') + '\n\n请修正后重新输出完整 JSON。';
            continue;
        }
        return {
            ok: false, raw, attempts: attempt + 1, bridgeSessionId: result.sessionId,
            validationErrors: vr.errors, error: '校验失败',
        };
    }

    // 不可达（循环内必有 return）
    return {ok: false, raw: '', attempts: 0, validationErrors: lastErrors, error: '未知错误'};
}
