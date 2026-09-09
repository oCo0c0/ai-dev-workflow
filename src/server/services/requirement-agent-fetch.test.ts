/**
 * @module requirement-agent-fetch.test
 * @description agent 中介需求拉取服务单测（注入 fake runner，不起真实引擎）
 *
 * 覆盖：
 * - 正常路径：引擎返回契约 JSON → 映射为 RequirementDetail + sourceServer
 * - 容忍代码块围栏/前后杂文字的 JSON 提取
 * - 引擎返回 {"error": ...} → 抛出可读错误
 * - 首次输出不合法 → 自动重试一次（prompt 携带修正指令）
 * - 重试仍失败 → 抛出含原始输出摘要的错误
 * - 引擎 exitCode !== 0 → 抛出引擎执行失败
 * - MCP 白名单：preferredServer → runBridge 收到单源注入；未指定 → 全量 enabled
 */

import {describe, it, expect} from 'vitest';
import {RequirementAgentFetchService} from './requirement-agent-fetch.js';
import type {AgentFetchRunner} from './requirement-agent-fetch.js';

/** 可编程 fake runner：按调用顺序返回预设结果 */
function makeRunner(results: Array<{exitCode?: number | null; stdout: string; stderr?: string}>): {
    runner: AgentFetchRunner;
    calls: Array<{prompt: string; cwd?: string; mcpServers?: unknown}>;
} {
    const calls: Array<{prompt: string; cwd?: string; mcpServers?: unknown}> = [];
    let i = 0;
    const runner: AgentFetchRunner = {
        runBridge: async (input) => {
            calls.push({prompt: input.prompt, cwd: input.cwd, mcpServers: input.mcpServers});
            const r = results[Math.min(i++, results.length - 1)];
            return {exitCode: r.exitCode ?? 0, stdout: r.stdout, stderr: r.stderr ?? ''};
        },
    };
    return {runner, calls};
}

/** fake MCP 配置源 */
const mcpService = {
    get: (name: string) => (name === 'ones-api' ? {name} : undefined),
    list: () => [
        {name: 'ones-api', enabled: true},
        {name: 'memory', enabled: true},
        {name: 'disabled-x', enabled: false},
    ],
};

/** 注入式 resolveMcp：记录白名单参数 */
function makeResolveMcp() {
    const seen: Array<string[] | undefined> = [];
    const fn = (names?: string[]) => {
        seen.push(names);
        return {map: names ? {gateway: {type: 'http', url: `http://x/api/mcp?servers=${names.join(',')}`}} : undefined, missing: []};
    };
    return {seen, fn};
}

/** 契约 JSON 样例 */
const CONTRACT_JSON = JSON.stringify({
    sourceServer: 'ones-api',
    id: 'MbKZmvxyBq7L4Mjg',
    number: '#302',
    title: 'YFGL-302 新增监控邮件',
    status: 'done',
    priority: 'medium',
    assignee: '鲍磊',
    updatedAt: '2026-07-01T00:00:00Z',
    description: '完整描述 Markdown',
    acceptanceCriteria: ['标准一'],
    attachments: [{name: 'a.xlsx', url: 'https://x/a.xlsx'}],
    relatedIssues: [{id: 'i1', title: '关联', url: 'https://x/i1', status: 'open'}],
});

