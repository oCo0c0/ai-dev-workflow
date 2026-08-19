/**
 * Browser-half HTTP client for the /api/dsh-adw route family.
 *
 * Thin typed wrappers over fetch — same-origin by construction (the client
 * bundle is served by the same webserver that hosts the routes).
 */

import type {
  Requirement,
  RequirementSourceEntry,
  SavedRequirement,
  ExecutionLink,
} from '@along/adw-requirement-core'

/** Base path (must match the host route family). */
const BASE = '/api/dsh-adw'

/** One API error with status and message. */
export class AdwApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Core request helper: JSON in, JSON out, typed errors. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  let body: { message?: string } | undefined
  try {
    body = JSON.parse(await response.text()) as { message?: string }
  } catch {
    body = undefined
  }
  if (!response.ok) {
    throw new AdwApiError(response.status, body?.message ?? `HTTP ${response.status}`)
  }
  return body as T
}

/** GET /sources — requirement source catalog. */
export function listSources(): Promise<RequirementSourceEntry[]> {
  return call('/sources')
}

/** POST /fetch — fetch one requirement by input dialect and save it. */
export function fetchRequirement(input: string, serverName?: string): Promise<SavedRequirement> {
  return call('/fetch', { method: 'POST', body: JSON.stringify({ input, serverName }) })
}

/** GET /search?q= — source-side search (query only). */
export function searchRequirements(query: string, serverName?: string): Promise<Requirement[]> {
  const q = encodeURIComponent(query)
  const s = serverName ? `&server=${encodeURIComponent(serverName)}` : ''
  return call(`/search?q=${q}${s}`)
}

/** GET /requirements — saved requirement list (most recent first). */
export function listRequirements(): Promise<SavedRequirement[]> {
  return call('/requirements')
}

/** GET /requirements/:id — one saved requirement. */
export function getRequirement(id: string): Promise<SavedRequirement> {
  return call(`/requirements/${encodeURIComponent(id)}`)
}

/** DELETE /requirements/:id. */
export function deleteRequirement(id: string): Promise<{ success: boolean }> {
  return call(`/requirements/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** POST /requirements/:id/refresh — re-fetch by original input. */
export function refreshRequirement(id: string): Promise<SavedRequirement> {
  return call(`/requirements/${encodeURIComponent(id)}/refresh`, { method: 'POST' })
}

/** GET /requirements/:id/dev-prompt — rendered dev prompt (template from host config). */
export function getDevPrompt(id: string): Promise<{ prompt: string }> {
  return call(`/requirements/${encodeURIComponent(id)}/dev-prompt`)
}

/** POST /requirements/:id/executions — report a started execution. */
export function reportExecution(
  id: string,
  link: { sessionId: string; workspaceId: string; prompt: string; mode?: string; permission?: string },
): Promise<{ executionId: string; requirement: SavedRequirement }> {
  return call(`/requirements/${encodeURIComponent(id)}/executions`, {
    method: 'POST',
    body: JSON.stringify(link),
  })
}

/** POST /requirements/:id/executions/:execId/settle — report the outcome. */
export function settleExecution(
  id: string,
  executionId: string,
  outcome: ExecutionLink['outcome'],
  error?: string,
): Promise<SavedRequirement> {
  return call(`/requirements/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}/settle`, {
    method: 'POST',
    body: JSON.stringify({ outcome, error }),
  })
}

/** POST /sources/:adapterId/install — one-click source install. */
export function installSource(adapterId: string, env: Record<string, string>): Promise<{ serverName: string; connectionTest?: { ok: boolean; message: string } }> {
  return call(`/sources/${encodeURIComponent(adapterId)}/install`, {
    method: 'POST',
    body: JSON.stringify({ env }),
  })
}

/** POST /servers/:name/test — connection test. */
export function testServer(name: string): Promise<{ ok: boolean; message: string }> {
  return call(`/servers/${encodeURIComponent(name)}/test`, { method: 'POST' })
}

/** DELETE /servers/:name — remove one configured source server. */
export function removeServer(name: string): Promise<{ success: boolean }> {
  return call(`/servers/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
