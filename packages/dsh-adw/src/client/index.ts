/**
 * dsh-adw client plugin: wires the execution service to the real client
 * runtime and mounts the two DOM surfaces — the sidebar entry row and the
 * requirement panel in the center column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — the web
 * shell fails the whole boot when a plugin apply throws, and an external
 * plugin must not take the GUI down.
 */

import type { ClientContext, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, PromptContentPart } from '@deepseek-ai/dsh-client-connection/client'
import { ExecutionService } from './execution.ts'
import { createPanelController } from './controller.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountPanel } from './panel-mount.tsx'
import { createAdwSettingsTab, ADW_SETTINGS_NS } from './settings-tab.tsx'
import { ensureStyles } from './styles.ts'

/** Module-scope apply claim: a duplicated client injection (module factory
 * executed twice in one page lifetime) must not mount a second entry+panel. */
let claimed = false

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['sessions', 'workspaces', 'connection']

/**
 * Mount the requirement workbench.
 * @param ctx - client root context (services: sessions, workspaces, connection).
 */
export function apply(ctx: ClientContext): void {
  if (claimed) return
  claimed = true
  ctx.effect(() => () => { claimed = false }, 'dsh-adw: apply claim')

  const controller = createPanelController()
  const disposers: Array<() => void> = [ensureStyles()]

  // Official plugin-settings TAB: the dsh-client-ui-settings-plugins section
  // renders localized tabs from the `settings.plugins.tab` slot. One tab —
  // 「需求源」— carries ALL plugin configuration (sources / custom MCP /
  // MinerU); the workbench panel itself carries no configuration surface.
  // Pure official channel; absent settings surface simply means no tab.
  ctx.inject(['slots', 'settingsScope'], (settingsCtx) => {
    const scope = settingsCtx.settingsScope.bind<Record<string, unknown>>({ namespace: ADW_SETTINGS_NS })
    return settingsCtx.slots.inject('settings.plugins.tab', () => {
      const unregister = settingsCtx.slots.register({
        name: 'settings.plugins.tab',
        id: 'adw-sources',
        order: 20,
        label: () => '需求源',
      }, createAdwSettingsTab(scope))
      return () => { unregister() }
    })
  })

  try {
    const sessions = ctx.sessions
    const workspaces = ctx.workspaces
    const connection = ctx.get('connection') as ConnectionHandle

    const exec = new ExecutionService({
      sessions: {
        list: sessions.list,
        binding: (id: string) => {
          const binding = sessions.binding(id as SessionId)
          if (binding === undefined) return undefined
          const { session } = binding
          return {
            session: {
              rename: title => session.rename(title),
              prompt: (content, mode) =>
                session.prompt(content as PromptContentPart[], mode).then(result =>
                  result.ok ? { ok: true as const } : { ok: false as const, error: result.error }),
              command: line =>
                session.command(line).then(result =>
                  result.ok ? { ok: true as const, matched: result.value.matched } : { ok: false as const, error: result.error }),
              getSnapshot: () => session.getSnapshot(),
              subscribe: fn => session.subscribe(fn),
            },
          }
        },
        noteAgentPreset: (sessionId, agentPreset) => sessions.noteAgentPreset(sessionId as SessionId, agentPreset),
      },
      workspaces: {
        list: workspaces.list,
        connectWorkspace: id => workspaces.connectWorkspace(id as WorkspaceId),
      },
      presets: {
        select: async (sessionId, agentPreset) => {
          try {
            const response = await connection.api.agentPresets.select({ sessionId: sessionId as SessionId, agentPreset })
            return response.result.ok ? { ok: true as const } : { ok: false as const, error: response.result.error }
          } catch (error) {
            return { ok: false as const, error }
          }
        },
      },
      history: {
        loadTail: async sessionId => {
          const response = await connection.api.sessions.history({
            sessionId: sessionId as SessionId,
            maxMessages: 20,
          })
          return response.result.ok
            ? { events: response.result.value.events.map(entry => entry.event) }
            : undefined
        },
      },
    })

    disposers.push(mountSidebarEntry(
      () => controller.toggle(),
      () => controller.isOpen(),
      fn => controller.subscribe(fn),
    ))
    disposers.push(mountPanel(controller, {
      exec,
      workspaces: () => {
        const snapshot = workspaces.list.getSnapshot()
        return snapshot.items.map(item => ({
          workspaceId: item.workspaceId,
          title: item.title !== '' ? item.title : item.path,
        }))
      },
      presets: async () => {
        const response = await connection.api.agentPresets.list({})
        if (!response.result.ok) return []
        return response.result.value.presets.map(preset => ({
          id: preset.id,
          name: preset.name ?? preset.id,
          description: preset.description ?? '',
          broken: Boolean(preset.broken),
          isDefault: preset.isDefault,
        }))
      },
      openSession: id => sessions.open(id as SessionId),
    }))
  } catch (error) {
    // DOM failures degrade the panel, never the GUI.
    console.error('[dsh-adw] mount failed:', error)
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-adw: surfaces')
}
