<p align="center">
  <img src="docs/assets/logo.png" alt="CoCoPilot Logo" width="120" />
</p>

<h1 align="center">🍫 CoCoPilot</h1>

<p align="center">
  <strong>Collaborative Copilot Orchestration Platform</strong><br/>
  <em>Multi-agent AI coding assistants working in parallel on your codebase</em>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-features">Features</a> •
  <a href="#-documentation">Docs</a>
</p>

---

## What is CoCoPilot?

CoCoPilot orchestrates multiple AI coding agents that work **simultaneously** on different tasks in your repository. Each agent runs in an isolated environment with its own git worktree, enabling true parallel development without conflicts.

**Think of it like a development team that never sleeps:**

```
You: "Fix the login bug, add unit tests, and update the docs"

CoCoPilot spawns 3 workers → Each works independently → 3 PRs ready for review
```

> *"Good code, like good chocolate, requires the right blend of chaos and control."*

---

## 🚀 Quick Start

### 1. Start CoCoPilot

```bash
# Clone and start with Docker (recommended)
git clone https://github.com/patrick-knight/cocopilot.git
cd cocopilot
docker compose up -d

# Authenticate with GitHub (first time only)
docker exec -e HOME=/root -it cocopilot-cocopilot-app-1 sh -l
# Follow the prompts for: gh auth login
```

### 2. Initialize a Repository

```bash
docker exec -e HOME=/root cocopilot-cocopilot-app-1 coco init https://github.com/your-org/your-repo
```

### 3. Spawn a Worker

```bash
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Fix the login bug in auth.ts"}'
```

### 4. Monitor Progress

Open **http://localhost:3000** to watch your workers in the Cocoa Board dashboard.

---

## 🔧 How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            COCOA BOARD (Web UI)                             │
│                         http://localhost:3000                               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ Socket.IO / REST API
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CONCHER (Daemon)                               │
│                   Orchestrates lifecycle & manages state                    │
└───────┬─────────────────────────┬─────────────────────────────┬─────────────┘
        │                         │                             │
        ▼                         ▼                             ▼
┌───────────────┐       ┌───────────────┐             ┌───────────────┐
│  CHOCOLATIER  │       │   TEMPERER    │             │    ENROBER    │
│  (Supervisor) │       │ (Merge Queue) │             │ (PR Shepherd) │
│               │       │               │             │               │
│ • Monitors    │       │ • Auto-merge  │             │ • Track PRs   │
│   workers     │       │   when CI     │             │ • Ping        │
│ • Spawns new  │       │   passes      │             │   reviewers   │
│   tasks       │       │ • Solo mode   │             │ • Team mode   │
└───────────────┘       └───────────────┘             └───────────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼             ▼
             ┌───────────┐ ┌───────────┐ ┌───────────┐
             │  TRUFFLE  │ │  TRUFFLE  │ │  TRUFFLE  │
             │ Worker #1 │ │ Worker #2 │ │ Worker #3 │
             │           │ │           │ │           │
             │ Isolated  │ │ Isolated  │ │ Isolated  │
             │ Docker +  │ │ Docker +  │ │ Docker +  │
             │ Worktree  │ │ Worktree  │ │ Worktree  │
             └───────────┘ └───────────┘ └───────────┘
```

### Core Components

| Component | Description |
|-----------|-------------|
| **Cocoa Board** | Real-time web dashboard for monitoring agents, workers, and PRs |
| **Concher** | Background daemon that manages the entire system lifecycle |
| **Chocolatier** | Supervisor that monitors workers and nudges stuck agents |
| **Temperer** | Auto-merges PRs when CI passes (for solo developers) |
| **Enrober** | Shepherds PRs through review (for teams) |
| **Truffle** | Individual worker running in an isolated Docker container |
| **Ganache Bus** | Redis-backed message broker for agent communication |

---

## ✨ Features

### 🖥️ Web Dashboard
Real-time monitoring at `http://localhost:3000` with live output streaming, PR pipeline visualization, and worker controls.

### 🤖 Custom Agents
Define your own agents with YAML + Markdown in `.cocopilot/agents/`:

```bash
coco agents list
coco agents spawn --from .cocopilot/agents/reviewer.md
```

### 🔑 BYOK (Bring Your Own Key)
Use your own API keys for Anthropic, OpenAI, or Azure:

```bash
coco config keys set anthropic sk-ant-...
```

### 🌐 REST API
Full API access for integrations and automation:

```bash
# Spawn a worker
curl -X POST http://localhost:3000/api/v1/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Add tests", "repoName": "my-app"}'

# Register webhooks
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/hook", "events": ["worker.completed"]}'
```

### 📊 Metrics
Track worker throughput, PR cycle time, and CI success rates at `/metrics`.

### 🔌 MCP Extensibility
Add custom Model Context Protocol servers for database access, internal APIs, and more.

---

## 🎮 Modes of Operation

### Solo Mode (Default)
For individual developers. **Temperer** auto-merges PRs when CI passes. Spawn workers, grab coffee, return to merged code.

### Team Mode
Auto-detected for forks. **Enrober** manages PR reviews—pings reviewers, tracks blockers, but humans always merge.

---

## 📦 Installation

### Docker (Recommended)

```bash
git clone https://github.com/patrick-knight/cocopilot.git
cd cocopilot
docker compose up --build -d
```

**Included:** Concher daemon, web server, Redis, GitHub CLI, Docker CLI, `coco` command.

### Local Development

```bash
git clone https://github.com/patrick-knight/cocopilot.git
cd cocopilot
npm install
npm run build
npm link

# Start Redis separately
# macOS: brew services start redis
# Linux: sudo systemctl start redis
```

**Prerequisites:** Node.js 23+, Docker, GitHub CLI (`gh auth login`), Git.

---

## 🛠️ CLI Reference

| Command | Description |
|---------|-------------|
| `coco init <url>` | Initialize repository tracking |
| `coco start` | Start daemon and web UI |
| `coco stop` | Stop all services |
| `coco status` | Show system status |
| `coco list` | List tracked repositories |
| `coco worker spawn` | Spawn a new worker |
| `coco agents list` | List custom agent definitions |
| `coco agents spawn` | Spawn from agent definition |
| `coco config keys set` | Configure API keys |

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Quick Start](docs/quick-start.md) | Get running in 5 minutes |
| [Configuration](docs/configuration.md) | All options and environment variables |
| [API Reference](docs/api-reference.md) | REST endpoints for integrations |
| [Custom Agents](docs/custom-agents.md) | Build your own agents |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |

---

## 🧑‍💻 Development

```bash
npm run dev      # Watch mode
npm test         # Run tests
npm run lint     # Type checking
```

---

## 📄 License

MIT
