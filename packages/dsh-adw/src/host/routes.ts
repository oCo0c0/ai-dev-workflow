/**
 * /api/dsh-adw route family: requirement source catalog, fetch/search, saved
 * requirement CRUD, dev-prompt rendering, and execution-link reporting from
 * the browser half. Every route carries the loopback-only trust fence plus
 * browser same-origin markers.
 *
 * WebRoute hands us every method on the path — each handler checks its own
 * method and path params (no express-style :param extraction exists).
 */

import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { RequirementEngine } from '@along/adw-requirement-core'
import { renderDevPrompt } from '@along/adw-requirement-core'
import { isLoopbackRequest } from './loopback.ts'

/** Cap on JSON request bodies (fetch inputs and execution links are small). */
const MAX_JSON_BODY_BYTES = 256 * 1024

/** Served image content types by extension (default: octet-stream). */
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
}

/** API prefix shared by every route below. */
export const API_PREFIX = '/api/dsh-adw'

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** String body field (trimmed; empty string stays empty). */
function str(body: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = body?.[key]
  return typeof value === 'string' ? value : undefined
}

/** Route-family dependencies. */
export interface AdwRoutesDeps {
  /** The requirement engine (sources, fetch/search, store). */
  engine: RequirementEngine
  /** Live config source: the dev-prompt template renderer reads it. */
  getDevPromptTemplate: () => string
}

/**
 * Build every /api/dsh-adw route (exact paths; params parsed from the tail).
 */
