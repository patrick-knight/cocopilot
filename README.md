# CoCoPilot

**Collaborative Copilot Orchestration Platform** -- A multi-agent orchestration system that manages multiple AI coding agents working in parallel on your codebase. Like a master chocolatier coordinating a confectionery factory, CoCoPilot tempers, enrobes, and delivers perfectly crafted code.

> *"Good code, like good chocolate, requires the right blend of chaos and control."*

## Architecture

```
                          +---------------------+
                          |    Cocoa Board       |
                          |  (Web Dashboard)     |
                          |  localhost:3000      |
                          +----------+----------+
                                     |
                              Socket.IO / REST
                                     |
+----------------+          +--------+--------+         +----------------+
|  Chocolatier   |<-------->|    Concher      |<------->|   Temperer     |
|  (Supervisor)  |          |    (Daemon)     |         |  (Merge Queue) |
|                |          |                 |         |  single-player |
| Monitors all   |          | Orchestrates    |         +----------------+
| Truffles,      |          | lifecycle,      |                 OR
| spawns workers,|          | manages Docker  |         +----------------+
| nudges stuck   |          | containers      |         |   Enrober      |
| agents         |          +--------+--------+         |  (PR Shepherd) |
+----------------+                   |                  |  multiplayer   |
                                     |                  +----------------+
                          +----------+----------+
                          |    Ganache Bus      |
                          |  (Message Broker)   |
                          |  Redis pub/sub +    |
                          |  file persistence   |
                          +----------+----------+
                                     |
                 +-------------------+-------------------+
                 |                   |                   |
          +------+------+    +------+------+    +------+------+
          |   Truffle   |    |   Truffle   |    |   Truffle   |
          |  "Snickers" |    |  "KitKat"   |    |  "Twix"     |
          |  Worker #1  |    |  Worker #2  |    |  Worker #3  |
          |             |    |             |    |             |
          | Isolated    |    | Isolated    |    | Isolated    |
          | Docker +    |    | Docker +    |    | Docker +    |
          | git worktree|    | git worktree|    | git worktree|
          +-------------+    +-------------+    +-------------+
```

**Component Summary:**

| Component | Role |
|-----------|------|
| **Chocolatier** | Supervisor agent -- monitors workers, spawns new Truffles, nudges stuck agents |
| **Temperer** | Merge queue agent (single-player) -- polls PRs, auto-merges when CI passes |
| **Enrober** | PR shepherd (multiplayer/forks) -- tracks reviews, never auto-merges |
| **Truffle** | Worker agent -- executes tasks in isolated Docker containers with git worktrees |
| **Concher** | Background daemon -- manages container lifecycle, state, and the web server |
| **Ganache Bus** | Message broker -- Redis pub/sub for real-time delivery, file store for durability |
| **Cocoa Board** | React web dashboard -- real-time agent monitoring, PR pipeline, worker controls |

## Prerequisites

- **Node.js 22+** (`>=22.13.1`)
- **Docker** (running daemon)
- **Redis** (default `localhost:6379`)
- **GitHub CLI** (`gh`) authenticated via `gh auth login`
- **Git** with worktree support

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/cocopilot.git
cd cocopilot

# Install dependencies
npm install

# Build
npm run build

# Link the CLI globally (optional)
npm link
```

## Quick Start

```bash
# 1. Initialize a repository for tracking
coco init https://github.com/your-org/your-repo

# 2. Start the Concher daemon and Cocoa Board dashboard
coco start

# 3. Spawn a worker to begin a task
# (Use the dashboard at http://localhost:3000 or the REST API)
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Fix the login bug in auth.ts"}'

# 4. Monitor progress
coco status
# Or open http://localhost:3000 in your browser
```

For a detailed walkthrough, see the [Quick Start Guide](docs/quick-start.md).

## Features

### Metrics Dashboard

The Cocoa Board includes a metrics page at `http://localhost:3000/metrics` with charts for worker throughput, PR cycle time, CI success rate, and model usage. Data refreshes every 30 seconds. See the [Quick Start Guide](docs/quick-start.md) for details.

### Custom Agents

Define your own agents using YAML frontmatter + Markdown files in `.cocopilot/agents/`. Agents can be **persistent** (long-running) or **ephemeral** (run-once). See the [Custom Agents Guide](docs/custom-agents.md).

```bash
coco agents list           # List available agent definitions
coco agents spawn --from .cocopilot/agents/reviewer.md
```

### BYOK (Bring Your Own Key)

Use your own API keys for Anthropic, OpenAI, or Azure instead of the default Copilot-provided model. Keys are encrypted at rest with AES-256-GCM.

```bash
coco config keys set anthropic sk-ant-...
coco config keys list
```

See [Configuration](docs/configuration.md#byok-bring-your-own-key) for details.

### REST API

All orchestration features are available via a REST API for external integrations, scripting, and custom dashboards. Register webhooks to receive notifications on worker and PR events.

```bash
# Spawn a worker via API
curl -X POST http://localhost:3000/api/v1/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Add tests", "repoName": "my-app"}'

# Register a webhook
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/hook", "events": ["worker.completed"]}'
```

See the [API Reference](docs/api-reference.md) for all endpoints.

### MCP Server Extensibility

Extend agent capabilities by adding custom MCP (Model Context Protocol) servers. Configure additional servers in `.cocopilot/config.json` to give agents access to databases, internal APIs, or other tools.

See [Configuration](docs/configuration.md#mcp-server-extensibility) for setup.

## CLI Reference

| Command | Description |
|---------|-------------|
| `coco init <repo-url>` | Initialize repository tracking (auto-detects forks) |
| `coco start` | Start the Concher daemon and web UI |
| `coco stop` | Stop all CoCoPilot services |
| `coco status` | Show system status |
| `coco list` | List tracked repositories |
| `coco agents list` | List available custom agent definitions |
| `coco agents spawn --from <file>` | Spawn a custom agent from a definition file |
| `coco config keys set <provider> <key>` | Store an API key for a provider (BYOK) |
| `coco config keys list` | List configured API key providers |

See [Configuration](docs/configuration.md) for all options and environment variables.

## Documentation

- [Quick Start Guide](docs/quick-start.md) -- Get up and running in minutes
- [Configuration Reference](docs/configuration.md) -- CLI options, environment variables, and config schema
- [API Reference](docs/api-reference.md) -- REST API endpoints for external integrations
- [Custom Agents Guide](docs/custom-agents.md) -- Define and run your own agents
- [Troubleshooting](docs/troubleshooting.md) -- Common issues and fixes

## Modes of Operation

### Single-Player Mode (default)

For solo developers. The **Temperer** agent auto-merges PRs when CI passes. Spawn workers, go grab a coffee, come back to merged code.

### Multiplayer Mode (auto-detected for forks)

For teams and open-source contributions. The **Enrober** agent shepherds PRs through review -- it pings reviewers, surfaces blocked PRs, and notifies when PRs are ready to merge. Humans always make the final merge decision.

Mode is auto-detected during `coco init` based on fork detection, or can be set manually in `.cocopilot/config.json`.

## Development

```bash
# Run in watch mode
npm run dev

# Run tests
npm test

# Type checking
npm run lint
```

## License

MIT
