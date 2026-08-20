/**
 * adw settings TAB over the official plugins-settings surface.
 *
 * The official dsh-client-ui-settings-plugins section renders localized tabs
 * from the `settings.plugins.tab` slot (kind: list, scope: root; options
 * id/order/label). We register ONE tab —「需求源」— carrying ALL plugin
 * configuration: requirement sources (ONES / GitHub), custom MCP servers
 * (stdio / url), and the MinerU service. The workbench panel itself carries
 * no configuration surface whatsoever.
 *
 * The MinerU row writes through the bound 'dsh-adw' settings scope; MCP
 * source config rides the plugin's own /api/dsh-adw routes with immediate
 * effect (stored in ~/.dsh/dsh-adw/mcp-servers.json).
 */

import { useCallback, useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only merges: the settings surface's Context service (settingsScope)
// and the official `settings.plugins.tab` / `settings.section` SlotMap
// declarations (kind: list; scope: root; options id/order/label).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { RequirementSourceEntry } from '@along/adw-requirement-core'
import * as api from './api.ts'
import { SourceConfigBody } from './source-config.tsx'

/** The settings namespace the tab's MinerU row writes to — must equal the
 * Host-side installSettingsSection namespace (settingsNamespace is identity). */
export const ADW_SETTINGS_NS = 'dsh-adw'

/** The tab panel: one column, sections stacked, no outer chrome (the tab owns it). */
export function AdwSettingsTab(props: { scope: SettingsScope<Record<string, unknown>> }): React.JSX.Element {
  const { scope } = props
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

  return (
    <div className="adw-setTab">
      <p className="adw-hint">需求源（ONES / GitHub / 自定义 MCP）凭据保存在插件自管文件 ~/.dsh/dsh-adw/mcp-servers.json，修改即时生效，不读写任何其它工具的配置；MinerU 地址存于本设置。配置完成后，到侧边栏「需求工作台」拉取需求。</p>
      {error !== '' && <p className="adw-errorText">{error}</p>}
      <SourceConfigBody sources={sources} onChanged={reload} mineru={{scope}} />
    </div>
  )
}

/**
 * Component factory for the registration wiring (index.ts is plain TS — no
 * JSX there): closes over the bound 'dsh-adw' settings scope.
 */
export function createAdwSettingsTab(scope: SettingsScope<Record<string, unknown>>): () => React.JSX.Element {
  return function AdwSettingsTabBound(): React.JSX.Element {
    return <AdwSettingsTab scope={scope} />
  }
}
