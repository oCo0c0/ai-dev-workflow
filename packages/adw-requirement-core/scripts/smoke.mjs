/**
 * 内核冒烟验证（沙箱内 vitest/esbuild 不可用时的替代验证）
 * 运行：node scripts/smoke.mjs
 * 覆盖：JSON 契约映射 / prompt 构建 / agent 中介拉取（fake LLM + fake 桥）/
 *       存储往返 / prompt 渲染 / MCP 配置自管 / 引擎门面 / 图片下载策略
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    AgentFetchService, buildFetchPrompt, buildSearchPrompt,
    mapJsonToDetailBase, mapJsonToRequirement,
    RequirementStore, RequirementEngine, renderDevPrompt,
    MCPConfigService, createAttachmentImageService,
} from '../lib/index.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

// --- agent JSON 契约映射（拉取详情 + 搜索摘要，与主应用同契约） ---
const detail = mapJsonToDetailBase({
    sourceServer: 'ones-api', id: 'KPHW', number: 42, title: 'Fix login', state: 'open',
    body: 'Steps:\n- [ ] reproduce\n- [ ] fix', user: { login: 'alice' }, assignee: { login: 'bob' },
    updated_at: '2026-01-02T03:04:05Z', acceptanceCriteria: ['reproduce', 'fix'],
    attachments: [{ name: 'a.png', url: 'https://x/a.png' }],
    relatedIssues: [{ id: 'CWXT-1', title: '关联', status: '进行中' }],
});
assert.equal(detail.id, 'KPHW');
assert.equal(detail.number, '42');
assert.equal(detail.acceptanceCriteria.join(','), 'reproduce,fix');
assert.equal(detail.attachments[0].name, 'a.png');
assert.equal(detail.relatedIssues[0].id, 'CWXT-1');
ok('agent 详情 JSON → 中立模型（含验收标准提取）');
const summary = mapJsonToRequirement({ id: 'KPHW', number: 'CWXT-42', title: 'Fix login', state: 'open' });
assert.equal(summary.number, 'CWXT-42');
assert.equal(summary.status, 'open');
ok('agent 搜索 JSON → 中立摘要（含 number）');

// --- prompt 构建（只读纪律 / JSON 契约 / 失败换路） ---
const fetchPrompt = buildFetchPrompt('CWXT-129290');
assert.ok(fetchPrompt.includes('<input>\nCWXT-129290\n</input>'));
assert.ok(fetchPrompt.includes('换参数或换工具再试'));
assert.ok(fetchPrompt.includes('sourceServer'));
const searchPrompt = buildSearchPrompt('登录');
assert.ok(searchPrompt.includes('<query>\n登录\n</query>'));
assert.ok(searchPrompt.includes('"title"'));
ok('拉取/搜索 prompt 构建（契约内嵌）');

// --- agent 中介拉取：fake LLM + fake 桥（读 schema → 调工具 → JSON 契约） ---
{
    const toolCalls = [];
    const mounted = [];
    const fakeBridge = {
        listEnabledServers: () => [{ name: 'ones-api', enabled: true }],
        listServerTools: async (server) => {
            mounted.push(server);
            return [{ name: 'get_work_item', description: '拉详情', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }];
        },
        callServerTool: async (server, tool, args) => {
            toolCalls.push({ server, tool, args });
            return { text: 'ok', isError: false };
        },
        getAttachmentImageService: () => undefined,
        getServerConfig: () => undefined,
    };
    const sent = [];
    const fakeLlm = {
        createChat({ tools }) {
            assert.ok(tools.some(t => t.name === 'ones-api__get_work_item' && String(t.description).includes('ones-api')), '工具面带 <server>__ 前缀');
            return {
                async send(content) {
                    sent.push(content);
                    if (toolCalls.length === 0) {
                        return { blocks: [{ type: 'tool-call', id: 'c1', name: 'ones-api__get_work_item', arguments: '{"id":"KPHW"}' }], stopKind: 'tool-calls' };
                    }
                    return { blocks: [{ type: 'text', text: JSON.stringify({ sourceServer: 'ones-api', ...detailJson }) }], stopKind: 'stop' };
                },
            };
        },
    };
    const detailJson = {
        id: 'KPHW', number: 'CWXT-42', title: 'Fix login', status: 'open',
        description: '正文', acceptanceCriteria: ['reproduce'],
    };
    const service = new AgentFetchService({ bridge: fakeBridge, agentLlm: () => fakeLlm });
    const result = await service.fetchByInput('CWXT-42');
    assert.equal(result.id, 'KPHW');
    assert.equal(result.sourceServer, 'ones-api');
    assert.deepEqual(mounted, ['ones-api']);
    assert.deepEqual(toolCalls, [{ server: 'ones-api', tool: 'get_work_item', args: { id: 'KPHW' } }]);
    assert.equal(sent[1][0].toolCallId, 'c1');
    // 缺 LLM：明确报错
    const noLlm = new AgentFetchService({ bridge: fakeBridge, agentLlm: () => undefined });
    await assert.rejects(() => noLlm.fetchByInput('X'), /agent LLM 运行时不可用/);
    ok('agent 中介拉取循环（前缀路由 / 工具结果回喂 / LLM 缺失报错）');
}

// --- 存储往返 ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-core-'));
const store = new RequirementStore(dir);
const saved = store.upsert(detail, { adapterId: 'agent', serverName: 'ones-api', input: 'CWXT-42', fetchedAt: '2026-01-01T00:00:00Z' });
assert.equal(store.get('KPHW').title, 'Fix login');
store.addExecution('KPHW', { executionId: 'e1', sessionId: 's1', workspaceId: 'w1', prompt: 'p', startedAt: '2026-01-02T00:00:00Z' });
store.settleExecution('KPHW', 'e1', 'succeeded');
const after = store.get('KPHW');
assert.equal(after.executions[0].outcome, 'succeeded');
assert.ok(after.executions[0].endedAt);
// 详情更新保留执行历史
store.upsert({ ...detail, title: 'Fix login v2' }, { adapterId: 'agent', serverName: 'ones-api', input: 'CWXT-42', fetchedAt: '2026-02-01T00:00:00Z' });
assert.equal(store.get('KPHW').executions.length, 1);
assert.equal(store.get('KPHW').title, 'Fix login v2');
ok('存储往返：upsert / 执行链接 / 结局回写 / 详情更新保留历史');
assert.equal(store.delete('KPHW'), true);
assert.equal(store.delete('KPHW'), false);
ok('删除语义');

// --- prompt 渲染 ---
const prompt = renderDevPrompt('需求 {{title}}（{{number}}）\n{{description}}\n{{acceptanceCriteria}}', detail);
assert.ok(prompt.includes('Fix login'));
assert.ok(prompt.includes('- [ ] reproduce'));
ok('开发 prompt 占位符渲染');

// --- MCP 配置自管（临时文件：add/list/get/delete 往返，不碰任何外部工具配置） ---
{
    const cfgFile = path.join(dir, 'mcp-servers.json');
    const cfg = new MCPConfigService(cfgFile);
    assert.deepEqual(cfg.list(), []);
    cfg.add({name: 'ones-api', type: 'custom', command: 'npx', args: ['-y', 'ai-dev-requirements@latest'], env: {ONES_API_BASE: 'https://x'}, enabled: true});
    assert.equal(cfg.get('ones-api').env.ONES_API_BASE, 'https://x');
    assert.equal(cfg.get('nope'), undefined);
    // 重开实例从盘读取（持久化生效）
    const cfg2 = new MCPConfigService(cfgFile);
    assert.equal(cfg2.list().length, 1);
    assert.equal(cfg2.get('ones-api').args[1], 'ai-dev-requirements@latest');
    assert.equal(cfg2.delete('ones-api'), true);
    assert.equal(new MCPConfigService(cfgFile).list().length, 0);
    ok('MCP 配置自管：add / get / 持久化 / delete（独立文件，不读 ~/.claude）');
}

// --- 附件图片服务工厂：按 server env 检测 ---
assert.equal(createAttachmentImageService(undefined), undefined);
assert.equal(createAttachmentImageService({ env: { ONES_API_BASE: 'https://x' } }), undefined);
assert.ok(createAttachmentImageService({ env: { ONES_API_BASE: 'https://x', ONES_ACCOUNT: 'a', ONES_PASSWORD: 'p' } }), '凭据齐备才建服务');
ok('附件图片服务工厂（ONES env 检测）');

// --- 引擎门面：配置自管文件就在 dataDir 内；缺 server/缺 LLM 报错语义 ---
{
    const engine = new RequirementEngine({ dataDir: dir });
    assert.deepEqual(engine.listServers(), []);
    await assert.rejects(() => engine.fetchAndSave('CWXT-42'), /未配置任何 MCP server/);
    engine.addServer({ name: 'ones-api', command: 'npx', args: ['-y', 'ai-dev-requirements@latest'] });
    assert.equal(engine.listServers().length, 1);
    await assert.rejects(() => engine.fetchAndSave('CWXT-42'), /agent LLM 运行时不可用/);
    await engine.dispose();
    ok('引擎门面：listServers / addServer / 分级报错');
}

// --- 附件图片：三段下载策略 + 描述/附件改写 + 路径安全 ---
{
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-core-img-'));
    const store2 = new RequirementStore(dir2);
    const req = {
        id: 'img-req-1', number: 'R-1', title: '带图需求', status: 'open', priority: 'P2',
        description: '前文\n[Image: shot.png]\n![remote](https://example.com/pic.png)\n[Embed: drawio]',
        acceptanceCriteria: [],
        attachments: [{ name: 'shot.png', url: 'https://example.com/shot.png', type: 'image/png' }],
    };
    // 假图片服务：批量策略直接落盘 shot.png 与 pic.png（urlToImageFilename 提取）
    const fakeService = {
        async downloadWikiImages(_task, resources, imgDir) {
            for (const r of resources) {
                if (r.name === 'shot.png') fs.writeFileSync(path.join(imgDir, r.name), 'PNGDATA');
            }
            fs.writeFileSync(path.join(imgDir, 'pic.png'), 'PNGDATA2');
            return resources.length;
        },
        async downloadTaskImages() { return []; },
        async downloadImage() { return false; },
    };
    await store2.downloadImages(req, fakeService, '/api/dsh-adw/requirements/img-req-1/images');
    const base = '/api/dsh-adw/requirements/img-req-1/images';
    assert.ok(req.description.includes(`![shot.png](${base}/shot.png)`), '本地占位符改写');
    assert.ok(req.description.includes(`![remote](${base}/pic.png)`), '远程 markdown 改本地');
    assert.ok(req.description.includes('📎 嵌入内容: drawio'), '嵌入物提示');
    assert.equal(req.attachments[0].url, `${base}/shot.png`, '附件 URL 指向本地');
    assert.ok(store2.getImagePath('img-req-1', 'shot.png').endsWith('shot.png'), 'getImagePath 命中');
    assert.equal(store2.getImagePath('img-req-1', '../../requirements.json'), null, '路径遍历拦截');
    // 策略 1.5：无图片资源时 [image] 占位符按序对应富文本图
    const req2 = {
        id: 'img-req-2', number: 'R-2', title: 't', status: 'open', priority: 'P2',
        description: '看图 [image] 与 [Image omitted]', acceptanceCriteria: [], attachments: [],
    };
    const fakeService2 = {
        async downloadWikiImages() { return 0; },
        async downloadTaskImages(_t, imgDir) {
            fs.writeFileSync(path.join(imgDir, 'r1.png'), 'R');
            return [{ uuid: 'u1', filename: 'r1.png', localPath: path.join(imgDir, 'r1.png') }];
        },
        async downloadImage() { return false; },
    };
    await store2.downloadImages(req2, fakeService2, `${base}2/images`);
    assert.ok(req2.description.includes('![u1](/api/dsh-adw/requirements/img-req-1/images2/images/r1.png)'), '富文本占位符改写');
    assert.ok(req2.attachments.some(a => a.name === 'r1.png'), '富文本图同步进附件');
    fs.rmSync(dir2, { recursive: true, force: true });
    ok('附件图片：下载策略 / 描述改写 / 路径安全');
}

// --- 引擎图片路径透出（宿主路由用） ---
{
    const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-core-eng-'));
    const engine3 = new RequirementEngine({ dataDir: dir3 });
    assert.equal(engine3.getImagePath('x', 'nope.png'), undefined);
    fs.mkdirSync(path.join(dir3, 'images', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir3, 'images', 'x', 'a.png'), 'P');
    assert.ok(engine3.getImagePath('x', 'a.png').endsWith(path.join('images', 'x', 'a.png')));
    await engine3.dispose();
    fs.rmSync(dir3, { recursive: true, force: true });
    ok('引擎 getImagePath 透出');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n全部通过：${passed} 组断言`);
console.log('active resources:', process.getActiveResourcesInfo().join(', '));
