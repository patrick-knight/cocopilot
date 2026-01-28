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

## CLI Reference

| Command | Description |
|---------|-------------|
| `coco init <repo-url>` | Initialize repository tracking (auto-detects forks) |
| `coco start` | Start the Concher daemon and web UI |
| `coco stop` | Stop all CoCoPilot services |
| `coco status` | Show system status |
| `coco list` | List tracked repositories |

See [Configuration](docs/configuration.md) for all options and environment variables.

## Documentation

- [Quick Start Guide](docs/quick-start.md) -- Get up and running in minutes
- [Configuration Reference](docs/configuration.md) -- CLI options, environment variables, and config schema
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
