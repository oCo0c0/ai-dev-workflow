/**
 * 内核冒烟验证（沙箱内 vitest/esbuild 不可用时的替代验证）
 * 运行：node scripts/smoke.mjs
 * 覆盖：适配器路由 / 输入方言 / JSON 解析 / 存储往返 / prompt 渲染 / MCP 配置读取
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    resolveAdapter, getAdapter,
    RequirementStore, RequirementEngine, renderDevPrompt,
    MCPConfigService,
} from '../lib/index.js';

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok - ${name}`); };

const makeConfig = (o) => ({ type: 'custom', command: 'npx', args: [], env: {}, enabled: true, ...o });

// --- 适配器路由 ---
assert.equal(resolveAdapter('ones-api', makeConfig({ name: 'ones-api', command: 'cmd', args: ['/c', 'npx', '-y', 'ai-dev-requirements@latest'] })).id, 'ones');
ok('ones-api 服务器路由到 ones 适配器');
assert.equal(resolveAdapter('gh-tools', makeConfig({ name: 'gh-tools', args: ['-y', '@modelcontextprotocol/server-github'] })).id, 'github');
assert.equal(resolveAdapter('whatever', undefined).id, 'generic');
ok('github 认领 / 无配置落 generic');

// --- ONES 输入方言 ---
const ones = getAdapter('ones');
assert.equal(ones.normalizeInput('#302'), '302');
assert.equal(ones.normalizeInput('CWXT-129686'), '129686');
assert.equal(ones.normalizeInput('https://1s.oristand.com/wiki#/team/x/page/y'), 'https://1s.oristand.com/wiki#/team/x/page/y');
ok('ONES 输入方言规整');

// --- GitHub JSON 解析 ---
const gh = getAdapter('github');
const detail = gh.parseDetail([{ type: 'text', text: JSON.stringify({
    number: 42, title: 'Fix login', state: 'open',
    body: 'Steps:\n- [ ] reproduce\n- [ ] fix', user: { login: 'alice' }, assignee: { login: 'bob' },
    updated_at: '2026-01-02T03:04:05Z',
}) }]);
assert.equal(detail.id, '42');
assert.equal(detail.acceptanceCriteria.join(','), 'reproduce,fix');
ok('GitHub issue JSON → 中立模型（含验收标准提取）');

// --- 存储往返 ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adw-core-'));
const store = new RequirementStore(dir);
const saved = store.upsert(detail, { adapterId: 'github', serverName: 'gh', input: 'foo/bar#42', fetchedAt: '2026-01-01T00:00:00Z' });
assert.equal(store.get('42').title, 'Fix login');
const { executionId } = (() => {
    const r = { executionId: 'e1' };
    store.addExecution('42', { executionId: 'e1', sessionId: 's1', workspaceId: 'w1', prompt: 'p', startedAt: '2026-01-02T00:00:00Z' });
    return r;
})();
store.settleExecution('42', 'e1', 'succeeded');
const after = store.get('42');
assert.equal(after.executions[0].outcome, 'succeeded');
assert.ok(after.executions[0].endedAt);
// 详情更新保留执行历史
store.upsert({ ...detail, title: 'Fix login v2' }, { adapterId: 'github', serverName: 'gh', input: 'foo/bar#42', fetchedAt: '2026-02-01T00:00:00Z' });
assert.equal(store.get('42').executions.length, 1);
assert.equal(store.get('42').title, 'Fix login v2');
ok('存储往返：upsert / 执行链接 / 结局回写 / 详情更新保留历史');
assert.equal(store.delete('42'), true);
assert.equal(store.delete('42'), false);
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

// --- 引擎实例化（不连接）：配置自管文件就在 dataDir 内 ---
const engine = new RequirementEngine({ dataDir: dir });
assert.ok(Array.isArray(engine.listSources()));
assert.equal(engine.listSources().length >= 2, true);
console.log(`  info - 源目录: ${engine.listSources().map(s => `${s.adapterId}[${s.servers.join('/') || '未配置'}]`).join(' ')}`);
await engine.dispose();
ok('引擎实例化 + 源目录');

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
