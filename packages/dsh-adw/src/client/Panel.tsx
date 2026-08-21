/**
 * The requirement workbench panel: source bar + fetch/search, saved
 * requirement cards, requirement detail with execution history, and the
 * execute dialog (workspace / mode / permission / prompt preview). Data
 * lives host-side (/api/dsh-adw); executions ride the real dsh session
 * machinery through the injected ExecutionService.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import type {
  Requirement,
  RequirementSourceEntry,
  SavedRequirement,
} from '@along/adw-requirement-core'
import * as api from './api.ts'
import type { ExecutionService, ExecutionEvent } from './execution.ts'
import type { PanelController } from './controller.ts'

/** Workspace picker option. */
export interface WorkspaceOption {
  workspaceId: string
  title: string
}

/** Agent-preset picker option. */
export interface PresetOption {
  id: string
  name: string
  description: string
  broken: boolean
  isDefault: boolean
}

/** Runtime services the panel consumes (wired in client/index.ts). */
export interface PanelServices {
  exec: ExecutionService
  /** Live workspace list read (runtime snapshot). */
  workspaces(): WorkspaceOption[]
  /** Agent-preset roster (async wire read). */
  presets(): Promise<PresetOption[]>
  /** Jump to a session transcript. */
  openSession(sessionId: string): void
}

/** Panel view state. */
type View =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  | { kind: 'search'; query: string; results: Requirement[] }

/** Execute-target selection inside the dialog. */
interface ExecuteTarget {
  workspaceId: string
  mode: string
  permission: string
}

