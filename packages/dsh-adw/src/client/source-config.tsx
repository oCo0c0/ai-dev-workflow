/**
 * Shared requirement-source configuration body: one row per source (status
 * badge + test/remove when configured, inline credential form when not),
 * applied immediately through /api/dsh-adw. Rendered by BOTH surfaces —
 * the settings-page plugin card (when a settings surface renders the
 * `web-ui.plugin.item` slot) and the panel's own「源」view (always
 * available, keeping the plugin standalone).
 */

import { useCallback, useState } from 'react'
import type { RequirementSourceEntry } from '@along/adw-requirement-core'
import * as api from './api.ts'

/** Source rows with inline credential forms (immediate apply via /api/dsh-adw). */
export function SourceConfigBody(props: { sources: RequirementSourceEntry[]; onChanged(): void }): React.JSX.Element {
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
    </div>
  )
}
