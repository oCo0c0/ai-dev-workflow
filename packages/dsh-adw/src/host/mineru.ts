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

/** Validate caller options into MinerUParseOptions (defaultBackend wins when caller omits). */
/** User-configured defaults injected from the settings namespace. */
export interface MineruDefaults {
    /** Default backend ('pipeline' = pure CPU, works everywhere). */
    backend?: string
    /** Default OCR language list (['ch']). */
    langList?: string[]
}

export function toParseOptions(options: ParseRequestOptions | undefined, defaults: MineruDefaults = {}): MinerUParseOptions {
    const backend = options?.backend !== undefined && options.backend !== ''
        ? options.backend
        : defaults.backend ?? 'pipeline'
    if (!(MINERU_BACKENDS as readonly string[]).includes(backend)) {
        throw new Error(`unknown backend "${options?.backend}" (use: ${MINERU_BACKENDS.join(' / ')})`)
    }
    return {
        backend: backend as MinerUBackend,
        langList: options?.langList !== undefined && options.langList.length > 0
            ? options.langList
            : defaults.langList ?? ['ch'],
    }
}

/**
 * Parse one document through the configured MinerU service.
 *
 * Auto-fallback: the vlm-* / hybrid-* backends need a configured GPU device
 * server-side; on CPU-only deployments they fail with "Device string must
 * not be empty". When that happens the parse retries once on `pipeline`
 * (pure-CPU, works everywhere) so a wrong default never dead-ends the user.
 *
 * @returns the MinerU result (success=false + error on any failure).
 */
export async function parseDocument(
    engine: RequirementEngine,
    mineruUrl: string,
    input: string,
    options?: ParseRequestOptions,
    defaults: MineruDefaults = {},
): Promise<{ success: boolean; markdown?: string; error?: string; target?: string }> {
    const target = resolveParseTarget(engine, input)
    if ('error' in target) return {success: false, error: target.error}
    const client = new MinerUClient(mineruUrl)
    if (!client.isConfigured()) {
        return {success: false, error: 'MinerU 服务未配置——请在 设置 → 插件 → 需求源 中填写服务地址'}
    }
    const parseOptions = toParseOptions(options, defaults)
    const run = (opts: MinerUParseOptions) => target.kind === 'url'
        ? client.parseUrl(target.url, opts)
        : client.parseFile(target.path, opts)
    let result = await run(parseOptions)
    // 设备缺失（CPU 服务器跑 VLM 系后端）→ 自动回退 pipeline 重试一次
    if (!result.success && /device/i.test(result.error ?? '') && parseOptions.backend !== 'pipeline') {
        result = await run({...parseOptions, backend: 'pipeline'})
    }
    if (!result.success) return {success: false, error: result.error ?? 'parse failed'}
    const markdown = result.markdown ?? ''
    if (markdown === '') return {success: false, error: 'MinerU returned no markdown content'}
    return {success: true, markdown, target: target.kind === 'url' ? target.url : target.path}
}
