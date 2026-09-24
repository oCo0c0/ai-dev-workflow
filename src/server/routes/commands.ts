/**
 * @file commands.ts
 * @description 斜杠命令与技能路由 —— 输入框 `/命令` 的清单与执行入口。
 *
 * - GET  /api/commands          列出命令与技能（分组：command / skill）与应用自管目录
 * - POST /api/commands/execute  执行一条 `/name args`（内置命令由服务端处理；
 *                               技能/自定义命令返回模板文本，由前端作为消息内容发给模型）
 *
 * 存储位置（应用自管，不依赖外部 CLI 目录）：
 *   ~/.ai-dev-workbench/commands/<name>.md、~/.ai-dev-workbench/skills/<name>/SKILL.md
 */

import {Router} from 'express';
import {AgentExecutionStore} from '../services/agent-execution-store.js';
import {CommandRegistryService} from '../services/command-registry-service.js';
import {CommandDispatchService, type CommandDispatchContext} from '../services/command-dispatch-service.js';
import {MemoryNotesStore} from '../services/memory/memory-notes-store.js';
import type {MemoryService} from '../services/memory/memory-service.js';
import type {CoordinatorConfig} from '../services/agent-coordinator.js';
import {broadcast} from '../websocket.js';
import {getErrorMessage} from '../utils/error-utils.js';
import {buildTranscript as buildTranscriptFromLogs} from '../utils/transcript.js';
import {collectExternalSkills} from '../services/skill-injection.js';

/** 摘要材料上限（字符，取最近部分） */
const MAX_TRANSCRIPT_CHARS = 40_000;

/**
 * 执行日志 → 纯文本会话（/compact 的摘要材料）。
 * 实现已抽到 `../utils/transcript.js`（协调器做跨引擎上下文延续时复用同一实现），
 * 此处保留导出以免破坏既有引用。
 */
export function buildTranscript(logs: string[]): string {
    return buildTranscriptFromLogs(logs, MAX_TRANSCRIPT_CHARS);
}

/**
 * 创建命令路由
 * @param config - 协调器配置（复用 cliRunner 做 /compact 摘要）
 * @param memoryService - 记忆服务（/memory 读写）
 * @param registry - 命令注册中心（可注入测试用目录）
 * @param notesStore - 记忆笔记存储
 */
export function createCommandRoutes(
    config: CoordinatorConfig,
    memoryService: MemoryService,
    registry: CommandRegistryService = new CommandRegistryService(),
    notesStore: MemoryNotesStore = new MemoryNotesStore(),
): Router {
    const router = Router();
    const store = AgentExecutionStore.getInstance();
    const dispatcher = new CommandDispatchService(registry, memoryService, notesStore);

    /** 首次访问时确保应用自管目录存在，便于用户直接放文件 */
    registry.ensureDirs();

    // GET /api/commands —— 命令与技能清单
    router.get('/', async (_req, res) => {
        try {
            const groups = registry.list(await collectExternalSkills());
            res.json({
                groups,
                dirs: {commands: registry.getCommandsDir(), skills: registry.getSkillsDir()},
            });
        } catch (err) {
            res.status(500).json({code: 'COMMAND_LIST_ERROR', message: getErrorMessage(err)});
        }
    });

    // POST /api/commands/execute —— 执行 `/name args`
    router.post('/execute', async (req, res) => {
        const body = (req.body ?? {}) as {input?: unknown; executionId?: unknown; workspacePath?: unknown};
        const input = typeof body.input === 'string' ? body.input : '';
        const executionId = typeof body.executionId === 'string' ? body.executionId : undefined;
        const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath : undefined;
        if (!input.trim()) {
            res.status(400).json({code: 'EMPTY_INPUT', message: 'input is required'});
            return;
        }

        try {
            const execution = executionId ? await store.get(executionId) : null;

            /** 命令结果写入执行日志流并广播（前端实时可见） */
            const appendLog = executionId
                ? async (text: string) => {
                    await store.addLog(executionId, text);
                    broadcast({type: 'agent-execution:log', data: {executionId, log: text}});
                }
                : undefined;

            const ctx: CommandDispatchContext = {
                executionId,
                workspacePath: workspacePath ?? execution?.workspacePath,
                transcript: execution ? buildTranscript(execution.logs) : undefined,
                skills: await collectExternalSkills(),
                appendLog,
                clearLogs: executionId && execution
                    ? async () => {
                        await store.clearLogs(executionId);
                        broadcast({type: 'agent-execution:logs_cleared', data: {executionId}});
                    }
                    : undefined,
                resetSession: executionId
                    ? async () => {
                        await store.updateSessionId(executionId, undefined);
                    }
                    : undefined,
                appendUserMessage: executionId
                    ? async (text: string) => {
                        const line = JSON.stringify({type: 'user', content: text});
                        await store.addLog(executionId, line);
                        broadcast({type: 'agent-execution:log', data: {executionId, log: line}});
                    }
                    : undefined,
                summarize: async (transcript: string, instruction: string) => {
                    const cwd = ctx.workspacePath ?? execution?.workspacePath ?? process.cwd();
                    const prompt = [
                        '你是上下文压缩器。请把下面的对话历史压缩为结构化摘要，供后续在同一任务中继续工作时使用。',
                        '必须保留：【任务目标】【已完成的工作与结论】【关键文件与改动】【待办与风险】【重要约定与偏好】。',
                        '剔除寒暄与重复内容；使用中文与 Markdown 列表；不超过 800 字；只输出摘要本身。',
                        instruction ? `补充要求：${instruction}` : '',
                        '',
                        '--- 对话历史开始 ---',
                        transcript,
                        '--- 对话历史结束 ---',
                    ].filter(Boolean).join('\n');
                    const result = await config.cliRunner.runBridge(
                        {prompt, cwd, maxTurns: 3},
                        {workspacePath: cwd},
                    );
                    return (result.stdout || '').trim();
                },
            };

            const result = await dispatcher.dispatch(input, ctx);
            res.json(result);
        } catch (err) {
            res.status(500).json({code: 'COMMAND_EXECUTE_ERROR', message: getErrorMessage(err)});
        }
    });

    return router;
}
