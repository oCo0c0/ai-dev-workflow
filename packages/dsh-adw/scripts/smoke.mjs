/**
 * Host-half runtime smoke (no cordis boot): drives the built lib/index.js
 * apply() with a minimal duck-typed context and exercises the /api/dsh-adw
 * route family through fake req/res pairs.
 * 运行：node scripts/smoke.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const plugin = await import('file://' + path.join(root, 'lib/index.js').replace(/\\/g, '/'))

// ── 最小宿主上下文 ─────────────────────────────────────────────────────
const registered = { routes: [], tools: [], sections: [] }
const makeCtx = () => ({
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(_list, _cb) { /* settings service absent in smoke — fallback path covers it */ },
  webServer: { register: route => { registered.routes.push(route); return () => {} } },
  tools: { register: tool => { registered.tools.push(tool); return () => {} } },
  systemPrompt: { section: s => { registered.sections.push(s); return () => {} } },
})

// 数据目录指向临时目录，避免冒烟写真实 ~/.dsh
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-adw-smoke-'))
process.env.DSH_HOME = tmp
plugin.apply(makeCtx(), {})

assert.equal(registered.routes.length, 1)
assert.equal(registered.routes[0].path, '/api/dsh-adw')
assert.equal(registered.routes[0].kind, 'prefix')
console.log('  ok - /api/dsh-adw prefix route registered')

assert.deepEqual(registered.tools.map(t => t.name).sort(), ['adw_fetch_requirement', 'adw_list_requirements', 'adw_parse_document', 'adw_search_requirements'])
console.log('  ok - 4 agent tools registered')

assert.equal(registered.sections.length, 1)
assert.equal(registered.sections[0].name, 'plugin:dsh-adw')
assert.ok(registered.sections[0].text.includes('dsh-adw'))
console.log('  ok - system-prompt section registered')

// ── 假 req/res 驱动路由 ───────────────────────────────────────────────
function makeRes() {
  const res = {
    statusCode: 0, body: undefined, headers: {},
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers); return this },
    end(payload) { this.body = payload; return this },
  }
  res.json = v => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); return res }
  return res
}
function makeReq(method, url, socketAddress = '127.0.0.1', bodyJson) {
  const req = {
    method, url,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: socketAddress },
    [Symbol.asyncIterator]: async function* () { if (bodyJson !== undefined) yield Buffer.from(bodyJson) },
  }
  return req
}
const handler = registered.routes[0].handler

// loopback 栅栏：非回环来源 403
{
  const res = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/requirements', '192.168.1.5'), res)
  assert.equal(res.statusCode, 403)
  console.log('  ok - non-loopback request fenced (403)')
}

// GET /requirements
{
  const res = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/requirements'), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), [])
  console.log('  ok - GET /requirements → []')
}

// GET /sources
{
  const res = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/sources'), res)
  assert.equal(res.statusCode, 200)
  const sources = JSON.parse(res.body)
  assert.ok(sources.length >= 2, 'at least ones+github catalog entries')
  assert.ok(sources.some(s => s.adapterId === 'ones' && s.installTemplate !== undefined))
  console.log(`  ok - GET /sources → ${sources.map(s => s.adapterId + (s.servers.length ? '[' + s.servers.join(',') + ']' : '[unconfigured]')).join(' ')}`)
}

// POST /fetch 缺参数
{
  const res = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/fetch'), res)
  assert.equal(res.statusCode, 400)
  console.log('  ok - POST /fetch without input → 400')
}

// POST /fetch 不存在的 server → 明确错误（不静默切换）
{
  const req = makeReq('POST', '/api/dsh-adw/fetch', '127.0.0.1', JSON.stringify({ input: 'CWXT-1', serverName: 'no-such-server' }))
  req.headers['content-type'] = 'application/json'
  const res = makeRes()
  await handler(req, res)
  assert.equal(res.statusCode, 500)
  assert.ok(JSON.parse(res.body).message.includes('no-such-server'))
  console.log('  ok - POST /fetch unknown server → explicit FETCH_ERROR')
}

// DELETE /servers/:name — 自管配置删除（不存在 → success:false）
{
  const res = makeRes()
  await handler(makeReq('DELETE', '/api/dsh-adw/servers/ghost'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).success, false)
  console.log('  ok - DELETE /servers/ghost → success:false')
}

