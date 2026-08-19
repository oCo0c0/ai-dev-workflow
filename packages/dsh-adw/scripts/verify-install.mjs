/**
 * 安装后一键验证（用户在 dsh plugin add + 重启 dsh web 之后运行）：
 *   node scripts/verify-install.mjs [port]     # 默认 3080
 *
 * 检查四件事：
 *   1. GET /api/dsh-adw/sources            → 源目录 JSON（ones / github）
 *   2. GET /api/dsh-adw/requirements       → 已保存需求 JSON
 *   3. GET /plugins/ui-dsh-adw/client.js   → 浏览器半被服务（__ModuleLoader__ 包装）
 *   4. 前三项通过后提示人工检查项（侧边栏入口 / 拉取 / 执行）
 *
 * 注意：未安装插件时，/api/* 未命中路由会落到 SPA fallback（返回 index.html 200），
 * 本脚本按「必须是 JSON 且可解析」判定，不会把 HTML 误报为通过。
 */

const port = process.argv[2] ?? process.env.DSH_PORT ?? '3080'
const base = `http://127.0.0.1:${port}`

let failed = 0

/** One check row. */
async function check(name, run) {
  try {
    const message = await run()
    console.log(`  ok - ${name}${message ? `：${message}` : ''}`)
    return true
  } catch (error) {
    failed++
    console.log(`  FAIL - ${name}：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** GET and demand parseable JSON (SPA fallback yields HTML → reject). */
async function getJson(path) {
  const response = await fetch(base + path)
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`返回的不是 JSON（HTTP ${response.status}，可能是 SPA fallback 的 index.html —— 插件路由未注册）`)
  }
  return parsed
}

console.log(`dsh-adw 安装验证（${base}）\n`)

const sourcesOk = await check('GET /api/dsh-adw/sources（源目录）', async () => {
  const sources = await getJson('/api/dsh-adw/sources')
  if (!Array.isArray(sources) || sources.length < 2) throw new Error('源目录为空或少于 2 项')
  return sources.map(s => `${s.adapterId}${s.servers.length ? '[' + s.servers.join(',') + ']' : '[未配置]'}`).join(' ')
})

await check('GET /api/dsh-adw/requirements（已保存需求）', async () => {
  const list = await getJson('/api/dsh-adw/requirements')
  if (!Array.isArray(list)) throw new Error('不是数组')
  return `${list.length} 条`
})

await check('GET /plugins/ui-dsh-adw/client.js（浏览器半）', async () => {
  const response = await fetch(base + '/plugins/ui-dsh-adw/client.js')
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  if (!text.includes('window.__ModuleLoader__.load') || !text.includes('@along/dsh-adw')) {
    throw new Error('内容不是 dsh-adw 的模块包装')
  }
  return `${(text.length / 1024).toFixed(0)} KB`
})

console.log('')
if (failed > 0) {
  console.log(`未通过 ${failed} 项。排查建议：`)
  console.log('  1) 确认已执行：dsh plugin --profile web add link:D:/py_workspace/ai-dev-workflow/packages/dsh-adw')
  console.log('  2) 确认已重启 dsh web（进程重启，不是页面刷新）')
  console.log('  3) 查看 dsh web 启动日志中是否有 dsh-adw 相关报错（fiber 失败会导致整棵组合树不启动）')
  process.exit(1)
}

console.log('接口层全部通过。请继续人工检查浏览器端（刷新页面后）：')
console.log('  1. 侧边栏「新会话」下方出现「需求工作台」入口')
if (sourcesOk) console.log('  2. 输入需求号（如 CWXT-130341）→ 拉取 → 详情 → 执行开发 → 选工作区 → 确认执行')
console.log('  3. 任意会话输入「列出已保存的需求」→ agent 调用 adw_list_requirements')
