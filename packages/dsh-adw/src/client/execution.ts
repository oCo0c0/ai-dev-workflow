/**
 * Execution service: develops a requirement through dsh's real session
 * machinery (pattern proven by the task-board plugin).
 *
 * The service connects a real session (workspace blank-session reuse or
 * `session.create` on the host via the workspaces service), applies the
 * pinned mode/permission targets BEFORE any prompt, renames it after the
 * requirement, sends the rendered dev prompt with `session.prompt`, and
 * watches the conversation snapshot until the turn settles. Started/settled
 * events are reported to the host store through the injected reporter so the
 * requirement's execution history persists host-side.
 *
 * Deliberately framework-free: runtime faces are declared structurally so
 * tests (and future runtime changes) drive it with narrow fakes.
 */

/** One list-row summary the execution service reads (narrow slice of a SessionSummary). */
export interface ExecutionSessionSummary {
  running: boolean
  completed?: boolean
  /** Empty-log bit: the preset can only be recomposed while the session is blank. */
  blank?: boolean
  /** The preset the session currently runs (absent on deployments without presets). */
  agentPreset?: string
}

/** The narrow sessions face the service needs. */
export interface SessionsExecutionFace {
  list: {
    getSnapshot(): {
      phase: 'pending' | 'ready'
      byId: Record<string, ExecutionSessionSummary>
    }
    subscribe(fn: () => void): () => void
  }
  binding(id: string): { session: SessionDriver } | undefined
  noteAgentPreset?(sessionId: string, agentPreset: string): void
}

/** The narrow agent-preset wire face the service needs. */
export interface PresetsExecutionFace {
  select(sessionId: string, agentPreset: string): Promise<{ ok: true } | { ok: false; error: unknown }>
}

/** The narrow workspaces face the service needs. */
export interface WorkspacesExecutionFace {
  list: {
    getSnapshot(): {
      items: readonly { workspaceId: string }[]
      recentWorkspaceId: string | undefined
    }
  }
  connectWorkspace(workspaceId: string): Promise<string>
}

/** One raw session-history event narrowed to the failure signal reconcile needs. */
export interface ExecutionHistoryEvent {
  type: string
  data?: unknown
}

/** Optional raw-history face used to detect failures of never-opened sessions. */
export interface HistoryExecutionFace {
  loadTail(sessionId: string): Promise<{ events: readonly ExecutionHistoryEvent[] } | undefined>
}

/** The behavior verbs the service invokes on an execution session. */
export interface SessionDriver {
  rename(title: string): Promise<unknown>
  prompt(
    content: readonly unknown[],
    mode: 'queue',
  ): Promise<{ ok: true } | { ok: false; error: unknown }>
  /** Admit one slash-command line (the `/permission <id>` mechanism). */
  command(line: string): Promise<{ ok: true; matched: boolean } | { ok: false; error: unknown }>
  getSnapshot(): { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> }
  subscribe(fn: () => void): () => void
}

/** Everything the service needs from the runtime. */
export interface ExecutionEnvironment {
  sessions: SessionsExecutionFace
  workspaces: WorkspacesExecutionFace
  presets?: PresetsExecutionFace
  history?: HistoryExecutionFace
}

/** One execution request: what to run, where, and how. */
export interface ExecutionRequest {
  /** Requirement id (host store key). */
  requirementId: string
  /** Session title (requirement number + title). */
  title: string
  /** The rendered dev prompt to send. */
  prompt: string
  /** Pinned workspace (required for requirement development). */
  workspaceId: string
  /** Pinned agent preset (optional). */
  mode?: string
  /** Pinned permission preset (optional). */
  permission?: string
}

/** Outcome events the service emits to the controller. */
export type ExecutionEvent =
  | { kind: 'started'; requirementId: string; sessionId: string }
  | { kind: 'settled'; requirementId: string; sessionId: string; outcome: 'succeeded' | 'failed' | 'cancelled'; error?: string }

