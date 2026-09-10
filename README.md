# AI Dev Workbench (adw)

AI-powered development workbench that closes the loop between requirements, planning, AI-assisted coding, and automated testing — with a pluggable multi-engine agent layer (**Claude Code / OpenAI Codex / [pi coding agent](https://github.com/earendil-works/pi-coding-agent)**).

```
requirement → plan → execute → test → review, all in one local workbench
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, i18next (EN/中文) |
| **Backend** | Express.js, TypeScript, WebSocket (ws) |
| **AI Engines** | Claude Agent SDK (bridge subprocess) · OpenAI Codex SDK · pi coding agent (RPC subprocess harness) |
| **Protocol** | MCP (Model Context Protocol) — aggregated gateway for engines |
| **State** | Zustand (client) + JSON file persistence (server, `~/.ai-dev-workbench/`) |
| **Testing** | Vitest (self) · Jest / Playwright / PyTest / JUnit auto-detection (targets) |
| **CLI** | Node.js CLI (`adw`), `npx` supported |

## Multi-Engine Architecture

All engines implement one `CLIProvider` interface and can be switched at runtime:

- **Claude Code** — Claude Agent SDK wrapped in a persistent bridge subprocess (`stdin/stdout` JSON lines, session resumption).
- **OpenAI Codex** — Codex SDK embedded in-process.
- **pi coding agent** — runs as a **headless RPC subprocess** (`pi --mode rpc`, one process per run, session files resumed via `--session`), loaded with the `adw-platform` extension that provides the permission gate and MCP bridge. No SDK coupling — engine upgrades only need the RPC protocol to stay compatible.

The engine-neutral **platform layer** (`src/server/platform/`) owns tool classification, the native tool registry, and the MCP gateway:

```
                    ┌────────────────────────────┐
   MCP registry ────┤        McpGateway          ├── /api/mcp       (HTTP MCP → Claude SDK)
   Native tools ────┤  upstream pool, reconnect   ├── /api/platform  (REST → pi adw extension)
                    └────────────────────────────┘
```

Permission confirmations flow uniformly to the web UI (`allow / deny / remember`), regardless of engine.

## Features

### Requirements Management
- Fetch requirements from **ONES**, **GitHub Issues**, or any MCP-compatible source (hot-pluggable adapters: link / issue-key / `owner/repo#N` input dialects)
- One folder per requirement (`metadata.json` + `document.md` + `images/`)
- **MinerU document parsing** — turn PDF / Word / PPT / Excel / screenshot attachments into Markdown (OCR, tables, formulas)
- Local search and full-text browse

### Planning & Execution
- Analyze requirements with project context → structured development plans (multi-turn conversation supported)
- Step-by-step execution with **pause / retry / skip / abort**, streaming logs over WebSocket
- Auto-trigger tests after execution when a pipeline is configured
- Skill queues per phase; task export to xlsx

### Autonomous Agent Execution
- Long-running agent sessions with live **thinking / tool_use / tool_result** event stream
- **Permission dialogs** for side-effect tools (bash / write / edit / platform tools), with allow / deny / remember
- Subtask step tracking, abort, queued replies, session resume across workbench restarts

### Multi-Task Scheduling
- Parallel task orchestration across workspaces (coordinator mode)

### Automated Testing
- Framework auto-detection: Jest / Vitest / Mocha, Playwright, PyTest / unittest, JUnit / Maven / Gradle, generic CLI
- Run existing tests, **AI-generate tests**, or AI E2E mode
- Optional **Daytona sandbox** (three-phase workflow) and changed-files targeted testing

### Pipelines · Skills · MCP
- Configurable workflow templates with per-phase skill / MCP tool / test-strategy settings
- Skill management merging built-in templates with provider-external skills
- MCP server CRUD (stdio & HTTP), connectivity test, per-phase tool whitelists

### Model Providers
- Custom provider records (`models.json`) with API keys; per-engine model selection and thinking-level control
- pi engine: multi-provider routing (DeepSeek / Anthropic / Gemini / Qwen / …) with environment key injection

### Memory & Analytics (self-improving)
- Cross-session memory: user profile, per-project facts, feedback log
- Execution analytics: success/failure patterns, skill effectiveness
- Prompt enrichment injects learned context into AI calls

### Developer Experience
- WebSocket live updates with exponential-backoff reconnect
- Keyboard shortcuts (`Ctrl+1-8` navigation, `Ctrl+G` plan, `Ctrl+Enter` execute, `Ctrl+T` test)
- Dark / light theme, EN / 中文 UI, first-run setup wizard, cross-platform folder picker
- Optional API-key auth (`X-API-Key` header) for the whole `/api/*` surface

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Browser (SPA)                          │
│   React 18 + Zustand + Tailwind · 11 pages · i18n EN/中文    │
└──────────────────────────────┬───────────────────────────────┘
                               │ REST + WebSocket
┌──────────────────────────────┴───────────────────────────────┐
│                  Express.js server (dev :3000)               │
│  routes (15 groups) → services → persistence                 │
│                                                              │
│  cli-providers/          platform/ (engine-neutral)          │
│   ├─ claude → bridge ──── /api/mcp  (HTTP MCP face)          │
│   ├─ codex  → SDK         requirement-sources/               │
│   └─ pi     → RPC proc ── /api/platform (REST face)          │
│                                      ↑ adw-platform extension│
└──────────┬───────────────────────────┴───────────────────────┘
           │
   ~/.ai-dev-workbench/ (JSON persistence, one folder/file per record)
```

## Requirements

- **Node.js** >= 18 (pnpm for development)
- At least one AI engine available / configured (Claude Code CLI, Codex, or pi + a model provider API key)
- **Git** — for workspace change tracking
- Optional: MCP servers (requirement sources), MinerU service (document parsing), Daytona (sandbox testing)

## Installation

```bash
npm install -g @along/ai-dev-workbench
```

## Quick Start

```bash
# after global install
adw

# or run directly
npx @along/ai-dev-workbench
```

The workbench starts on an available port and prints the access URL. A first-run wizard checks engine and MCP status.

## Desktop App (Electron, macOS / Windows / Linux)

The workbench can be packaged as a cross-platform desktop app (Electron shell + bundled Node backend — no global Node.js install required):

```bash
pnpm dist:win     # Windows NSIS installer → release/
pnpm dist:mac     # macOS dmg (build on a macOS host; signing/notarization required for distribution)
pnpm dist:linux   # Linux AppImage + deb
```

How it works: the Electron main process spawns the existing backend as a separate child process via `ELECTRON_RUN_AS_NODE` (crash isolation + reuses the CLI's graceful SIGTERM cleanup), fixes the user PATH lost in GUI launches on macOS/Linux, and loads the local server URL. Packaging keeps `asar: false` so resources like the pi extension are readable by grandchild processes via real paths. For development: `pnpm dev:desktop`.

Note: the desktop app does not bundle AI engine CLIs (Claude Code / Codex / pi) — runtime auto-detection applies. Production logs: `~/.ai-dev-workbench/logs/desktop-server.log`.

## Development

```bash
pnpm install     # pnpm workspace
pnpm dev         # Vite (5173) + backend tsx (3000), hot reload
pnpm dev:desktop # desktop dev mode (Vite + tsx backend + Electron shell)
pnpm build       # frontend + backend + bridge production build
pnpm test        # vitest
```

### Project Structure

```
src/
├── bridge/               # Claude Agent SDK bridge subprocess
├── cli/                  # CLI entry: port finder, banner
├── client/               # React SPA (11 pages)
│   ├── components/       # Layout, SetupWizard, UI primitives
│   ├── hooks/            # useWebSocket, useKeyboardShortcuts
│   ├── pages/            # requirements, workspace, plan, execution, tests,
│   │                     # skills, mcp, pipelines, mineru, agent-execution, projects
│   └── stores/           # Zustand app store
└── server/               # Express backend
    ├── middleware/        # logger, validation
    ├── routes/            # 15 route groups + 2 platform API faces
    ├── services/
    │   ├── cli-providers/         # Claude / Codex / Pi adapters (+ pi RPC harness)
    │   ├── requirement-sources/   # ONES / GitHub / generic MCP adapters
    │   ├── memory/                # user profile, project facts, feedback
    │   └── …                      # stores, scheduler, coordinator, tests, MinerU
    ├── platform/          # engine-neutral: tool catalog/registry + MCP gateway
    └── utils/
resources/pi-extensions/   # adw-platform extension (runs inside pi subprocess)
skills/  templates/  docs/plans/
```

## Configuration

Stored in `~/.ai-dev-workbench/config.json` (editable in the settings UI).

| Option | Description | Default |
|--------|-------------|---------|
| `server.port` / `server.host` | Listen port (auto-assign if taken) / host | dynamic / `localhost` |
| `ui.theme` | `dark` or `light` | `dark` |
| `auth.apiKey` | Optional; protects all `/api/*` via `X-API-Key` header or `?apiKey=` | — |
| `auth.corsOrigins` | Allowed origins (unset = all) | — |
| `daytona.apiUrl` / `daytona.apiKey` | Optional sandbox backend | Daytona cloud |
| `cliProvider.active` | Active engine id (builtin or custom record id) | auto-detected |

### Data Layout

Everything lives under `~/.ai-dev-workbench/`:

| Path | Purpose |
|------|---------|
| `config.json` / `models.json` / `mcp-servers.json` | config, custom model providers, MCP registry |
| `requirements/{id}/` | one folder per requirement: `metadata.json`, `document.md`, `images/`, plan & execution records |
| `agent-executions/` | one JSON per autonomous agent execution |
| `pi-sessions/` | pi engine session files (native JSONL, one file per session, grouped by workspace) |
| `tasks/` | multi-task records |
| `memory/` | `user-profile.json`, `project-facts.json`, `feedback-log.json` |
| `analytics/` / `pipelines.json` | execution analytics, pipeline definitions |
| `logs/` | application logs |

## License

MIT