// ── 自定义 MCP 服务器管理（stdio + url 两种形态） ─────────────────────
{
  // POST /servers — stdio 形态
  const resAdd = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/servers', '127.0.0.1',
    JSON.stringify({ name: 'smoke-stdio', command: 'npx', args: ['-y', 'some-mcp'], env: { K: 'V' } })), resAdd)
  assert.equal(resAdd.statusCode, 200)
  assert.equal(JSON.parse(resAdd.body).name, 'smoke-stdio')
  console.log('  ok - POST /servers stdio → 200')

  // POST /servers — url 形态（http 远程服务器）
  const resUrl = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/servers', '127.0.0.1',
    JSON.stringify({ name: 'smoke-http', url: 'https://example.com/mcp' })), resUrl)
  assert.equal(resUrl.statusCode, 200)
  assert.equal(JSON.parse(resUrl.body).type, 'http')
  console.log('  ok - POST /servers url → 200 type:http')

  // POST /servers — url 与 command 同时缺失 → 400
  const resBad = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/servers', '127.0.0.1',
    JSON.stringify({ name: 'smoke-bad' })), resBad)
  assert.equal(resBad.statusCode, 400)
  console.log('  ok - POST /servers without command/url → 400')

  // GET /servers — 列表包含两个新条目
  const resList = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/servers'), resList)
  assert.equal(resList.statusCode, 200)
  const names = JSON.parse(resList.body).map(s => s.name)
  assert.ok(names.includes('smoke-stdio') && names.includes('smoke-http'))
  console.log('  ok - GET /servers lists custom entries')
}

// ── MinerU 路由（未配置时的降级响应） ────────────────────────────────
{
  const resHealth = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/mineru/health'), resHealth)
  assert.equal(resHealth.statusCode, 200)
  const health = JSON.parse(resHealth.body)
  assert.equal(health.configured, false)
  assert.equal(health.healthy, false)
  console.log('  ok - GET /mineru/health unconfigured → configured:false')

  const resParse = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/mineru/parse', '127.0.0.1',
    JSON.stringify({ input: 'whatever.pdf' })), resParse)
  assert.equal(resParse.statusCode, 200)
  const parsed = JSON.parse(resParse.body)
  assert.equal(parsed.success, false)
  assert.ok(parsed.error.includes('未配置'))
  console.log('  ok - POST /mineru/parse unconfigured → success:false')

  const resNoInput = makeRes()
  await handler(makeReq('POST', '/api/dsh-adw/mineru/parse', '127.0.0.1', '{}'), resNoInput)
  assert.equal(resNoInput.statusCode, 400)
  console.log('  ok - POST /mineru/parse without input → 400')
}

// 数据目录已就位（存储懒写盘：首次变更才落 requirements.json）
{
  assert.ok(fs.existsSync(path.join(tmp, 'dsh-adw')), 'data dir created under $DSH_HOME')
  console.log('  ok - host data dir initialized at $DSH_HOME/dsh-adw')
}

// ── 本地附件图片路由（预置存储 + 图片文件后打路由） ───────────────────
{
  const dataDir = path.join(tmp, 'dsh-adw')
  const seeded = {
    version: 1,
    requirements: [{
      id: 'img-r1', number: 'R-1', title: '带图需求', status: 'open', priority: 'P2',
      description: '![shot.png](/api/dsh-adw/requirements/img-r1/images/shot.png)',
      acceptanceCriteria: [], attachments: [],
      source: { adapterId: 'ones', serverName: 'ones-api', input: 'R-1', fetchedAt: '2026-01-01T00:00:00Z' },
      executions: [],
    }],
  }
  fs.writeFileSync(path.join(dataDir, 'requirements.json'), JSON.stringify(seeded), 'utf8')
  fs.mkdirSync(path.join(dataDir, 'images', 'img-r1'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'images', 'img-r1', 'shot.png'), Buffer.from('PNGDATA'))

  const res = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/requirements/img-r1/images/shot.png'), res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.body.toString(), 'PNGDATA')
  console.log('  ok - GET image → 200 image/png')

  const res404 = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/requirements/img-r1/images/nope.png'), res404)
  assert.equal(res404.statusCode, 404)
  console.log('  ok - GET missing image → 404')

  // 路径遍历：编码后的 ../../ 尝试被清洗拦截（回环栅栏已在前面验证）
  const resTrav = makeRes()
  await handler(makeReq('GET', '/api/dsh-adw/requirements/img-r1/images/..%2F..%2Frequirements.json'), resTrav)
  assert.equal(resTrav.statusCode, 404)
  console.log('  ok - image path traversal fenced (404)')
}

fs.rmSync(tmp, { recursive: true, force: true })
console.log('\nhost-half smoke 全部通过')