/** Host-store reporter: persists the execution link and its outcome. */
export interface ExecutionReporter {
  started(requirementId: string, sessionId: string): Promise<{ executionId: string } | undefined>
  settled(requirementId: string, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', error?: string): void
}

/** Human copy for a run failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether a rejected preset switch means "already runs this preset". */
function presetAlreadyRuns(error: unknown, mode: string): boolean {
  if (typeof error !== 'object' || error === null) return false
  const details = (error as { details?: unknown }).details
  if (typeof details !== 'object' || details === null) return false
  return (details as { existingPreset?: unknown }).existingPreset === mode
}

/** Whether a `turn/end` payload closed the turn with an error reason. */
function isErrorTurnEnd(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false
  const reason = (data as { reason?: unknown }).reason
  return typeof reason === 'object' && reason !== null
    && (reason as { kind?: unknown }).kind === 'error'
}

/**
 * Run one requirement development through a real dsh session.
 */
export class ExecutionService {
  constructor(private readonly env: ExecutionEnvironment) {}

  /**
   * Run to completion (or a settled failure). Never rejects — every failure
   * path is reported as a settled event.
   */
  async run(
    request: ExecutionRequest,
    onEvent: (event: ExecutionEvent) => void,
    reporter?: ExecutionReporter,
  ): Promise<void> {
    let executionId: string | undefined
    const settle = (outcome: 'failed' | 'cancelled', error?: string): void => {
      onEvent({ kind: 'settled', requirementId: request.requirementId, sessionId: '', outcome, error })
      if (executionId !== undefined) reporter?.settled(request.requirementId, executionId, outcome, error)
    }
    try {
      const sessionId = await this.connectSession(request.workspaceId)
      onEvent({ kind: 'started', requirementId: request.requirementId, sessionId })
      const driver = this.env.sessions.binding(sessionId)?.session
      if (driver === undefined) {
        settle('failed', 'execution session is not ready')
        return
      }
      // Pinned targets BEFORE any prompt: a preset switch only works on a
      // blank session, and the permission command must precede the turn.
      if (!await this.applyMode(driver, request, sessionId, settle)) return
      if (!await this.applyPermission(driver, request, settle)) return
      // Best-effort rename so the execution is recognizable in the list.
      await driver.rename(request.title).catch(() => { /* cosmetic */ })
      try {
        executionId = (await reporter?.started(request.requirementId, sessionId))?.executionId
      } catch { /* host store hiccup must not kill the run */ }
      const baseline = driver.getSnapshot().turnEnds.size
      const accepted = await this.prompt(driver, request.prompt)
      if (!accepted.ok) {
        settle('failed', messageOf(accepted.error))
        return
      }
      this.watchForSettlement(driver, sessionId, request.requirementId, executionId, reporter, onEvent, baseline)
    } catch (error) {
      settle('failed', messageOf(error))
    }
  }

  /** Recompose the blank session's agent from the pinned preset. */
  private async applyMode(
    driver: SessionDriver,
    request: ExecutionRequest,
    sessionId: string,
    settle: (outcome: 'failed', error?: string) => void,
  ): Promise<boolean> {
    const mode = request.mode
    if (mode === undefined || mode === '') return true
    const summary = this.env.sessions.list.getSnapshot().byId[sessionId]
    if (summary?.blank === false) {
      settle('failed', `cannot switch agent preset to ${mode}: the execution session is not blank`)
      return false
    }
    if (summary?.agentPreset === mode) return true
    const presets = this.env.presets
    if (presets === undefined) {
      settle('failed', `this deployment does not support agent presets (task asks for ${mode})`)
      return false
    }
    try {
      const result = await presets.select(sessionId, mode)
      if (!result.ok) {
        if (presetAlreadyRuns(result.error, mode)) {
          this.env.sessions.noteAgentPreset?.(sessionId, mode)
          return true
        }
        settle('failed', `agent preset switch to ${mode} rejected: ${messageOf(result.error)}`)
        return false
      }
    } catch (error) {
      settle('failed', `agent preset switch to ${mode} failed: ${messageOf(error)}`)
      return false
    }
    this.env.sessions.noteAgentPreset?.(sessionId, mode)
    return true
  }

