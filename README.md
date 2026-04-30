# AI Dev Workbench

AI-powered development workbench that integrates requirements management, intelligent analysis, AI-assisted coding, automated testing, and configuration management into a unified development workflow.

## Features

- **Requirements Management** — Fetch and browse requirements from ONES platform via MCP Server
- **Workspace Management** — Select and validate local project directories with project type detection
- **AI Plan Generation** — Analyze requirements with project context to generate structured development plans
- **AI Code Execution** — Execute development plans step-by-step using Claude Code CLI
- **Automated Testing** — Detect and run test frameworks (Playwright, Jest, PyTest) with result visualization
- **Skills Management** — View and manage Claude Code CLI skill configurations
- **MCP Configuration** — Manage MCP Server connections through a web interface
- **Workflow Pipelines** — Define configurable development workflow templates

## Requirements

- **Node.js** >= 18.0.0
- **Claude Code CLI** — Required for AI plan generation and code execution
- MCP Server (optional) — For requirements fetching from ONES/Jira/GitLab

## Installation

```bash
npm install -g ai-dev-workbench
```

## Quick Start

After global installation:

```bash
ai-dev-workbench
```

Or run directly without installing:

```bash
npx ai-dev-workbench
```

The workbench will start a local server on an available port and display the access URL in your terminal.

## Configuration

Configuration is stored in `~/.ai-dev-workbench/config.json`. On first launch, a setup wizard guides you through initial configuration.

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `server.port` | Preferred server port (auto-assigns if unavailable) | Dynamic |
| `server.host` | Server host | `localhost` |
| `claudeCodeCli.path` | Path to Claude Code CLI | Uses system PATH |
| `ui.theme` | UI theme (`dark` or `light`) | `dark` |

### MCP Server Configuration

MCP Servers are configured through the web interface or by editing `~/.claude/settings.json`.

## Development

```bash
# Install dependencies
npm install

# Start development server (frontend + backend)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## License

MIT