/** ISO time → short local display. */
function fmtTime(iso: string | undefined): string {
  if (iso === undefined) return '-'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Outcome badge tone. */
function toneOf(outcome: string | undefined, running: boolean): string {
  if (running) return 'running'
  if (outcome === 'succeeded') return 'succeeded'
  if (outcome === 'failed') return 'failed'
  if (outcome === 'cancelled') return 'cancelled'
  return ''
}

const OUTCOME_LABEL: Record<string, string> = {
  succeeded: '已完成', failed: '已失败', cancelled: '已取消', running: '进行中',
}

/**
 * The requirement workbench root component.
 */
export function AdwPanel(props: { controller: PanelController; services: PanelServices }): React.JSX.Element {
  const { controller, services } = props

  const [sources, setSources] = useState<RequirementSourceEntry[]>([])
  const [serverName, setServerName] = useState('')
  const [input, setInput] = useState('')
  const [view, setView] = useState<View>({ kind: 'list' })
  const [reqs, setReqs] = useState<SavedRequirement[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  /** Requirement ids with an in-flight execution (client-side live view). */
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set())

  /** Reload the saved list (and sources when asked). */
  const reload = useCallback(async (withSources = false): Promise<void> => {
    try {
      if (withSources) setSources(await api.listSources())
      setReqs(await api.listRequirements())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  /** Mount: load everything, then reconcile leftover running executions. */
  useEffect(() => {
    void (async () => {
      await reload(true)
      // Reconcile: executions whose session already finished (page was
      // closed/refreshed mid-run) settle against the session list.
      try {
        const list = await api.listRequirements()
        for (const req of list) {
          const last = req.executions[req.executions.length - 1]
          if (last === undefined || last.endedAt !== undefined) continue
          const verdict = await services.exec.reconcile(req.id, last.sessionId)
          if (verdict !== undefined) {
            await api.settleExecution(req.id, last.executionId, verdict.outcome, verdict.error)
          }
        }
        setReqs(await api.listRequirements())
      } catch { /* reconcile is best-effort */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Configured server options across sources. */
  const serverOptions = sources.flatMap(s => s.servers.map(name => ({ value: name, label: `${s.label} · ${name}` })))

  /** Run one requirement development through a real session. */
  const runExecution = useCallback(async (req: SavedRequirement, target: ExecuteTarget, prompt: string): Promise<void> => {
    const title = `[ADW] ${req.number ?? req.id} ${req.title}`.trim()
    setRunning(prev => new Set(prev).add(req.id))
    setError('')
    const onEvent = (event: ExecutionEvent): void => {
      if (event.kind === 'settled') {
        setRunning(prev => { const next = new Set(prev); next.delete(req.id); return next })
        void reload()
      }
    }
    await services.exec.run(
      {
        requirementId: req.id,
        title,
        prompt,
        workspaceId: target.workspaceId,
        mode: target.mode || undefined,
        permission: target.permission || undefined,
      },
      onEvent,
      {
        started: async (requirementId, sessionId) => {
          try {
            return await api.reportExecution(requirementId, {
              sessionId,
              workspaceId: target.workspaceId,
              prompt,
              mode: target.mode || undefined,
              permission: target.permission || undefined,
            })
          } catch { return undefined }
        },
        settled: (requirementId, executionId, outcome, err) => {
          void api.settleExecution(requirementId, executionId, outcome, err).catch(() => undefined)
        },
      },
    )
  }, [reload, services])

  /** Fetch by input dialect and open the detail. */
  const doFetch = useCallback(async (raw: string): Promise<void> => {
    const value = raw.trim()
    if (value === '') return
    setBusy('正在拉取需求…')
    setError('')
    try {
      const saved = await api.fetchRequirement(value, serverName || undefined)
      await reload()
      setView({ kind: 'detail', id: saved.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }, [reload, serverName])

  /** Source-side search. */
  const doSearch = useCallback(async (): Promise<void> => {
    const value = input.trim()
    if (value === '') return
    setBusy('正在搜索…')
    setError('')
    try {
      const results = await api.searchRequirements(value, serverName || undefined)
      setView({ kind: 'search', query: value, results })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }, [input, serverName])

  const detail = view.kind === 'detail' ? reqs.find(r => r.id === view.id) : undefined

  return (
    <div className="adw-root">
      <header className="adw-header">
        <div className="adw-headerRow">
          {view.kind !== 'list' && (
            <button type="button" className="adw-back" onClick={() => setView({ kind: 'list' })}>‹ 返回</button>
          )}
          <span className="adw-title">需求工作台</span>
          <span className="adw-headerSpacer" />
          <button type="button" className="adw-btn adw-btnSm" disabled={busy !== ''} onClick={() => void reload(true)} title="刷新列表">⟳</button>
          {controller.isOpen() && (
            <button type="button" className="adw-back" onClick={() => controller.close()}>返回聊天</button>
          )}
        </div>
        <div className="adw-headerRow">
          <select className="adw-select" value={serverName} onChange={e => setServerName(e.target.value)} title="需求源（MCP server）">
            <option value="">自动解析源</option>
            {serverOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <input
            className="adw-input"
            value={input}
            placeholder="需求号 / issue key / 链接，如 CWXT-130341"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void doFetch(input) }}
          />
          <button type="button" className="adw-btn adw-btnPrimary" disabled={busy !== '' || input.trim() === ''} onClick={() => void doFetch(input)}>拉取</button>
          <button type="button" className="adw-btn" disabled={busy !== '' || input.trim() === ''} onClick={() => void doSearch()}>搜索</button>
        </div>
      </header>

      {busy !== '' && <div className="adw-hint" style={{ padding: '6px 14px' }}>{busy}</div>}
      {error !== '' && <div className="adw-errorText" style={{ padding: '6px 14px' }}>{error}</div>}

      <main className="adw-body">
        {view.kind === 'list' && (
          <ListPage
            reqs={reqs}
            running={running}
            anyConfigured={serverOptions.length > 0}
            onOpen={id => setView({ kind: 'detail', id })}
            onDelete={id => {
              void (async () => {
                setError('')
                try {
                  const r = await api.deleteRequirement(id)
                  if (!r.success) throw new Error('删除失败：需求不存在或已删除')
                  await reload()
                } catch (err) {
                  setError(`删除失败：${err instanceof Error ? err.message : String(err)}`)
                }
              })()
            }}
          />
        )}
        {view.kind === 'search' && (
          <SearchPage
            query={view.query}
            results={view.results}
            onFetch={value => void doFetch(value)}
          />
        )}
        {view.kind === 'detail' && detail !== undefined && (
          <DetailPage
            req={detail}
            running={running.has(detail.id)}
            services={services}
            onRun={(target, prompt) => void runExecution(detail, target, prompt).then(() => reload())}
            onRefresh={async () => {
              setBusy('正在重拉…')
              try {
                await api.refreshRequirement(detail.id)
                await reload()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              } finally { setBusy('') }
            }}
            onChanged={() => reload()}
          />
        )}
        {view.kind === 'detail' && detail === undefined && (
          <div className="adw-empty">需求不存在或已删除</div>
        )}
      </main>
    </div>
  )
}

/** List page: requirement cards (+ first-run guidance when no source configured). */
function ListPage(props: {
  reqs: SavedRequirement[]
  running: ReadonlySet<string>
  anyConfigured: boolean
  onOpen(id: string): void
  onDelete(id: string): void
}): React.JSX.Element {
  const { reqs, running, anyConfigured, onOpen, onDelete } = props
  const [confirmId, setConfirmId] = useState('')
  if (reqs.length === 0 && !anyConfigured) {
    return (
      <div className="adw-firstRun">
        <div className="adw-firstRunTitle">从配置一个需求源开始</div>
        <div className="adw-hint">打开 设置 → 插件 →「需求源」配置 ONES / GitHub / 自定义 MCP；</div>
        <div className="adw-hint">配置完成后回到这里，在上方输入需求号 / issue key / 链接拉取需求。</div>
      </div>
    )
  }
  if (reqs.length === 0) {
    return <div className="adw-empty">还没有需求。在上方输入需求号 / issue key / 链接拉取第一个需求。</div>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="adw-grid">
        {reqs.map(req => {
          const last = req.executions[req.executions.length - 1]
          const isRunning = running.has(req.id) || (last !== undefined && last.endedAt === undefined)
          const confirming = confirmId === req.id
          return (
            <div
              key={req.id} className="adw-card" role="button" tabIndex={0}
              onClick={() => { if (!confirming) onOpen(req.id) }}
              onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !confirming) { e.preventDefault(); onOpen(req.id) } }}
            >
              <span className="adw-cardTop">
                <span className="adw-cardNumber">{req.number ?? req.id}</span>
                <span className="adw-badge" data-tone={toneOf(last?.outcome, isRunning)}>
                  {isRunning ? OUTCOME_LABEL.running : last !== undefined ? (OUTCOME_LABEL[last.outcome ?? ''] ?? '未执行') : '未执行'}
                </span>
                {confirming ? (
                  <span className="adw-cardConfirm" onClick={e => e.stopPropagation()}>
                    <span className="adw-hint">删除这条需求？</span>
                    <button type="button" className="adw-btn adw-btnSm adw-btnDanger" onClick={() => { setConfirmId(''); onDelete(req.id) }}>删除</button>
                    <button type="button" className="adw-btn adw-btnSm" onClick={() => setConfirmId('')}>取消</button>
                  </span>
                ) : (
                  <button
                    type="button" className="adw-cardDel" title="删除"
                    onClick={e => { e.stopPropagation(); setConfirmId(req.id) }}
                  >✕</button>
                )}
              </span>
              <span className="adw-cardTitle">{req.title}</span>
              <span className="adw-cardMeta">
                <span>{req.source.adapterId}</span>
                <span>·</span>
                <span>{req.status}</span>
                <span>·</span>
                <span>执行 {req.executions.length} 次</span>
                <span>·</span>
                <span>{fmtTime(req.source.fetchedAt)}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Search results page. */
function SearchPage(props: { query: string; results: Requirement[]; onFetch(value: string): void }): React.JSX.Element {
  const { results, onFetch } = props
  if (results.length === 0) return <div className="adw-empty">没有匹配的需求</div>
  return (
    <section className="adw-section">
      <div className="adw-sectionTitle">搜索结果（{results.length}）— 点击拉取并保存</div>
      <div className="adw-sectionBody">
        {results.map(r => (
          <button type="button" key={r.id} className="adw-execRow" style={{ cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit' }} onClick={() => onFetch(String(r.number ?? r.id).replace('#', ''))}>
            <span className="adw-cardNumber">{r.number ?? r.id}</span>
            <span style={{ flex: 1 }}>{r.title}</span>
            <span className="adw-badge">{r.status}</span>
            <span className="adw-hint">{fmtTime(r.updatedAt)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

/** Requirement detail page. */
function DetailPage(props: {
  req: SavedRequirement
  running: boolean
  services: PanelServices
  onRun(target: ExecuteTarget, prompt: string): void
  onRefresh(): void
  onChanged(): Promise<void>
}): React.JSX.Element {
  const { req, running, services, onRun, onRefresh, onChanged } = props
  const [dialogOpen, setDialogOpen] = useState(false)
  /** 瞬态解析态（loading/error），按附件名索引；done 态读服务端 req.parsedAttachments */
  const [localParsed, setLocalParsed] = useState<Record<string, { status: 'loading' } | { status: 'error'; error: string }>>({})
  /** 批量解析进度（顺序执行，可取消） */
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const cancelBatchRef = useRef(false)
  /** 文档编辑态 */
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copiedName, setCopiedName] = useState('')
  const last = req.executions[req.executions.length - 1]
  const isRunning = running || (last !== undefined && last.endedAt === undefined)

  const serverParsed = req.parsedAttachments ?? {}
  const displayDesc = req.workingDescription ?? req.description
  const sourceNewer = req.workingUpdatedAt !== undefined && req.source.fetchedAt > req.workingUpdatedAt
  /** 该附件的解析结果是否已合并进文档 */
  const mergedIn = (name: string): boolean =>
    req.workingDescription !== undefined && req.workingDescription.includes(`<!--adw-parse:${name}-->`)

  /** 解析一份附件：host 侧解析 + 落盘，然后刷新需求 */
  const doParse = (name: string): Promise<void> => {
    setLocalParsed(prev => ({ ...prev, [name]: { status: 'loading' } }))
    return api.parseAttachment(req.id, name)
      .then(async result => {
        if (!result.success) throw new Error(result.error ?? '解析失败')
        setLocalParsed(prev => { const next = { ...prev }; delete next[name]; return next })
        await onChanged()
      })
      .catch(err => {
        setLocalParsed(prev => ({ ...prev, [name]: { status: 'error', error: err instanceof Error ? err.message : String(err) } }))
      })
  }

  /** 批量解析全部「未解析」附件（顺序，可取消） */
  const parseAll = (): void => {
    const pending = req.attachments.filter(a => serverParsed[a.name] === undefined)
    if (pending.length === 0 || progress !== null) return
    cancelBatchRef.current = false
    void (async () => {
      for (let i = 0; i < pending.length; i++) {
        if (cancelBatchRef.current) break
        setProgress({ done: i, total: pending.length, current: pending[i].name })
        await doParse(pending[i].name)
      }
      setProgress(null)
    })()
  }

  /** 合并全部解析结果进文档工作副本（幂等，host 侧文本手术） */
  const doMerge = (): void => {
    void (async () => {
      try { await api.mergeParses(req.id); await onChanged() } catch { /* 400 = 没有可合并项 */ }
    })()
  }

  /** 复制一份解析结果的 Markdown 源码（保表格结构） */
  const copyMarkdown = (name: string, markdown: string): void => {
    void navigator.clipboard?.writeText(markdown).then(() => {
      setCopiedName(name)
      setTimeout(() => setCopiedName(''), 1500)
    })
  }

  const startEdit = (): void => { setDraft(displayDesc); setEditing(true) }
  const saveEdit = (): void => {
    void (async () => {
      try { await api.saveDescription(req.id, draft); setEditing(false); await onChanged() } catch { /* 保持编辑态 */ }
    })()
  }
  const revertEdit = (): void => {
    void (async () => {
      try { await api.revertDescription(req.id); setEditing(false); await onChanged() } catch { /* ignore */ }
    })()
  }

  return (
    <div className="adw-detail">
      <div className="adw-detailHead">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="adw-cardNumber">{req.number ?? req.id}</span>
          <span className="adw-badge" data-tone={toneOf(last?.outcome, isRunning)}>
            {isRunning ? OUTCOME_LABEL.running : last !== undefined ? (OUTCOME_LABEL[last.outcome ?? ''] ?? '未执行') : '未执行'}
          </span>
          <span className="adw-badge">{req.source.adapterId} · {req.source.serverName}</span>
          <span className="adw-hint">拉取于 {fmtTime(req.source.fetchedAt)}</span>
        </div>
        <div className="adw-detailTitle">{req.title}</div>
        <div className="adw-cardMeta">
          <span className="adw-badge">状态 {req.status}</span>
          <span className="adw-badge">优先级 {req.priority}</span>
          {req.assignee !== '' && <span className="adw-badge">负责人 {req.assignee}</span>}
        </div>
        <div className="adw-detailActions">
          <button type="button" className="adw-btn adw-btnPrimary" disabled={isRunning} onClick={() => setDialogOpen(true)}>执行开发…</button>
          <button type="button" className="adw-btn" onClick={onRefresh}>重新拉取</button>
        </div>
      </div>

      <section className="adw-section">
        <div className="adw-sectionTitle">
          <span>需求描述</span>
          {req.workingDescription !== undefined && <span className="adw-badge">已编辑</span>}
          {sourceNewer && <span className="adw-hint">源已更新（本地编辑基于旧版，可还原后重新合并）</span>}
          <span className="adw-sectionSpacer" />
          {editing ? (
            <>
              <button type="button" className="adw-btn adw-btnPrimary adw-btnSm" onClick={saveEdit}>保存</button>
              <button type="button" className="adw-btn adw-btnSm" onClick={() => setEditing(false)}>取消</button>
            </>
          ) : (
            <>
              <button type="button" className="adw-btn adw-btnSm" onClick={startEdit}>编辑</button>
              {req.workingDescription !== undefined && (
                <button type="button" className="adw-btn adw-btnSm" onClick={revertEdit} title="放弃本地编辑与合并，回到源描述">还原</button>
              )}
            </>
          )}
        </div>
        <div className="adw-sectionBody">
          {editing
            ? <textarea className="adw-descEdit" value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false} />
            : <div className="adw-desc">{displayDesc !== '' ? <Markdown text={displayDesc} /> : '（无描述）'}</div>}
        </div>
      </section>

      {req.acceptanceCriteria.length > 0 && (
        <section className="adw-section">
          <div className="adw-sectionTitle">验收标准</div>
          <div className="adw-sectionBody">
            {req.acceptanceCriteria.map((c, i) => (
              <div key={i} className="adw-check"><span className="adw-checkDot">☐</span><span>{c}</span></div>
            ))}
          </div>
        </section>
      )}

      {req.attachments.length > 0 && (
        <section className="adw-section">
          <div className="adw-sectionTitle">
            <span>附件（已解析 {Object.keys(serverParsed).length}/{req.attachments.length}）</span>
            <span className="adw-sectionSpacer" />
            {progress !== null ? (
              <span className="adw-hint">{progress.done + 1}/{progress.total} · {progress.current}</span>
            ) : Object.keys(serverParsed).length > 0 ? (
              <button type="button" className="adw-btn adw-btnPrimary adw-btnSm" onClick={doMerge}>合并到文档</button>
            ) : null}
            {progress !== null ? (
              <button type="button" className="adw-btn adw-btnSm" onClick={() => { cancelBatchRef.current = true }}>停止</button>
            ) : req.attachments.some(a => serverParsed[a.name] === undefined) ? (
              <button type="button" className="adw-btn adw-btnSm" onClick={parseAll} title="顺序解析全部未解析附件（MinerU）">解析全部</button>
            ) : null}
          </div>
          <div className="adw-sectionBody">
            {req.attachments.map((a, i) => {
              const local = localParsed[a.name]
              const done = serverParsed[a.name]
              const status: 'loading' | 'done' | 'error' | undefined =
                local?.status === 'loading' ? 'loading' : local?.status === 'error' ? 'error' : done !== undefined ? 'done' : undefined
              return (
                <div key={i} className="adw-attItem">
                  <div className="adw-attRow">
                    <a className="adw-link" href={a.url} target="_blank" rel="noreferrer">{a.name}</a>
                    {mergedIn(a.name) && <span className="adw-badge" data-tone="succeeded">已入文档</span>}
                    <span className="adw-srcSpacer" />
                    {status === 'done' && (
                      <button type="button" className="adw-btn adw-btnSm" onClick={() => copyMarkdown(a.name, done.markdown)}>
                        {copiedName === a.name ? '已复制' : '复制源码'}
                      </button>
                    )}
                    <button
                      type="button" className="adw-btn adw-btnSm"
                      disabled={status === 'loading'}
                      title="通过 MinerU 解析为 Markdown（需在 设置 → 插件 → 需求源 中配置 MinerU 服务）"
                      onClick={() => void doParse(a.name)}
                    >{status === 'loading' ? '解析中…' : status === 'done' ? '重新解析' : '解析'}</button>
                  </div>
                  {status === 'done' && (
                    <div className="adw-parseResult">
                      <div className="adw-parseHead">解析结果（{done.backend} · {fmtTime(done.parsedAt)}）</div>
                      <div className="adw-desc">{done.markdown.trim() !== '' ? <Markdown text={done.markdown} /> : '（无文本内容）'}</div>
                    </div>
                  )}
                  {status === 'error' && <div className="adw-errorText">解析失败：{local.status === 'error' ? local.error : ''}</div>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {req.relatedIssues.length > 0 && (
        <section className="adw-section">
          <div className="adw-sectionTitle">关联问题</div>
          <div className="adw-sectionBody">
            {req.relatedIssues.map((r, i) => (
              <div key={i} className="adw-execRow"><span className="adw-cardNumber">{r.id}</span><span style={{ flex: 1 }}>{r.title}</span><span className="adw-badge">{r.status}</span></div>
            ))}
          </div>
        </section>
      )}

      <section className="adw-section">
        <div className="adw-sectionTitle">执行历史（{req.executions.length}）</div>
        <div className="adw-sectionBody">
          {req.executions.length === 0 && <span className="adw-hint">尚未执行过开发</span>}
          {[...req.executions].reverse().map(e => (
            <div key={e.executionId} className="adw-execRow">
              <span className="adw-badge" data-tone={toneOf(e.outcome, e.endedAt === undefined)}>
                {e.endedAt === undefined ? OUTCOME_LABEL.running : (OUTCOME_LABEL[e.outcome ?? ''] ?? e.outcome)}
              </span>
              <span className="adw-hint">{fmtTime(e.startedAt)}</span>
              <span className="adw-badge">{e.mode !== undefined && e.mode !== '' ? `模式 ${e.mode}` : '默认模式'}</span>
              {e.permission !== undefined && e.permission !== '' && <span className="adw-badge">{e.permission}</span>}
              {e.error !== undefined && e.error !== '' && <span className="adw-errorText">{e.error}</span>}
              <button type="button" className="adw-back" onClick={() => services.openSession(e.sessionId)}>查看会话</button>
            </div>
          ))}
        </div>
      </section>

      {dialogOpen && (
        <ExecuteDialog
          req={req}
          services={services}
          onClose={() => setDialogOpen(false)}
          onRun={(target, prompt) => { setDialogOpen(false); onRun(target, prompt) }}
        />
      )}
    </div>
  )
}

/** The execute dialog: target pickers + editable prompt preview. */
function ExecuteDialog(props: {
  req: SavedRequirement
  services: PanelServices
  onClose(): void
  onRun(target: ExecuteTarget, prompt: string): void
}): React.JSX.Element {
  const { req, services, onClose, onRun } = props
  const [prompt, setPrompt] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [mode, setMode] = useState('')
  const [permission, setPermission] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [presets, setPresets] = useState<PresetOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const [promptResult] = await Promise.all([api.getDevPrompt(req.id)])
        setPrompt(promptResult.prompt)
        setWorkspaces(services.workspaces())
        try {
          setPresets(await services.presets())
        } catch { /* preset roster is optional */ }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req.id])

  const runnable = !loading && error === '' && workspaceId !== '' && prompt.trim() !== ''

  return (
    <div className="adw-modalBackdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="adw-modal" onClick={e => e.stopPropagation()}>
        <div className="adw-modalTitle">执行开发 · {req.number ?? req.id} {req.title}</div>
        {loading && <div className="adw-hint">正在准备（渲染开发 Prompt / 读取工作区列表）…</div>}
        {error !== '' && <div className="adw-errorText">{error}</div>}
        {!loading && (
          <>
            <div className="adw-fieldRow">
              <label className="adw-field">
                <span className="adw-fieldLabel">工作区 *</span>
                <select className="adw-select" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}>
                  <option value="">选择工作区…</option>
                  {workspaces.map(w => <option key={w.workspaceId} value={w.workspaceId}>{w.title}</option>)}
                </select>
              </label>
              <label className="adw-field">
                <span className="adw-fieldLabel">模式（agent 预设）</span>
                <select className="adw-select" value={mode} onChange={e => setMode(e.target.value)}>
                  <option value="">运行时默认</option>
                  {presets.map(p => <option key={p.id} value={p.id} disabled={p.broken}>{p.name}{p.isDefault ? '（默认）' : ''}{p.broken ? '（不可用）' : ''}</option>)}
                </select>
              </label>
              <label className="adw-field">
                <span className="adw-fieldLabel">权限</span>
                <select className="adw-select" value={permission} onChange={e => setPermission(e.target.value)}>
                  <option value="">会话默认</option>
                  <option value="read-only">read-only</option>
                  <option value="workspace-write">workspace-write</option>
                  <option value="danger-full-access">danger-full-access</option>
                </select>
              </label>
            </div>
            {workspaces.length === 0 && <div className="adw-hint">当前没有可用工作区；请先在 DSH 中打开一个项目目录。</div>}
            <label className="adw-field">
              <span className="adw-fieldLabel">开发 Prompt（可直接编辑；执行会话以此为指令）</span>
              <textarea className="adw-textarea" value={prompt} onChange={e => setPrompt(e.target.value)} spellCheck={false} />
            </label>
            <div className="adw-modalActions">
              <button type="button" className="adw-btn" onClick={onClose}>取消</button>
              <button
                type="button"
                className="adw-btn adw-btnPrimary"
                disabled={!runnable}
                title={permission === 'danger-full-access' ? '完整磁盘访问权限，请确认' : undefined}
                onClick={() => {
                  if (permission === 'danger-full-access' && !window.confirm('danger-full-access 将授予完整磁盘访问权限，确认执行？')) return
                  onRun({ workspaceId, mode, permission }, prompt)
                }}
              >
                确认执行
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Markdown renderer for requirement descriptions and parsed documents.
 *  Same stack as the adw app (react-markdown + remark-gfm + rehype-raw):
 *  renders GFM tables / lists / headings properly instead of dumping raw
 *  text with pre-wrap line breaks. Styling lives in styles.ts (.adw-md). */
function Markdown({ text }: { text: string }) {
  return (
    <div className="adw-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({href, children}) => (
            <a className="adw-mdLink" href={href} target="_blank" rel="noreferrer">{children}</a>
          ),
          img: ({src, alt}) => (
            <img className="adw-mdImg" src={src} alt={alt || ''} loading="lazy" />
          ),
          // 表格外包一层横向滚动容器（宽表不被挤压截断）
          table: ({children}) => (
            <div className="adw-mdTableWrap"><table>{children}</table></div>
          ),
        }}
      >{text}</ReactMarkdown>
    </div>
  )
}
