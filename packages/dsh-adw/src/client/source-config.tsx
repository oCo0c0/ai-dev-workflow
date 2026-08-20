/**
 * Shared requirement-source configuration body: catalog sources (ONES /
 * GitHub) + custom MCP servers (stdio command or remote url), applied
 * immediately through /api/dsh-adw. Rendered by BOTH surfaces — the
 * official settings-page plugin card (`settings.plugin.item`) and the
 * panel's own「源」view (always available, keeping the plugin standalone).
 */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { MCPServerConfig, RequirementSourceEntry } from '@along/adw-requirement-core'
import * as api from './api.ts'

/** Optional MinerU config wiring shared by both surfaces. */
export interface MineruConfigProps {
  /** The 'dsh-adw' settings scope; undefined when no settings surface serves this client (row turns read-only). */
  scope: SettingsScope<Record<string, unknown>> | undefined
}

/** Source rows + custom MCP section + MinerU row (immediate apply via /api/dsh-adw). */
export function SourceConfigBody(props: { sources: RequirementSourceEntry[]; onChanged(): void; mineru?: MineruConfigProps }): React.JSX.Element {
  const { sources, onChanged } = props
  const [openId, setOpenId] = useState('')
  const [env, setEnv] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState<{ key: string; text: string } | undefined>(undefined)

  /** Row-level action runner (install / test / remove share one busy+note slot). */
  const run = useCallback((key: string, fn: () => Promise<string>) => {
    void (async () => {
      setBusy(key); setNote(undefined)
      try {
        setNote({ key, text: await fn() })
        onChanged()
      } catch (err) {
        setNote({ key, text: err instanceof Error ? err.message : String(err) })
      } finally { setBusy('') }
    })()
  }, [onChanged])

  return (
    <div className="adw-srcList">
      {sources.map(source => {
        const configured = source.servers.length > 0
        const expanded = openId === source.adapterId
        const key = source.adapterId
        return (
          <div key={key} className="adw-srcRow">
            <div className="adw-srcRowHead">
              <strong>{source.label}</strong>
              <span className="adw-badge" data-tone={configured ? 'succeeded' : ''}>
                {configured ? source.servers.join('、') : '未配置'}
              </span>
              <span className="adw-srcSpacer" />
              {configured ? (
                <>
                  <button
                    type="button" className="adw-btn adw-btnSm" disabled={busy !== ''}
                    onClick={() => run(key, async () => {
                      const r = await api.testServer(source.servers[0])
                      return r.ok ? '连接成功' : `连接失败：${r.message}`
                    })}
                  >测试</button>
                  <button
                    type="button" className="adw-btn adw-btnSm adw-btnDanger" disabled={busy !== ''}
                    onClick={() => run(key, async () => {
                      await api.removeServer(source.servers[0])
                      return '已移除配置'
                    })}
                  >移除</button>
                </>
              ) : (
                <button type="button" className="adw-btn adw-btnSm" onClick={() => { setOpenId(expanded ? '' : key); setEnv({}); setNote(undefined) }}>
                  {expanded ? '收起' : '配置'}
                </button>
              )}
            </div>
            {expanded && source.installTemplate !== undefined && (
              <div className="adw-srcForm">
                <div className="adw-srcFormGrid">
                  {source.installTemplate.envSpecs.map(spec => (
                    <label key={spec.key} className="adw-field">
                      <span className="adw-fieldLabel">
                        {spec.label}{spec.required ? ' *' : ''}
                        {spec.hint !== undefined ? <span className="adw-hint"> — {spec.hint}</span> : null}
                      </span>
                      <input
                        className="adw-input"
                        type={spec.secret ? 'password' : 'text'}
                        value={env[spec.key] ?? ''}
                        onChange={e => setEnv(prev => ({ ...prev, [spec.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
                <div className="adw-srcFormActions">
                  <button
                    type="button" className="adw-btn adw-btnPrimary adw-btnSm" disabled={busy !== ''}
                    onClick={() => run(key, async () => {
                      const missing = source.installTemplate!.envSpecs.filter(s => s.required && (env[s.key] ?? '').trim() === '')
                      if (missing.length > 0) throw new Error(`缺少必填项：${missing.map(m => m.label).join('、')}`)
                      const r = await api.installSource(source.adapterId, env)
                      setOpenId('')
                      return r.connectionTest
                        ? (r.connectionTest.ok ? '已配置并连接成功' : `已配置；连接测试：${r.connectionTest.message}`)
                        : '已配置'
                    })}
                  >
                    {busy === key ? '配置中…' : '保存并测试'}
                  </button>
                  <button type="button" className="adw-btn adw-btnSm" onClick={() => { setOpenId(''); setEnv({}) }}>取消</button>
                </div>
              </div>
            )}
            {busy === key && <div className="adw-hint">处理中…</div>}
            {busy !== key && note !== undefined && note.key === key && <div className="adw-hint">{note.text}</div>}
          </div>
        )
      })}
      <CustomServerSection busy={busy} note={note} run={run} onChanged={onChanged} />
      {props.mineru !== undefined && <MineruConfigRow scope={props.mineru.scope} />}
    </div>
  )
}

/** MinerU service row: URL bound to the 'dsh-adw' settings namespace + health probe. */
function MineruConfigRow(props: { scope: SettingsScope<Record<string, unknown>> | undefined }): React.JSX.Element {
  const { scope } = props
  const [url, setUrl] = useState('')
  const [editable, setEditable] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  // Track the scope snapshot (resolved mineruUrl + writability).
  useEffect(() => {
    if (scope === undefined) {
      setUrl('')
      setEditable('')
      return
    }
    const sync = (): void => {
      const snapshot = scope.getSnapshot()
      const value = typeof snapshot.value?.mineruUrl === 'string' ? snapshot.value.mineruUrl : ''
      setUrl(value)
      setEditable(value)
    }
    sync()
    return scope.subscribe(sync)
  }, [scope])

  // Without a settings surface the row still shows the live host-side value.
  useEffect(() => {
    if (scope !== undefined) return
    void api.mineruHealth().then(health => {
      setUrl(health.baseUrl ?? '')
      setEditable(health.baseUrl ?? '')
    }).catch(() => { /* host unreachable — row stays empty */ })
  }, [scope])

  const save = (): void => {
    void (async () => {
      setBusy(true); setNote('')
      try {
        if (scope === undefined) throw new Error('设置服务不可用：请在设置页「插件」分组中配置')
        await scope.set('mineruUrl', editable.trim())
        setNote('已保存')
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    })()
  }

  const probe = (): void => {
    void (async () => {
      setBusy(true); setNote('')
      try {
        const health = await api.mineruHealth()
        setNote(health.configured
          ? (health.healthy ? `健康：${health.latency ?? '?'}ms` : `不可达：${health.error ?? 'unknown'}`)
          : '未配置服务地址')
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="adw-customSection">
      <div className="adw-srcRowHead">
        <strong>MinerU 文档解析</strong>
        <span className="adw-hint">PDF / Word / 截图 → Markdown（adw_parse_document 工具与附件解析用）</span>
        <span className="adw-badge">{url !== '' ? '已配置' : '未配置'}</span>
      </div>
      <div className="adw-srcFormGrid">
        <label className="adw-field">
          <span className="adw-fieldLabel">服务地址</span>
          <input
            className="adw-input" value={editable} disabled={scope === undefined}
            onChange={e => setEditable(e.target.value)} placeholder="http://127.0.0.1:8000"
          />
        </label>
      </div>
      <div className="adw-srcFormActions">
        <button type="button" className="adw-btn adw-btnPrimary adw-btnSm" disabled={busy || scope === undefined} onClick={save}>
          {busy ? '处理中…' : '保存'}
        </button>
        <button type="button" className="adw-btn adw-btnSm" disabled={busy} onClick={probe}>健康检查</button>
        {scope === undefined && <span className="adw-hint">设置服务不可用，此处只读（当前值：{url === '' ? '未配置' : url}）</span>}
      </div>
      {note !== '' && <div className="adw-hint">{note}</div>}
    </div>
  )
}

/** One configured custom server row (name + type badge + test/remove). */
function CustomServerRow(props: { server: MCPServerConfig; busy: string; run(key: string, fn: () => Promise<string>): void; onChanged(): void }): React.JSX.Element {
  const { server, busy, run, onChanged } = props
  const key = `srv:${server.name}`
  return (
    <div className="adw-srcRow">
      <div className="adw-srcRowHead">
        <strong>{server.name}</strong>
        <span className="adw-badge">{server.url !== undefined ? 'http' : server.type}</span>
        <span className="adw-hint adw-srcCmdPreview">{server.url ?? [server.command, ...server.args].join(' ')}</span>
        <span className="adw-srcSpacer" />
        <button
          type="button" className="adw-btn adw-btnSm" disabled={busy !== ''}
          onClick={() => run(key, async () => {
            const r = await api.testServer(server.name)
            return r.ok ? '连接成功' : `连接失败：${r.message}`
          })}
        >测试</button>
        <button
          type="button" className="adw-btn adw-btnSm adw-btnDanger" disabled={busy !== ''}
          onClick={() => run(key, async () => {
            await api.removeServer(server.name)
            onChanged()
            return `已移除 ${server.name}`
          })}
        >移除</button>
      </div>
      {busy === key && <div className="adw-hint">处理中…</div>}
    </div>
  )
}

/** Custom MCP servers: configured rows + add form (stdio command/args or url). */
function CustomServerSection(props: {
  busy: string
  note: { key: string; text: string } | undefined
  run(key: string, fn: () => Promise<string>): void
  onChanged(): void
}): React.JSX.Element {
  const { busy, note, run, onChanged } = props
  const [servers, setServers] = useState<MCPServerConfig[]>([])
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'stdio' | 'url'>('stdio')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [env, setEnv] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      setServers(await api.listServers())
    } catch { /* 列表加载失败不打断表单 */ }
  }, [])

  useEffect(() => { void reload() }, [reload, onChanged])

  return (
    <div className="adw-customSection">
      <div className="adw-srcRowHead">
        <strong>自定义 MCP 服务器</strong>
        <span className="adw-hint">stdio（npx / python / docker …）或远程 http(s)，兼容标准 mcpServers 配置</span>
        <span className="adw-srcSpacer" />
        <button type="button" className="adw-btn adw-btnSm" onClick={() => { setOpen(!open); setMode('stdio') }}>
          {open ? '收起' : '添加'}
        </button>
      </div>
      {servers.map(server => (
        <CustomServerRow key={server.name} server={server} busy={busy} run={run} onChanged={onChanged} />
      ))}
      {open && (
        <div className="adw-srcForm">
          <div className="adw-srcFormGrid">
            <label className="adw-field">
              <span className="adw-fieldLabel">名称 *</span>
              <input className="adw-input" value={name} onChange={e => setName(e.target.value)} placeholder="如 my-mcp" />
            </label>
            <label className="adw-field">
              <span className="adw-fieldLabel">类型</span>
              <select className="adw-select" value={mode} onChange={e => setMode(e.target.value === 'url' ? 'url' : 'stdio')}>
                <option value="stdio">本地 stdio</option>
                <option value="url">远程 http(s)</option>
              </select>
            </label>
            {mode === 'stdio' ? (
              <>
                <label className="adw-field">
                  <span className="adw-fieldLabel">命令 *</span>
                  <input className="adw-input" value={command} onChange={e => setCommand(e.target.value)} placeholder="如 npx 或 python" />
                </label>
                <label className="adw-field">
                  <span className="adw-fieldLabel">参数（空格分隔）</span>
                  <input className="adw-input" value={args} onChange={e => setArgs(e.target.value)} placeholder="如 -y some-mcp-server" />
                </label>
              </>
            ) : (
              <label className="adw-field">
                <span className="adw-fieldLabel">URL *</span>
                <input className="adw-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/mcp" />
              </label>
            )}
            <label className="adw-field">
              <span className="adw-fieldLabel">{mode === 'url' ? '请求头（KEY=VALUE 每行一个）' : '环境变量（KEY=VALUE 每行一个）'}</span>
              <textarea className="adw-textarea adw-envArea" value={env} onChange={e => setEnv(e.target.value)} placeholder={mode === 'url' ? 'Authorization=Bearer xxx' : 'API_KEY=xxx'} />
            </label>
          </div>
          <div className="adw-srcFormActions">
            <button
              type="button" className="adw-btn adw-btnPrimary adw-btnSm" disabled={busy !== ''}
              onClick={() => run('custom:add', async () => {
                if (name.trim() === '') throw new Error('名称必填')
                const envMap: Record<string, string> = {}
                for (const line of env.split(/\r?\n/)) {
                  const trimmed = line.trim()
                  if (trimmed === '') continue
                  const eq = trimmed.indexOf('=')
                  if (eq <= 0) throw new Error(`环境变量格式错误（应为 KEY=VALUE）：${trimmed}`)
                  envMap[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
                }
                await api.addServer({
                  name: name.trim(),
                  ...(mode === 'url'
                    ? { url: url.trim() }
                    : { command: command.trim(), args: args.trim() === '' ? [] : args.trim().split(/\s+/) }),
                  env: envMap,
                })
                setOpen(false); setName(''); setCommand(''); setArgs(''); setUrl(''); setEnv('')
                await reload()
                onChanged()
                return `已添加 ${name.trim()}，可点「测试」验证`
              })}
            >
              {busy === 'custom:add' ? '添加中…' : '添加'}
            </button>
            <button type="button" className="adw-btn adw-btnSm" onClick={() => { setOpen(false); setName(''); setCommand(''); setArgs(''); setUrl(''); setEnv('') }}>取消</button>
          </div>
        </div>
      )}
      {busy === 'custom:add' && <div className="adw-hint">处理中…</div>}
      {busy !== 'custom:add' && note !== undefined && note.key.startsWith('srv:') && <div className="adw-hint">{note.text}</div>}
    </div>
  )
}