export function makeRoutes(deps: AdwRoutesDeps): WebRoute[] {
  const { engine } = deps

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { code: 'FORBIDDEN', message: 'loopback-only endpoint' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: `use ${method}` })
      return false
    }
    return true
  }

  /** Parse `/api/dsh-adw/...` tail segments. */
  const tail = (req: IncomingMessage): string[] => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    return url.pathname.slice(API_PREFIX.length).split('/').filter(Boolean)
  }

  /** Query param helper. */
  const query = (req: IncomingMessage, name: string): string | undefined => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const value = url.searchParams.get(name)
    return value === null ? undefined : value
  }

  const notFound = (res: ServerResponse): void => {
    writeJson(res, 404, { code: 'NOT_FOUND', message: 'unknown dsh-adw endpoint' })
  }

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const parts = tail(req)
    const head = parts[0] ?? ''

    // ── 源目录与安装 ──────────────────────────────────────────────
    if (head === 'sources' && parts.length === 1) {
      if (!guard(req, res, 'GET')) return
      writeJson(res, 200, engine.listSources())
      return
    }
    if (head === 'sources' && parts.length === 3 && parts[2] === 'install') {
      if (!guard(req, res, 'POST')) return
      const body = await readJsonBody(req)
      const env = (body?.env as Record<string, string>) ?? {}
      try {
        writeJson(res, 200, await engine.installSource(parts[1], env))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = /already exists|Missing required/.test(message) ? 409 : 404
        writeJson(res, status, { code: 'INSTALL_ERROR', message })
      }
      return
    }
    if (head === 'servers' && parts.length === 3 && parts[2] === 'test') {
      if (!guard(req, res, 'POST')) return
      try {
        writeJson(res, 200, await engine.testServer(parts[1]))
      } catch (err) {
        writeJson(res, 500, { code: 'TEST_ERROR', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    // 删除源配置（自管 mcp-servers.json 内的条目）
    if (head === 'servers' && parts.length === 2) {
      if (!guard(req, res, 'DELETE')) return
      writeJson(res, 200, { success: engine.removeServer(parts[1]) })
      return
    }

    // ── 拉取与搜索 ────────────────────────────────────────────────
    if (head === 'fetch') {
      if (!guard(req, res, 'POST')) return
      const body = await readJsonBody(req)
      const input = str(body, 'input')?.trim()
      if (input === undefined || input === '') {
        writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'input is required (requirement number / issue key / link)' })
        return
      }
      const serverName = str(body, 'serverName')
      try {
        writeJson(res, 200, await engine.fetchAndSave(input, serverName ? { serverName } : undefined))
      } catch (err) {
        writeJson(res, 500, { code: 'FETCH_ERROR', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    if (head === 'search') {
      if (!guard(req, res, 'GET')) return
      const q = query(req, 'q')?.trim()
      if (q === undefined || q === '') {
        writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'query parameter "q" is required' })
        return
      }
      const server = query(req, 'server')
      try {
        writeJson(res, 200, await engine.search(q, server ? { serverName: server } : undefined))
      } catch (err) {
        writeJson(res, 500, { code: 'SEARCH_ERROR', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    // ── 已保存需求 ────────────────────────────────────────────────
    if (head === 'requirements' && parts.length === 1) {
      if (!guard(req, res, 'GET')) return
      writeJson(res, 200, engine.list())
      return
    }
    if (head === 'requirements' && parts.length >= 2) {
      const id = decodeURIComponent(parts[1])
      const req0 = engine.get(id)
      if (parts.length === 2) {
        if (req.method === 'GET') {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { code: 'FORBIDDEN', message: 'loopback-only endpoint' }); return }
          if (req0 === undefined) { writeJson(res, 404, { code: 'NOT_FOUND', message: `requirement ${id} not saved` }); return }
          writeJson(res, 200, req0)
          return
        }
        if (req.method === 'DELETE') {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { code: 'FORBIDDEN', message: 'loopback-only endpoint' }); return }
          writeJson(res, 200, { success: engine.delete(id) })
          return
        }
        writeJson(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'use GET or DELETE' })
        return
      }
      const verb = parts[2] ?? ''
      // 本地附件图片（fetch 时已下载改写为该地址；store 侧做过路径清洗）
      if (verb === 'images' && parts.length === 4) {
        if (!guard(req, res, 'GET')) return
        let filename: string
        try {
          filename = decodeURIComponent(parts[3])
        } catch {
          writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'malformed image filename' })
          return
        }
        const filePath = engine.getImagePath(id, filename)
        if (filePath === undefined) {
          writeJson(res, 404, { code: 'NOT_FOUND', message: 'image not found' })
          return
        }
        const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
        const body = readFileSync(filePath)
        res.writeHead(200, {
          'content-type': IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream',
          'cache-control': 'private, max-age=86400',
          'referrer-policy': 'no-referrer',
        })
        res.end(body)
        return
      }
      if (verb === 'refresh' && parts.length === 3) {
        if (!guard(req, res, 'POST')) return
        try {
          const refreshed = await engine.refresh(id)
          if (refreshed === undefined) { writeJson(res, 404, { code: 'NOT_FOUND', message: `requirement ${id} not saved` }); return }
          writeJson(res, 200, refreshed)
        } catch (err) {
          writeJson(res, 500, { code: 'FETCH_ERROR', message: err instanceof Error ? err.message : String(err) })
        }
        return
      }
      if (verb === 'dev-prompt' && parts.length === 3) {
        if (!guard(req, res, 'GET')) return
        if (req0 === undefined) { writeJson(res, 404, { code: 'NOT_FOUND', message: `requirement ${id} not saved` }); return }
        writeJson(res, 200, { prompt: renderDevPrompt(deps.getDevPromptTemplate(), req0) })
        return
      }
      if (verb === 'executions' && parts.length === 3) {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) { writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'invalid JSON body' }); return }
        const sessionId = str(body, 'sessionId')
        const workspaceId = str(body, 'workspaceId')
        const prompt = str(body, 'prompt')
        if (sessionId === undefined || workspaceId === undefined || prompt === undefined) {
          writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'sessionId, workspaceId and prompt are required' })
          return
        }
        const added = engine.addExecution(id, {
          sessionId, workspaceId, prompt,
          mode: str(body, 'mode') || undefined,
          permission: str(body, 'permission') || undefined,
        })
        if (added === undefined) { writeJson(res, 404, { code: 'NOT_FOUND', message: `requirement ${id} not saved` }); return }
        writeJson(res, 200, added)
        return
      }
      if (verb === 'executions' && parts.length === 5 && parts[4] === 'settle') {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const outcome = str(body, 'outcome')
        if (outcome !== 'succeeded' && outcome !== 'failed' && outcome !== 'cancelled') {
          writeJson(res, 400, { code: 'VALIDATION_ERROR', message: 'outcome must be succeeded | failed | cancelled' })
          return
        }
        const settled = engine.settleExecution(id, parts[3], outcome, str(body, 'error'))
        if (settled === undefined) { writeJson(res, 404, { code: 'NOT_FOUND', message: `requirement ${id} not saved` }); return }
        writeJson(res, 200, settled)
        return
      }
      notFound(res)
      return
    }

    notFound(res)
  }

  return [{
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }]
}
