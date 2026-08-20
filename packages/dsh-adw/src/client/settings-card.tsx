/**
 * adw settings card over the OFFICIAL plugin-settings slot.
 *
 * The official dsh-client-ui-settings-plugins package declares the keyed
 * `settings.plugin.item` slot: one card per plugin inside the settings
 * page's configurable-plugins tab, keyed by the settings namespace the card
 * edits. A plugin distributed outside the dsh repository registers its own
 * namespace Host-side (installSettingsSection — done in src/index.ts) and
 * its own card under that key browser-side; the tab pairs the two. This is
 * the officially sanctioned integration point — no third-party surface
 * involved.
 *
 * The 'dsh-adw' namespace anchors availability; the card body edits
 * requirement sources / custom MCP servers / MinerU through the plugin's
 * own /api/dsh-adw routes with immediate effect (no staged-form footer).
 */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the official `settings.plugin.item` keyed slot declaration
// (kind: keyed; scope: root) into the SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Type-only: pulls the settings-surface Context merge (ctx.settingsScope).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RequirementSourceEntry } from '@along/adw-requirement-core'
import * as api from './api.ts'
import { SourceConfigBody } from './source-config.tsx'

/** The settings namespace this card claims — must equal the Host-side
 * installSettingsSection namespace (settingsNamespace is identity). */
export const ADW_SETTINGS_NS = 'dsh-adw'

/** Card-level state: availability anchored on the 'dsh-adw' settings scope. */
export interface AdwSettingsCardState {
  /** False while the namespace is still loading; the card renders nothing. */
  available: boolean
  /** Whether the namespace is actually served to this client. */
  exposed: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface AdwSettingsCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useAdwSettingsCard. */
    adwSettingsCard: SnapshotStore<AdwSettingsCardState>
  }
}

/** The bound 'dsh-adw' scope behind the last-mounted card (set by the
 * registration wiring in index.ts before the card ever renders). */
let cardScope: SettingsScope<Record<string, unknown>> | undefined

/** Record the scope the card body's MinerU row writes through. */
export function noteCardScope(scope: SettingsScope<Record<string, unknown>> | undefined): void {
  cardScope = scope
}

/** Bridges the 'dsh-adw' scope onto the card's availability anchor. */
export class AdwSettingsCardController {
  private readonly store: SnapshotStore<AdwSettingsCardState>
  private readonly unsubscribe: () => void
  /** The bound scope — shared with the card body for the MinerU config row. */
  readonly scope: SettingsScope<Record<string, unknown>>

  /** @param scope - the bound settings scope for the 'dsh-adw' namespace. */
  constructor(scope: SettingsScope<Record<string, unknown>>) {
    this.scope = scope
    const project = (): AdwSettingsCardState => {
      const snapshot = scope.getSnapshot()
      return {
        available: snapshot.status !== 'loading',
        exposed: snapshot.status === 'ready',
      }
    }
    this.store = createSnapshotStore(project())
    this.unsubscribe = scope.subscribe(() => { this.store.set(project()) })
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot store.
   */
  inject(): AdwSettingsCardFace {
    return { hooks: { adwSettingsCard: this.store } }
  }

  /** Release the scope subscription; the slot disposer calls this on teardown. */
  dispose(): void {
    this.unsubscribe()
  }
}

/** Props the renderer binds for the adw card (keyed entry, root scope). */
export type AdwSettingsCardProps =
  PropsRuntime<'settings.plugin.item', typeof ADW_SETTINGS_NS>
  & InjectFace<AdwSettingsCardFace>

/**
 * Render the adw settings card: requirement-source configuration.
 * @param props - the card snapshot (availability anchor).
 * @returns the card, or nothing while the namespace is still loading.
 */
export function AdwSettingsCard(props: AdwSettingsCardProps): React.JSX.Element | null {
  const state = props.useAdwSettingsCard(snapshot => snapshot)
  const [sources, setSources] = useState<RequirementSourceEntry[]>([])
  const [error, setError] = useState('')

  const reload = useCallback(async (): Promise<void> => {
    try {
      setSources(await api.listSources())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  if (!state.available) return null

  return (
    <div className="adw-setCard">
      <div className="adw-setHead">
        <span className="adw-setTitle">adw 需求工作台</span>
        {!state.exposed && <span className="adw-hint">（设置命名空间未暴露，以下配置仍然可用）</span>}
      </div>
      <p className="adw-hint">需求源（ONES / GitHub Issues / 自定义 MCP）与 MinerU 文档解析独立配置：MCP 配置保存在插件自管文件 ~/.dsh/dsh-adw/mcp-servers.json，MinerU 地址存于本设置；修改即时生效，不读写任何其它工具的配置。同一配置也可在需求工作台面板的「源」页中管理。</p>
      {error !== '' && <p className="adw-errorText">{error}</p>}
      <SourceConfigBody sources={sources} onChanged={reload} mineru={{scope: cardScope}} />
    </div>
  )
}
