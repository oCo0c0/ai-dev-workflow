# AI Dev Workbench

AI-powered development workbench that integrates requirements management, intelligent planning, AI-assisted coding, automated testing, and Git change tracking into a unified development workflow.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Radix UI, Lucide Icons |
| **Backend** | Express.js, TypeScript, WebSocket (ws), Model Context Protocol SDK |
| **AI Engine** | Claude Agent SDK (persistent bridge process) |
| **State** | Zustand (client) + JSON file persistence (server) |
| **Testing** | Vitest, Jest, Playwright, PyTest (framework detection) |
| **CLI** | Node.js CLI with `npx` support |

## Features

### Requirements Management
- Fetch and browse requirements from ONES/Jira/GitLab via MCP Server
- Local requirement storage and search
- Support multiple MCP server sources

### Workspace Management
- Select and validate local project directories with project type detection (Node/Python/Java/Rust)
- Resizable and collapsible three-panel layout: workspaces / file tree / preview
- File browsing with recursive directory tree and file content preview
- **Git Changes View** — Files/Changes tab switching, `git status` change list (M/A/D/R/U markers), unified diff view with syntax highlighting

### AI Plan Generation
- Analyze requirements with project context to generate structured development plans
- Multi-turn conversation with Claude during plan generation
- Plan history with persistent storage (up to 50 records)
- Real-time streaming output via WebSocket

### AI Code Execution
- Execute development plans step-by-step using Claude Code CLI
- Pause / Retry / Skip / Abort controls
- Multi-turn reply support during execution
- Execution history with persistent storage
- **Auto-trigger tests** after execution completes (when pipeline is configured)

### Automated Testing
- Detect test frameworks: Jest/Vitest, Playwright, PyTest
- Two test modes: **Run existing tests** or **AI-generate tests** via Claude
- Pipeline integration with `testStrategy` configuration
- Link execution context to run targeted tests against developed code
- Test run history with pass/fail visualization

### Workflow Pipelines
- Define configurable development workflow templates
- Per-phase skill configuration (plan / execution / test)
- MCP tool selection and test strategy settings
- Default pipeline selection

### Skills Management
- View and manage Claude Code CLI skill configurations
- CRUD operations for `.claude/commands/` and `.claude/skills/`

