import type { Context } from '@deepseek-ai/cordis'

/** Stable cordis plugin name. */
export declare const name: string
/** Services required before the adw surfaces mount. */
export declare const inject: string[]

/** Plugin config (validated by the same-named schemastery schema). */
export interface Config {
  enabled?: boolean
  announceToAgent?: boolean
  devPromptTemplate?: string
  defaultServerName?: string
}
export declare const Config: Config

/** Host apply: requirement engine + routes + tools + announcement. */
export declare const apply: (ctx: Context, config?: Config) => void
