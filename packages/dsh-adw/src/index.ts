/**
 * @along/dsh-adw — host half. Mounts the requirement engine (requirement
 * source adapters + MCP bridge + config + store, from
 * @along/adw-requirement-core), the /api/dsh-adw route family, the agent
 * tools (adw_fetch_requirement / adw_list_requirements /
 * adw_search_requirements), and a system-prompt announcement. The browser
 * half (./client) renders the requirement workbench panel and drives real
 * dsh sessions. Everything rides official NPM SDK packages — no dsh source
 * changes.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { RequirementEngine, type SavedRequirement } from '@along/adw-requirement-core'
import { makeRoutes } from './host/routes.ts'
import { adwFetchTool, adwListTool, adwSearchTool, adwParseDocumentTool } from './host/tools.ts'
import { mountOnce } from './mount-once.ts'

/** Stable cordis plugin name. */
export const name = 'dsh-adw'

/** Services required before the adw surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/**
 * Settings namespace of the adw capability — the section a settings surface
 * edits. Spelled here rather than imported: the browser half spells the same
 * value and must not depend on a Host package.
 */
export const ADW_SETTINGS_NAMESPACE = settingsNamespace('dsh-adw')

/** Default dev-prompt template (placeholders rendered by renderDevPrompt). */
export const DEFAULT_DEV_PROMPT_TEMPLATE = `基于以下需求完成开发任务。

## 需求：{{title}}（{{number}}）

{{description}}

## 验收标准

{{acceptanceCriteria}}

## 指令

在当前工作区内先理解相关代码结构，制定实现计划，然后完成编码与自测，逐条核对验收标准后给出总结。与需求语言保持一致。`

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (routes, tools, prompt section). */
  enabled?: boolean
  /** When true (default), a system-prompt section announces the plugin to every agent. */
  announceToAgent?: boolean
  /** Dev-prompt template rendered for "执行开发" (placeholders: title/number/id/status/priority/description/acceptanceCriteria). */
  devPromptTemplate?: string
  /** Default requirement source (MCP server name); empty = auto-resolution. */
  defaultServerName?: string
  /** MinerU document-parse service base URL (e.g. http://127.0.0.1:8000); empty = disabled. */
  mineruUrl?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  devPromptTemplate: z.string().default(DEFAULT_DEV_PROMPT_TEMPLATE),
  defaultServerName: z.string().default(''),
  mineruUrl: z.string().default(''),
})

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const ADW_GUIDANCE = '本机已安装 dsh-adw 插件（adw 需求工作台）：侧边栏「需求工作台」入口；在 adw 仓库（packages/dsh-adw + packages/adw-requirement-core）维护。能力：从需求源（ONES / GitHub Issues / 自定义 MCP，支持 stdio（npx/python/docker 等）与远程 http(s) 两种形态；配置由插件自管，存 ~/.dsh/dsh-adw/mcp-servers.json，用户在设置页「插件」分组中配置，与其它工具互不影响）拉取需求文档——adw_fetch_requirement 按链接/编号/issue key 拉取并保存、adw_list_requirements 列已保存需求（含执行状态）、adw_search_requirements 源内搜索；已配置 MinerU 服务时 adw_parse_document 可将 PDF/Word/截图等文档或需求附件（adw-image://需求id/文件名）解析为 Markdown（OCR/表格/公式）；需求保存在 ~/.dsh/dsh-adw/；用户可在 GUI 中选择工作区对需求执行开发（真实 dsh 会话，执行记录回写需求）。限制：插件路由仅本机回环可用；拉取消耗外部系统配额；文档解析会把文件内容发送到用户配置的 MinerU 服务。用户提到「需求 / 拉需求 / 需求工作台 / CWXT-xxx / issue / 解析文档」时即指本插件，请据此协作。'

/** Re-exported for the browser half's type-only imports. */
export type { SavedRequirement }

/** Fully-resolved config (every optional field defaulted). */
interface ResolvedConfig {
  enabled: boolean
  announceToAgent: boolean
  devPromptTemplate: string
  defaultServerName: string
  mineruUrl: string
}

/**
 * Mount the requirement engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
export const apply = mountOnce('@along/dsh-adw', applyImpl)

function applyImpl(ctx: Context, config?: Config): void {
  // The live source the surfaces read: the settings section once a settings
  // surface is served, the composition entry otherwise.
  let current: () => Config = () => config ?? {}
  const resolve = (): ResolvedConfig => {
    const value = current()
    const template = value.devPromptTemplate
    return {
      enabled: value.enabled ?? true,
      announceToAgent: value.announceToAgent ?? true,
      devPromptTemplate: template !== undefined && template.trim() !== '' ? template : DEFAULT_DEV_PROMPT_TEMPLATE,
      defaultServerName: value.defaultServerName ?? '',
      mineruUrl: value.mineruUrl ?? '',
    }
  }

  // dsh home: the same root the profiles live under (DSH_HOME wins when set).
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const engine = new RequirementEngine({
    dataDir: join(dshHome, 'dsh-adw'),
    defaultServerName: resolve().defaultServerName || undefined,
  })
  ctx.effect(() => () => { void engine.dispose() }, 'dsh-adw: engine')

  // Routes + tools + announcement, all re-registered under the enabled gate.
  let disposeRoutes: (() => void) | undefined
  let disposeTools: (() => void) | undefined
  let disposeSection: (() => void) | undefined

  const sync = (): void => {
    const value = resolve()
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (!value.enabled) return
    const routes = makeRoutes({
      engine,
      getDevPromptTemplate: () => resolve().devPromptTemplate,
      getMineruUrl: () => resolve().mineruUrl,
    })
    disposeRoutes = ctx.effect(() => {
      const disposers = routes.map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-adw: routes')
    const tools = [adwFetchTool(engine), adwListTool(engine), adwSearchTool(engine), adwParseDocumentTool(engine, () => resolve().mineruUrl)]
    disposeTools = ctx.effect(() => {
      const disposers = tools.map(tool => ctx.tools.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-adw: tools')
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-adw',
        order: SECTION_ORDER,
        text: ADW_GUIDANCE,
      })
    }
  }

  installSettingsSection(ctx, ADW_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source) => { current = source },
    onChange: sync,
  })

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