### Self-Improving System (Hermes-Inspired)
Inspired by [Hermes Agent](https://github.com/nousresearch/hermes-agent)'s self-evolution architecture, the workbench learns from every execution to improve over time:
- **Memory System** — Persists user preferences (language, coding style, framework choices) and project characteristics (tech stack, test frameworks, directory conventions) across sessions
- **Execution Analytics** — Tracks success/failure patterns, skill effectiveness, and recovery patterns from every plan, execution, and test run
- **Skill Auto-Derivation** — Automatically generates reusable skills from successful recovery patterns (e.g., "execution failed then succeeded → extract the fix strategy")
- **Curator** — Periodically cleans up redundant, low-confidence, or unused auto-derived skills
- **Prompt Enrichment** — Injects learned context (user profile + project facts) into every Claude prompt, improving output relevance

### MCP Configuration
- Manage MCP Server connections through web interface
- Test server connectivity
- Supports any MCP-compatible server

### Developer Experience
- WebSocket real-time updates with exponential backoff reconnection
- Keyboard shortcuts: `Ctrl+1-8` navigation, `Ctrl+G` generate plan, `Ctrl+Enter` start execution, `Ctrl+T` run tests
- Dark / Light theme toggle
- First-run setup wizard (CLI + MCP status check)
- Cross-platform folder picker (Windows PowerShell / macOS osascript / Linux zenity)

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (SPA)                     │
│  React 18 + Zustand + Tailwind CSS + Radix UI       │
│  Pages: Requirements | Workspace | Plan | Execution  │
│         Tests | Skills | MCP | Pipelines             │
└───────────────────────┬─────────────────────────────┘
                        │ HTTP REST + WebSocket
┌───────────────────────┴─────────────────────────────┐
│               Express.js Server (3000)               │
│  Routes → Services → Persistence (~/.ai-dev-workbench)│
│  WebSocket broadcast for async progress updates       │
└──────┬──────────┬──────────────┬─────────────────────┘
       │          │              │
  MCP Server   Claude CLI   Git / File System
  (ONES/Jira)  (Agent SDK)  (status/diff/browse)
```

**Claude Bridge Process:** A persistent Node.js child process (`claude-bridge.mjs`) wraps the Claude Agent SDK. It receives JSON requests via stdin, streams responses via stdout, and supports session resumption — avoiding process spawn overhead for each request.

**Async Operation Pattern:** Plan generation, execution, and test runs are asynchronous. Endpoints return task IDs immediately, then stream progress via WebSocket `broadcast()`. The client updates the Zustand store in real time.

**Dual Persistence:** Active operations live in in-memory Maps for fast access. Completed records persist to JSON files (max 50 each) in `~/.ai-dev-workbench/`.

**Self-Improving Event Loop:** A server-side EventBus intercepts all `broadcast()` calls. Analytics and memory services subscribe to `execution:complete` and `test:complete` events, automatically recording outcomes, detecting patterns, and enriching future prompts — without modifying any existing route handler code.

```
Route Handler → broadcast() → eventBus.dispatch()
                                  ├──→ AnalyticsService (pattern detection)
                                  ├──→ MemoryService (preference learning)
                                  ├──→ SkillDerivationService (auto-skill generation)
                                  └──→ WebSocket → Frontend
```

## Requirements

- **Node.js** >= 18.0.0
- **Claude Code CLI** — Required for AI plan generation and code execution
- **Git** — Required for workspace change tracking
- MCP Server (optional) — For requirements fetching from ONES/Jira/GitLab

## Installation

```bash
npm install -g ai-dev-workbench
```

## Quick Start

```bash
# After global installation
ai-dev-workbench

# Or run directly without installing
npx ai-dev-workbench
```

The workbench starts a local server on an available port and displays the access URL in your terminal.

## Development

```bash
# Install dependencies
npm install

# Start development server (frontend hot-reload + backend)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

### Project Structure

```
src/
├── bridge/           # Claude Agent SDK bridge process
├── cli/              # CLI entry point, banner, port finder
├── client/           # Frontend (React + Vite)
│   ├── components/   # Layout, SetupWizard, UI primitives
│   ├── hooks/        # useWebSocket, useKeyboardShortcuts
│   ├── pages/        # 8 page components
│   └── stores/       # Zustand app store
└── server/           # Backend (Express.js)
    ├── middleware/    # Request logger, validation
    ├── routes/       # 10 route modules (35+ endpoints)
    ├── services/     # 16+ service classes
    │   └── memory/   # Memory subsystem (profile, facts, feedback stores)
    ├── event-bus.ts  # Server-side event bus for self-improving loop
    └── utils/        # Skill resolution, prompt enrichment helpers
```

## Configuration

Configuration is stored in `~/.ai-dev-workbench/config.json`. On first launch, a setup wizard guides you through initial configuration.

| Option | Description | Default |
|--------|-------------|---------|
| `server.port` | Preferred server port (auto-assigns if unavailable) | Dynamic (3000-9000) |
| `server.host` | Server host | `localhost` |
| `claudeCodeCli.path` | Path to Claude Code CLI | Uses system PATH |
| `ui.theme` | UI theme (`dark` or `light`) | `dark` |

### Data Files

All persistent data is stored under `~/.ai-dev-workbench/`:

| File | Purpose |
|------|---------|
| `config.json` | Application configuration |
| `requirements.json` | Locally saved requirements |
| `plans.json` | Development plans (max 50) |
| `executions.json` | Execution records (max 50) |
| `test-runs.json` | Test run records (max 50) |
| `pipelines.json` | Workflow pipeline definitions |
| `saved-workspaces.json` | Named workspace bookmarks |
| `workspace-history.json` | Recent workspace paths (max 10) |
| `analytics.json` | Execution analytics records (max 200) |
| `memory/user-profile.json` | User preferences (language, coding style) |
| `memory/project-facts.json` | Project characteristics per workspace (max 20) |
| `memory/feedback-log.json` | User feedback records (max 50) |
| `logs/app.log` | HTTP request logs |

## License

MIT
