/**
 * Agent tools: every dsh session's agent can fetch requirement documents
 * through the same engine the web UI uses. A host configured in the GUI is
 * immediately operable by any agent, and vice versa — the user can say
 * "拉取 CWXT-130341 并开发" and the agent fetches the document itself.
 *
 * Output schemas use the dsh-tools value-schema DSL (per-property
 * `required: true`; object nodes must declare `additionalProperties`).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { RequirementEngine, SavedRequirement } from '@along/adw-requirement-core'

/** One text content block (the only render shape these tools emit). */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Outcome badge of the latest execution (missing when never run). */
function latestOutcome(req: SavedRequirement): string {
  const last = req.executions[req.executions.length - 1]
  if (last === undefined) return '-'
  if (last.outcome === undefined) return 'running'
  return last.outcome
}

/** One list-row summary (the shape both execute() and render() speak). */
interface RequirementRow {
  id: string
  number?: string
  title: string
  status?: string
  executions?: number
  lastOutcome?: string
}

/** Saved-requirement table render shared by list surfaces. */
function renderList(items: RequirementRow[]): string {
  if (items.length === 0) return 'no saved requirements'
  const rows = items.map(req => [
    req.id,
    req.number ?? '',
    req.title,
    req.status ?? '',
    String(req.executions ?? 0),
    req.lastOutcome ?? '-',
  ].join(' | '))
  return ['id | number | title | status | runs | last', '--- | --- | --- | --- | --- | ---', ...rows].join('\n')
}

/** Requirement document render for the fetch tool. */
function renderDetail(req: SavedRequirement): string {
  const parts = [
    `# ${req.title}`,
    `- id: ${req.id}`,
    req.number ? `- number: ${req.number}` : '',
    `- status: ${req.status} · priority: ${req.priority} · assignee: ${req.assignee || '-'}`,
    `- source: ${req.source.adapterId} (${req.source.serverName}), fetched ${req.source.fetchedAt}`,
  ].filter(Boolean)
  if (req.description !== '') parts.push('', '## Description', '', req.description)
  if (req.acceptanceCriteria.length > 0) {
    parts.push('', '## Acceptance criteria', '', ...req.acceptanceCriteria.map(c => `- [ ] ${c}`))
  }
  if (req.attachments.length > 0) {
    parts.push('', '## Attachments', '', ...req.attachments.map(a => `- [${a.name}](${a.url})`))
  }
  if (req.executions.length > 0) {
    parts.push('', '## Executions', '', ...req.executions.slice(-5).map(e =>
      `- ${e.startedAt} · workspace ${e.workspaceId} · ${e.outcome ?? 'running'}${e.error ? ` · ${e.error}` : ''}`))
  }
  return parts.join('\n')
}

/** The fetch tool: pull one requirement document by input dialect and save it. */
export function adwFetchTool(engine: RequirementEngine) {
  return defineTool({
    name: 'adw_fetch_requirement',
    description: 'Fetch one requirement document from a configured requirement source (ONES / GitHub Issues / generic MCP) by input dialect — ONES link / plain number / issue key (CWXT-130341) / owner/repo#N — and save it to the local requirement store. ' +
      'Returns the full document (title, description, acceptance criteria, attachments). Triggers: the user mentions a requirement, ticket, issue number, or asks to pull/develop a requirement.',
    parameters: {
      input: { type: 'string', required: true, description: 'Requirement locator in the source dialect: ONES link, plain/`#`number, issue key, or owner/repo#N.' },
      serverName: { type: 'string', description: 'Optional target MCP server (from the source catalog); omit for auto-resolution.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirement: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              number: { type: 'string' },
              title: { type: 'string', required: true },
              status: { type: 'string' },
              priority: { type: 'string' },
              assignee: { type: 'string' },
              description: { type: 'string' },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              sourceAdapter: { type: 'string' },
              sourceServer: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value: { requirement?: { id: string; title: string; status?: string } }) =>
        text(value.requirement
          ? `fetched ${value.requirement.id} · ${value.requirement.title} (${value.requirement.status ?? '?'}) — saved to the requirement store`
          : 'fetch failed'),
    },
    async execute(args) {
      const saved = await engine.fetchAndSave(args.input, args.serverName ? { serverName: args.serverName } : undefined)
      return {
        requirement: {
          id: saved.id,
          number: saved.number,
          title: saved.title,
          status: saved.status,
          priority: saved.priority,
          assignee: saved.assignee,
          description: saved.description,
          acceptanceCriteria: saved.acceptanceCriteria,
          sourceAdapter: saved.source.adapterId,
          sourceServer: saved.source.serverName,
        },
      }
    },
  })
}

/** The list tool: saved requirements with execution status. */
export function adwListTool(engine: RequirementEngine) {
  return defineTool({
    name: 'adw_list_requirements',
    description: 'List requirements saved in the local requirement store (with execution history status). Triggers: the user asks which requirements exist / were fetched / were developed.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          requirements: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                number: { type: 'string' },
                title: { type: 'string', required: true },
                status: { type: 'string' },
                executions: { type: 'integer' },
                lastOutcome: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { requirements?: RequirementRow[] }) => text(renderList(value.requirements ?? [])),
    },
    async execute() {
      return {
        requirements: engine.list().map((req): RequirementRow => ({
          id: req.id,
          number: req.number,
          title: req.title,
          status: req.status,
          executions: req.executions.length,
          lastOutcome: latestOutcome(req),
        })),
      }
    },
  })
}

/** The search tool: source-side search without saving. */
export function adwSearchTool(engine: RequirementEngine) {
  return defineTool({
    name: 'adw_search_requirements',
    description: 'Search requirements in an external requirement source through MCP (query-only, nothing is saved). Use it to locate a requirement id before fetching, or to answer "有哪些相关的需求".',
    parameters: {
      query: { type: 'string', required: true, description: 'Search keyword (title/id matching depends on the source).' },
      serverName: { type: 'string', description: 'Optional target MCP server; omit for auto-resolution.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                number: { type: 'string' },
                title: { type: 'string', required: true },
                status: { type: 'string' },
                updatedAt: { type: 'string' },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value: { results?: Array<{ id: string; title: string; status?: string }>; error?: string }) =>
        text(value.error !== undefined
          ? `search failed: ${value.error}`
          : (value.results ?? []).map(r => `${r.id} · ${r.title} (${r.status ?? '?'})`).join('\n') || 'no results'),
    },
    async execute(args) {
      try {
        const results = await engine.search(args.query, args.serverName ? { serverName: args.serverName } : undefined)
        return { results }
      } catch (error) {
        return { results: [], error: messageOf(error) }
      }
    },
  })
}
