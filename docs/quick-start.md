# Quick Start Guide

Get your chocolate factory running in five steps. This guide walks you through installing CoCoPilot, initializing a repository, starting the daemon, spawning your first worker, and monitoring progress from the Cocoa Board dashboard.

## Step 1: Install Dependencies

Ensure all prerequisites are installed:

```bash
# Node.js 22+ (check version)
node --version   # Should print v22.x.x or higher

# Docker (must be running)
docker info      # Should print server info without errors

# Redis (must be running on localhost:6379)
redis-cli ping   # Should print PONG

# GitHub CLI (must be authenticated)
gh auth status   # Should show logged-in status
```

Then install CoCoPilot:

```bash
git clone https://github.com/your-org/cocopilot.git
cd cocopilot
npm install
npm run build
```

Optionally, link the `coco` CLI globally so it's available from any directory:

```bash
npm link
```

If you skip `npm link`, you can run the CLI directly:

```bash
node dist/cli/index.js <command>
```

## Step 2: Initialize a Repository

Point CoCoPilot at the GitHub repository you want to work on:

```bash
coco init https://github.com/your-org/your-repo
```

This command:
- Validates the GitHub URL
- Clones the repository to `~/.cocopilot/repos/`
- Detects whether the repo is a **fork** (automatically enables multiplayer mode)
- Configures the GitHub MCP server for agent access to issues and PRs
- Creates per-repo state in `~/.cocopilot/state.json`

You can optionally specify a custom name:

```bash
coco init https://github.com/your-org/your-repo --name my-project
```

Verify the repo was added:

```bash
coco list
```

## Step 3: Start the Daemon

Fire up the Concher daemon, which starts all background agents and the Cocoa Board web server:

```bash
coco start
```

This launches:
- The **Concher** daemon process (background)
- The **Cocoa Board** web server at `http://localhost:3000`
- The **Chocolatier** supervisor agent
- The **Temperer** (single-player) or **Enrober** (multiplayer) merge queue agent
- The **Ganache Bus** Redis message broker connections

Options:

| Flag | Description |
|------|-------------|
| `--port <number>` | Web UI port (default: `3000`) |
| `--no-ui` | Start daemon without the web UI |
| `--foreground` | Run in the foreground instead of daemonizing |

Verify the daemon is running:

```bash
coco status
```

## Step 4: Spawn a Worker

Create your first Truffle worker. Each worker gets a candy name (Snickers, KitKat, Twix, etc.) and operates in an isolated Docker container with its own git worktree.

**From the Cocoa Board dashboard:**

1. Open `http://localhost:3000` in your browser
2. Navigate to the Factory Floor page
3. Click the "Spawn Worker" button
4. Enter a task description (e.g., "Add input validation to the signup form")
5. Click "Spawn"

**From the REST API:**

```bash
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Add input validation to the signup form"}'
```

The worker will:
1. Spin up a Docker container with resource limits (4 GB memory, 2 CPUs by default)
2. Create a git worktree on a `work/<candy-name>` branch
3. Execute the task using the GitHub Copilot SDK
4. Make incremental commits as it works
5. Create a pull request when finished
6. Signal completion to the Chocolatier

## Step 5: Open the Dashboard

Open `http://localhost:3000` in your browser to access the Cocoa Board. The dashboard provides:

### Factory Floor
The main overview page. Shows all active workers, their status, and the supervisor agent. From here you can:
- See at-a-glance status of every Truffle worker
- Spawn new workers
- Terminate or nudge stuck workers

### Truffle Inspector
Click on any worker to see its detail page:
- **Live Output** -- Streaming terminal output from the worker in real-time
- **Git Log** -- Commits made by the worker
- **Resource Usage** -- CPU and memory consumption
- **Worker Controls** -- Nudge, terminate, or view the PR

### PR Pipeline
Track pull requests through their lifecycle:
- Draft -> Ready -> CI Running -> CI Passed -> Merged (single-player)
- Draft -> Ready -> Needs Review -> Approved -> Ready to Merge (multiplayer)

### Message Queue Inspector
Inspect the Ganache Bus message queue -- see messages flowing between agents, pending deliveries, and acknowledgments.

## Step 6: Monitor Progress

While workers churn away, you can monitor from the CLI or the dashboard.

**CLI status check:**

```bash
coco status          # Overall system status
coco status --json   # Machine-readable output
```

**Key things to watch for:**

- **Worker completion** -- The Chocolatier will report when Truffles finish their tasks
- **PR creation** -- Workers create PRs automatically; check the PR Pipeline page
- **CI status** -- The Temperer/Enrober monitors CI and takes action on failures
- **Stuck workers** -- The Chocolatier nudges workers inactive for more than 15 minutes

## What Happens Next

In **single-player mode**, the Temperer automatically merges PRs when CI passes. Your code lands on the main branch without any manual intervention.

In **multiplayer mode**, the Enrober notifies reviewers and tracks approval status. Once a PR is approved and CI passes, it surfaces as "ready to merge" -- but a human makes the final call.

## Stopping the Factory

When you're done:

```bash
coco stop          # Graceful shutdown
coco stop --force  # Force stop without waiting for workers to finish
```

This stops all Docker containers, the daemon process, and the web server.

## Next Steps

- [Configuration Reference](configuration.md) -- Customize ports, resource limits, models, and more
- [Troubleshooting](troubleshooting.md) -- Common issues and how to fix them