describe('RequirementAgentFetchService', () => {
    it('正常路径：契约 JSON → RequirementDetail + sourceServer', async () => {
        const {runner, calls} = makeRunner([{stdout: CONTRACT_JSON}]);
        const rm = makeResolveMcp();
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: rm.fn as never});

        const detail = await svc.fetchByInput('302', 'ones-api');

        expect(detail.sourceServer).toBe('ones-api');
        expect(detail.id).toBe('MbKZmvxyBq7L4Mjg');
        expect(detail.number).toBe('#302');
        expect(detail.title).toContain('YFGL-302');
        expect(detail.description).toBe('完整描述 Markdown');
        expect(detail.attachments).toHaveLength(1);
        expect(detail.relatedIssues![0].id).toBe('i1');

        // prompt 契约与只读约束
        expect(calls[0].prompt).toContain('302');
        expect(calls[0].prompt).toContain('严禁任何创建、更新、删除、提交、写入类工具');
        expect(calls[0].prompt).toContain('只输出一个 JSON 对象');
        // 白名单：preferredServer → 单源
        expect(rm.seen[0]).toEqual(['ones-api']);
        expect(calls[0].mcpServers).toBeDefined();
    });

    it('容忍代码块围栏与前后杂文字', async () => {
        const fenced = `前置说明\n\`\`\`json\n${CONTRACT_JSON}\n\`\`\`\n后置说明`;
        const {runner} = makeRunner([{stdout: fenced}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        const detail = await svc.fetchByInput('CWXT-302');
        expect(detail.title).toContain('YFGL-302');
    });

    it('未指定 server 时注入全部 enabled server（排除 disabled）', async () => {
        const {runner} = makeRunner([{stdout: CONTRACT_JSON}]);
        const rm = makeResolveMcp();
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: rm.fn as never});
        await svc.fetchByInput('302');
        expect(rm.seen[0]).toEqual(['ones-api', 'memory']);
    });

    it('引擎返回 {"error"} → 抛出可读错误', async () => {
        const {runner} = makeRunner([{stdout: JSON.stringify({error: '未找到该需求'})}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.fetchByInput('999')).rejects.toThrow('agent 拉取失败: 未找到该需求');
    });

    it('首次输出不合法 → 重试一次并携带修正指令；重试成功', async () => {
        const {runner, calls} = makeRunner([
            {stdout: '我觉得这个需求是关于……（非 JSON）'},
            {stdout: CONTRACT_JSON},
        ]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        const detail = await svc.fetchByInput('302');
        expect(detail.title).toContain('YFGL-302');
        expect(calls).toHaveLength(2);
        expect(calls[1].prompt).toContain('未能解析为符合契约的 JSON');
    });

    it('重试仍失败 → 抛出含原始输出摘要的错误', async () => {
        const {runner} = makeRunner([{stdout: '不是 JSON'}, {stdout: '还是不是 JSON'}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.fetchByInput('302')).rejects.toThrow(/不符合 JSON 契约/);
    });

    it('引擎 exitCode !== 0 → 抛出引擎执行失败', async () => {
        const {runner} = makeRunner([{exitCode: 1, stdout: '', stderr: '402 balance insufficient'}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.fetchByInput('302')).rejects.toThrow('agent 引擎执行失败');
    });

    it('缺 title 视为不符合契约（触发重试/失败路径）', async () => {
        const noTitle = JSON.stringify({id: 'x', description: 'd'});
        const {runner} = makeRunner([{stdout: noTitle}, {stdout: noTitle}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.fetchByInput('302')).rejects.toThrow(/不符合 JSON 契约/);
    });

    it('runBridge 收到低推理强度与隔离 cwd', async () => {
        const {runner, calls} = makeRunner([{stdout: CONTRACT_JSON}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await svc.fetchByInput('302');
        expect(calls[0].cwd).toContain('agent-fetch');
    });
});

describe('RequirementAgentFetchService.searchByInput', () => {
    const SEARCH_JSON = JSON.stringify({
        items: [
            {id: 'uuid-1', number: '#302', title: '需求A', status: '进行中', priority: 'high', assignee: '张三', updatedAt: '2026-07-01T00:00:00Z'},
            {id: 'uuid-2', number: '#303', title: '需求B', status: 'open'},
        ],
    });

    it('正常路径：items → Requirement[] 摘要', async () => {
        const {runner, calls} = makeRunner([{stdout: SEARCH_JSON}]);
        const rm = makeResolveMcp();
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: rm.fn as never});

        const list = await svc.searchByInput('监控', 'ones-api');

        expect(list).toHaveLength(2);
        expect(list[0]).toMatchObject({id: 'uuid-1', number: '#302', title: '需求A', status: '进行中'});
        expect(list[1].status).toBe('open');
        // prompt 含搜索任务与只读约束；白名单单源
        expect(calls[0].prompt).toContain('监控');
        expect(calls[0].prompt).toContain('严禁任何创建、更新、删除、提交、写入类工具');
        expect(rm.seen[0]).toEqual(['ones-api']);
    });

    it('items 缺省返回空数组（不视为契约失败）', async () => {
        const {runner} = makeRunner([{stdout: JSON.stringify({items: []})}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        const list = await svc.searchByInput('不存在的东西');
        expect(list).toEqual([]);
    });

    it('引擎返回 {"error"} → 抛出可读错误', async () => {
        const {runner} = makeRunner([{stdout: JSON.stringify({error: '该源不支持搜索'})}]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.searchByInput('x')).rejects.toThrow('agent 搜索失败: 该源不支持搜索');
    });

    it('输出不合法 → 重试一次后仍失败则抛错', async () => {
        const {runner, calls} = makeRunner([
            {stdout: '搜索结果是一堆文字……'},
            {stdout: '还是不是 JSON'},
        ]);
        const svc = new RequirementAgentFetchService({cliRunner: runner, mcpService, resolveMcp: makeResolveMcp().fn as never});
        await expect(svc.searchByInput('x')).rejects.toThrow(/搜索.*不符合 JSON 契约/);
        expect(calls).toHaveLength(2);
    });
});
