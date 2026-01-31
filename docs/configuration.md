# Configuration Reference

CoCoPilot is configured through CLI options, environment variables, and JSON config files. This page is the complete recipe book for tuning your chocolate factory.

## CLI Commands

### `coco init <repo-url>`

Initialize a repository for CoCoPilot tracking.

```bash
coco init https://github.com/your-org/your-repo [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--name <name>` | Custom name for the repository | Derived from URL |

**Behavior:**
- Validates the GitHub URL format (`https://github.com/<owner>/<repo>`)
- Clones the repository to `~/.cocopilot/repos/<name>/`
- Runs fork detection via `gh api` -- if the repo is a fork, automatically enables multiplayer mode (Enrober agent, auto-merge disabled)
- Configures the GitHub MCP server for agent access
- Adds the repository to `~/.cocopilot/state.json`

### `coco start`

Start the Concher daemon and all background services.

```bash
coco start [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--port <number>` | Port for the Cocoa Board web UI | `3000` |
| `--no-ui` | Start daemon without the web UI | UI enabled |
| `--foreground` | Run in the foreground (don't daemonize) | Background |

**Behavior:**
- Writes PID file to `~/.cocopilot/daemon.pid`
- Loads state from `~/.cocopilot/state.json`
- Reconciles state with running Docker containers
- Starts the Express + Socket.IO web server
- Starts periodic health checks (every 5 minutes)

### `coco stop`

Stop all CoCoPilot services.

```bash
coco stop [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Force stop without waiting for graceful shutdown | Graceful |

**Behavior:**
- Sends SIGTERM to the daemon process
- Waits for workers to reach a safe stopping point (unless `--force`)
- Stops all managed Docker containers
- Removes the PID file

### `coco status`

Display system status including daemon state, tracked repositories, and active workers.

```bash
coco status [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | Human-readable |

### `coco list`

List all tracked repositories.

```bash
coco list [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | Human-readable |

---

## Environment Variables

Environment variables used internally by CoCoPilot. Most users won't need to set these directly -- they are set automatically in worker containers.

| Variable | Description | Default |
|----------|-------------|---------|
| `COCOPILOT_PORT` | Port for the Cocoa Board web server | `3000` |
| `COCOPILOT_DAEMONIZED` | Set to `"1"` when running as a background daemon process | Not set |
| `COCOPILOT_AGENT_NAME` | Name of the agent (set in containers) | Not set |
| `COCOPILOT_REPO` | Repository name (set in containers) | Not set |
| `COCOPILOT_TASK` | Task description (set in worker containers) | Not set |
| `COCOPILOT_BRANCH` | Git branch name (set in worker containers) | Not set |
| `COCOPILOT_MODEL` | Model override for the Copilot SDK | Config value |
| `COCOPILOT_AGENT_TYPE` | Agent type: `chocolatier`, `temperer`, `enrober`, `truffle` | Not set |
| `COCOPILOT_WORKER_NAME` | Worker candy name (set in Truffle containers) | Not set |
| `REDIS_URL` | Redis connection URL (overrides config) | `redis://localhost:6379` |

---

## Global Configuration

**File:** `~/.cocopilot/config.json`

This file controls system-wide defaults. It is created on first run and can be edited directly or updated via the REST API (`PATCH /api/v1/config`).

```jsonc
{
  // AI model for agent sessions
  "model": "claude-sonnet-4-5",

  // Port for the Cocoa Board web server
  "webPort": 3000,

  // Maximum concurrent Truffle workers per repository
  "maxWorkersPerRepo": 10,

  // Maximum time a worker can run before being stopped
  "workerTimeout": "4h",

  // How often the Chocolatier checks worker health
  "supervisorNudgeInterval": "5m",

  // How often Temperer/Enrober polls for PR updates
  "mergeQueuePollInterval": "2m",

  // Docker container memory limit
  "containerMemoryLimit": "4g",

  // Docker container CPU limit
  "containerCpuLimit": "2",

  // Auto-merge PRs when CI passes (single-player only)
  "autoMerge": true,

  // Dashboard color theme
  "theme": "dark-chocolate",

  // GitHub integration settings
  "github": {
    "defaultBranch": "main",
    "prLabels": ["cocopilot"],
    "requireCI": true
  },

  // Redis connection settings
  "redis": {
    "host": "localhost",
    "port": 6379
  }
}
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | `string` | `"claude-sonnet-4-5"` | AI model identifier for Copilot SDK sessions |
| `webPort` | `number` | `3000` | Port for the Cocoa Board web server |
| `maxWorkersPerRepo` | `number` | `10` | Maximum concurrent workers per repository |
| `workerTimeout` | `string` | `"4h"` | Max worker runtime (e.g., `"1h"`, `"30m"`, `"4h"`) |
| `supervisorNudgeInterval` | `string` | `"5m"` | How often the Chocolatier runs health checks |
| `mergeQueuePollInterval` | `string` | `"2m"` | How often the merge queue agent polls GitHub |
| `containerMemoryLimit` | `string` | `"4g"` | Docker memory limit per container |
| `containerCpuLimit` | `string` | `"2"` | Docker CPU limit per container |
| `autoMerge` | `boolean` | `true` | Auto-merge PRs on CI pass (disabled in multiplayer mode) |
| `theme` | `string` | `"dark-chocolate"` | Dashboard theme |
| `github.defaultBranch` | `string` | `"main"` | Default branch for PR targets |
| `github.prLabels` | `string[]` | `["cocopilot"]` | Labels applied to CoCoPilot-created PRs |
| `github.requireCI` | `boolean` | `true` | Require CI to pass before merging |
| `redis.host` | `string` | `"localhost"` | Redis server hostname |
| `redis.port` | `number` | `6379` | Redis server port |

---

## Per-Repository Configuration

**File:** `.cocopilot/config.json` (in the repository root)

Per-repo settings override global defaults. This file is committed to the repository, allowing teams to share configuration.

```jsonc
{
  // Operating mode
  "mode": "single-player",     // or "multiplayer"

  // Override the AI model for this repo
  "model": "claude-sonnet-4-5",

  // Override max workers for this repo
  "maxWorkers": 5,

  // Override auto-merge for this repo
  "autoMerge": true,

  // Active merge queue agent
  "activeAgent": "temperer",   // or "enrober"

  // Upstream repo info (populated automatically for forks)
  "upstream": {
    "owner": "original-org",
    "repo": "original-repo",
    "defaultBranch": "main"
  },

  // Custom agent definitions
  "customAgents": [
    {
      "name": "security-reviewer",
      "prompt": "Review all PRs for security vulnerabilities",
      "triggers": ["pr_created"]
    }
  ],

  // MCP server configuration
  "mcpServers": {
    "github": {
      "type": "stdio",
      "command": "gh",
      "args": ["copilot", "mcp"]
    },
    "custom-api": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

### Per-Repo Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"single-player" \| "multiplayer"` | Auto-detected | Operating mode |
| `model` | `string` | Global config | AI model override |
| `maxWorkers` | `number` | Global config | Max workers override |
| `autoMerge` | `boolean` | Global config | Auto-merge override |
| `activeAgent` | `"temperer" \| "enrober"` | Based on mode | Merge queue agent |
| `upstream` | `object` | Auto-detected | Upstream repo for forks |
| `customAgents` | `array` | `[]` | Custom agent definitions |
| `mcpServers` | `object` | `{}` | MCP server configuration |

---

## State Files

CoCoPilot stores operational state in `~/.cocopilot/`. These files are managed automatically.

| File | Purpose |
|------|---------|
| `~/.cocopilot/config.json` | Global configuration |
| `~/.cocopilot/state.json` | Daemon state (repos, workers, agents) |
| `~/.cocopilot/daemon.pid` | PID file for the daemon process |
| `~/.cocopilot/daemon.log` | Daemon log output |
| `~/.cocopilot/repos/` | Repository clones and git worktrees |
| `~/.cocopilot/web/logs/` | Web server logs |

State is persisted using atomic writes (write to temp file, then rename) for crash safety. On daemon restart, the recovery system reconciles persisted state with actual Docker containers and marks orphaned workers as `stuck`.

---

## REST API

The Cocoa Board exposes a REST API at `http://localhost:<webPort>/api/v1/`.

### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/config` | Get global configuration |
| `PATCH` | `/api/v1/config` | Update global configuration (partial merge) |

### Repositories

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/repositories` | Initialize a new repository |
| `GET` | `/api/v1/repositories` | List all tracked repositories |
| `GET` | `/api/v1/repositories/:repoName` | Get repository details |
| `DELETE` | `/api/v1/repositories/:repoName` | Remove a tracked repository |

### Workers

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/repositories/:repoName/workers` | Spawn a new worker |
| `GET` | `/api/v1/repositories/:repoName/workers` | List workers for a repository |
| `GET` | `/api/v1/repositories/:repoName/workers/:workerName` | Get worker details |
| `DELETE` | `/api/v1/repositories/:repoName/workers/:workerName` | Terminate a worker |
| `POST` | `/api/v1/repositories/:repoName/workers/:workerName/nudge` | Nudge a stuck worker |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/repositories/:repoName/agents` | List agents for a repository |
| `POST` | `/api/v1/repositories/:repoName/agents/:agentName/message` | Send a message to an agent |

---

## Redis Channel Scheme

The Ganache Bus uses these Redis pub/sub channels:

| Channel | Purpose |
|---------|---------|
| `cocopilot:messages:<agentName>` | Direct messages to a specific agent |
| `cocopilot:messages:*` | Broadcast messages to all agents |
| `cocopilot:stream:<agentName>` | Real-time output streaming (to dashboard) |
| `cocopilot:completions` | Task completion notifications |

---

## Docker Container Configuration

Containers managed by CoCoPilot use these defaults:

| Setting | Default |
|---------|---------|
| Memory limit | `4g` |
| CPU limit | `2` |
| Agent image | `cocopilot-agent:latest` |
| Redis image | `redis:7.4.6-alpine` |

By default, workers run inside the main daemon container. To enable
per-worker containers (multi-container mode), set:

```json
{
  "workerRuntime": "container"
}
```

Containers are labeled for identification:

| Label | Description |
|-------|-------------|
| `cocopilot.managed` | Marks the container as CoCoPilot-managed |
| `cocopilot.type` | Container type (`chocolatier`, `temperer`, `enrober`, `truffle`, etc.) |
| `cocopilot.worker-name` | Worker candy name (Truffle containers only) |
| `cocopilot.repository` | Associated repository name |

Each container mounts:
- `/workspace` -- the git worktree for the worker
- `/messages` -- the agent's message directory for file-based persistence

---

## BYOK (Bring Your Own Key)

CoCoPilot supports using your own API keys for Anthropic, OpenAI, and Azure instead of the default Copilot-provided model. Keys are encrypted at rest using AES-256-GCM and stored in `~/.cocopilot/keys.json`.

### Supported Providers

| Provider | Environment Variable | Key Format |
|----------|---------------------|------------|
| `anthropic` | `COCOPILOT_ANTHROPIC_KEY` | `sk-ant-` followed by 20+ alphanumeric characters |
| `openai` | `COCOPILOT_OPENAI_KEY` | `sk-` followed by 20+ alphanumeric characters |
| `azure` | `COCOPILOT_AZURE_KEY` | 32-character hexadecimal string |

### Setting Up Keys

Keys require a password for encryption. Set the `COCOPILOT_KEYS_PASSWORD` environment variable before running any key commands:

```bash
export COCOPILOT_KEYS_PASSWORD="your-secure-password"
```

Then store a key:

```bash
coco config keys set anthropic sk-ant-your-key-here
```

The `--skip-validation` flag bypasses format validation for non-standard key formats:

```bash
coco config keys set openai my-custom-key --skip-validation
```

### Listing Configured Keys

List which providers have stored keys (keys themselves are never displayed):

```bash
coco config keys list
```

### Key Priority

When loading keys, environment variables take precedence over stored keys. This allows temporary overrides without modifying the encrypted store:

1. Environment variable (e.g., `COCOPILOT_ANTHROPIC_KEY`) -- highest priority
2. Encrypted key store (`~/.cocopilot/keys.json`) -- fallback

---

## MCP Server Extensibility

CoCoPilot agents use the Model Context Protocol (MCP) to access external tools and services. By default, the GitHub MCP server is configured for all agents. You can add additional MCP servers in per-repo configuration to give agents access to databases, internal APIs, or custom tools.

### Configuration Format

Add MCP servers to the `mcpServers` array in `.cocopilot/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "my-database",
      "url": "http://localhost:8080/mcp",
      "transport": "sse"
    },
    {
      "name": "local-tool",
      "url": "/usr/local/bin/my-mcp-tool",
      "transport": "stdio",
      "env": {
        "API_TOKEN": "secret"
      }
    }
  ]
}
```

### MCP Server Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique identifier for the MCP server |
| `url` | `string` | Yes | Server URL (for SSE) or command path (for stdio) |
| `transport` | `"stdio" \| "sse"` | Yes | Communication protocol |
| `env` | `Record<string, string>` | No | Environment variables passed to the server process |

### Transport Types

- **stdio**: Runs a local process. The `url` field is the command path. Suitable for local tools that communicate via standard input/output.
- **sse**: Connects to an HTTP server using Server-Sent Events. CoCoPilot validates reachability with a HEAD request (5-second timeout) when validating configuration.

### Validation

MCP server configurations are validated on load. For SSE servers, CoCoPilot checks URL reachability. Validation errors include:

- Missing `name` or `url` field
- Invalid `transport` value (must be `"stdio"` or `"sse"`)
- Invalid `env` entries (all keys and values must be strings)
- SSE server unreachable or returning error HTTP status

### How MCP Servers Are Injected

When an agent session starts, CoCoPilot:
1. Loads MCP server configs from the repo's `.cocopilot/config.json`
2. Merges them with the built-in GitHub MCP server
3. Injects all servers into the Copilot SDK session options

New servers are added alongside existing ones. If a server name matches an existing entry, the new config overrides it.

---

## Custom Agents

Define custom agents using Markdown files with YAML frontmatter in `.cocopilot/agents/`. See the [Custom Agents Guide](custom-agents.md) for a full walkthrough.

### CLI Commands

```bash
# List all agent definitions found in .cocopilot/agents/
coco agents list [--dir <path>] [--json]

# Spawn a custom agent from a definition file
coco agents spawn --from <file> [--model <model>]
```

### Agent Definition Format

```markdown
---
name: reviewer
class: persistent
tools:
  - read_file
  - search_code
---
You are a code reviewer. Review all PRs for correctness and style.
```

| Frontmatter Field | Type | Required | Description |
|-------------------|------|----------|-------------|
| `name` | `string` | Yes | Agent display name |
| `class` | `"persistent" \| "ephemeral"` | Yes | Agent lifecycle type |
| `tools` | `string[]` | No | Tool names the agent has access to |