  /** Apply the pinned permission preset through `/permission <id>`. */
  private async applyPermission(
    driver: SessionDriver,
    request: ExecutionRequest,
    settle: (outcome: 'failed', error?: string) => void,
  ): Promise<boolean> {
    const permission = request.permission
    if (permission === undefined || permission === '') return true
    const line = `/permission ${permission}`
    try {
      const result = await driver.command(line)
      if (!result.ok) {
        settle('failed', `permission command rejected: ${messageOf(result.error)}`)
        return false
      }
      if (!result.matched) {
        settle('failed', `permission command not recognized: ${line}`)
        return false
      }
    } catch (error) {
      settle('failed', `permission command failed: ${messageOf(error)}`)
      return false
    }
    return true
  }

  /**
   * Inspect a reloaded requirement whose last execution has no endedAt and
   * return a settled event when its session already finished.
   */
  async reconcile(requirementId: string, sessionId: string): Promise<{ outcome: 'succeeded' | 'failed' | 'cancelled'; error?: string } | undefined> {
    const list = this.env.sessions.list.getSnapshot()
    if (list.phase !== 'ready') return undefined
    const summary = list.byId[sessionId]
    if (summary === undefined) return { outcome: 'cancelled', error: 'execution session no longer exists' }
    if (summary.running) return undefined
    const driver = this.env.sessions.binding(sessionId)?.session
    if (driver !== undefined) {
      const snapshot = driver.getSnapshot()
      if (snapshot.turnEnds.size > 0) {
        return {
          outcome: snapshot.lastAgentError !== null ? 'failed' : 'succeeded',
          error: snapshot.lastAgentError ?? undefined,
        }
      }
    }
    const failed = await this.historyShowsFailure(sessionId)
    if (failed) return { outcome: 'failed', error: 'agent turn failed' }
    return { outcome: 'succeeded' }
  }

  /** Best-effort failure probe over the raw history tail. */
  private async historyShowsFailure(sessionId: string): Promise<boolean> {
    const history = this.env.history
    if (history === undefined) return false
    try {
      const tail = await history.loadTail(sessionId)
      if (tail === undefined) return false
      return tail.events.some(event => event.type === 'turn/end' && isErrorTurnEnd(event.data))
    } catch {
      return false
    }
  }

  private async connectSession(workspaceId: string): Promise<string> {
    const workspace = this.env.workspaces.list.getSnapshot()
    if (!workspace.items.some(item => item.workspaceId === workspaceId)) {
      throw new Error(`workspace is not available: ${workspaceId}`)
    }
    return this.env.workspaces.connectWorkspace(workspaceId)
  }

  private async prompt(driver: SessionDriver, text: string): Promise<{ ok: true } | { ok: false; error: unknown }> {
    try {
      return await driver.prompt([{ type: 'text', text }], 'queue')
    } catch (error) {
      return { ok: false, error }
    }
  }

  /** Subscribe and settle once the accepted turn completes. */
  private watchForSettlement(
    driver: SessionDriver,
    sessionId: string,
    requirementId: string,
    executionId: string | undefined,
    reporter: ExecutionReporter | undefined,
    onEvent: (event: ExecutionEvent) => void,
    baseline: number,
  ): void {
    let settled = false
    let unsubscribe: () => void = () => {}
    const check = (): void => {
      if (settled) return
      const snapshot = driver.getSnapshot()
      if (snapshot.running || snapshot.turnEnds.size <= baseline) return
      settled = true
      unsubscribe()
      const outcome = snapshot.lastAgentError !== null ? 'failed' : 'succeeded'
      onEvent({
        kind: 'settled', requirementId, sessionId,
        outcome,
        error: snapshot.lastAgentError ?? undefined,
      })
      if (executionId !== undefined) reporter?.settled(requirementId, executionId, outcome, snapshot.lastAgentError ?? undefined)
    }
    unsubscribe = driver.subscribe(check)
    // A turn can complete during the prompt round-trip (before subscribe):
    // re-check immediately so a fast turn is never missed.
    check()
  }
}
