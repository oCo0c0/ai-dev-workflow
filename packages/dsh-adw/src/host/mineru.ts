/**
 * MinerU parse helper shared by the agent tool and the /mineru routes.
 *
 * Input dialect (one string, auto-detected):
 * - `http(s)://…`      — remote document URL (downloaded, then parsed)
 * - `adw-image://<requirementId>/<filename>` — one saved requirement's
 *   downloaded attachment image (the plugin's own store, path-scrubbed)
 * - anything else      — local file path (absolute recommended)
 *
 * The configured MinerU service receives the file content — the service URL
 * is user-configured in the settings card, so the trust boundary is the
 * user's own choice of endpoint.
 */

import {MinerUClient, type MinerUBackend, type MinerUParseOptions} from '@along/adw-requirement-core'
import type {RequirementEngine} from '@along/adw-requirement-core'

/** Backends MinerU accepts (validated before hitting the service). */
export const MINERU_BACKENDS: readonly MinerUBackend[] = [
    'pipeline', 'vlm-auto-engine', 'vlm-http-client', 'hybrid-auto-engine', 'hybrid-http-client',
] as const

/** Resolved parse target after input-dialect detection. */
type ParseTarget =
    | { kind: 'file'; path: string }
    | { kind: 'url'; url: string }

/** Detect the input dialect and resolve saved-attachment refs to real paths. */
export function resolveParseTarget(engine: RequirementEngine, input: string): ParseTarget | { error: string } {
    const value = input.trim()
    if (value === '') return {error: 'input is empty'}
    if (/^https?:\/\//i.test(value)) return {kind: 'url', url: value}
    if (value.toLowerCase().startsWith('adw-image://')) {
        const rest = value.slice('adw-image://'.length)
        const slash = rest.indexOf('/')
        if (slash <= 0 || slash === rest.length - 1) {
            return {error: 'adw-image ref must be adw-image://<requirementId>/<filename>'}
        }
        const id = decodeURIComponent(rest.slice(0, slash))
        let filename: string
        try {
            filename = decodeURIComponent(rest.slice(slash + 1))
        } catch {
            return {error: 'malformed filename encoding in adw-image ref'}
        }
        const filePath = engine.getImagePath(id, filename)
        if (filePath === undefined) return {error: `attachment not found: ${id}/${filename} (is the requirement saved?)`}
        return {kind: 'file', path: filePath}
    }
    return {kind: 'file', path: value}
}

/** Parse options accepted from callers (validated subset). */
export interface ParseRequestOptions {
    /** MinerU backend; default hybrid-auto-engine. */
    backend?: string
    /** OCR language list; default ['ch']. */
    langList?: string[]
}

/** Validate caller options into MinerUParseOptions. */
export function toParseOptions(options: ParseRequestOptions | undefined): MinerUParseOptions {
    const backend = options?.backend !== undefined && options.backend !== ''
        ? options.backend
        : 'hybrid-auto-engine'
    if (!(MINERU_BACKENDS as readonly string[]).includes(backend)) {
        throw new Error(`unknown backend "${options?.backend}" (use: ${MINERU_BACKENDS.join(' / ')})`)
    }
    return {
        backend: backend as MinerUBackend,
        langList: options?.langList !== undefined && options.langList.length > 0 ? options.langList : ['ch'],
    }
}

/**
 * Parse one document through the configured MinerU service.
 * @returns the MinerU result (success=false + error on any failure).
 */
export async function parseDocument(
    engine: RequirementEngine,
    mineruUrl: string,
    input: string,
    options?: ParseRequestOptions,
): Promise<{ success: boolean; markdown?: string; error?: string; target?: string }> {
    const target = resolveParseTarget(engine, input)
    if ('error' in target) return {success: false, error: target.error}
    const client = new MinerUClient(mineruUrl)
    if (!client.isConfigured()) {
        return {success: false, error: 'MinerU service is not configured — set the service URL in the settings card (设置 → 插件 → adw) or the panel「源」page'}
    }
    const parseOptions = toParseOptions(options)
    const result = target.kind === 'url'
        ? await client.parseUrl(target.url, parseOptions)
        : await client.parseFile(target.path, parseOptions)
    if (!result.success) return {success: false, error: result.error ?? 'parse failed'}
    const markdown = result.markdown ?? ''
    if (markdown === '') return {success: false, error: 'MinerU returned no markdown content'}
    return {success: true, markdown, target: target.kind === 'url' ? target.url : target.path}
}
