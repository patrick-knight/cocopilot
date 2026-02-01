# TUI for CoCo - Implementation Plan

## Problem Statement
The cocopilot web UI is only accessible via browser at localhost:3000. Users working primarily in terminals would benefit from a TUI (Terminal User Interface) that provides the same functionality without leaving the command line.

## Proposed Approach
Use **ink** (React for CLIs) since the project already uses React + TypeScript. This minimizes learning curve and allows code/component sharing between web and TUI.

## Launch Command

```bash
coco tui
```

This will start the interactive TUI dashboard, connecting to the running daemon's API at `localhost:3000`. Optional flags:

```bash
coco tui --port 3001        # Connect to different port
coco tui --no-color         # Disable colors (also respects NO_COLOR env)
coco tui --repo <name>      # Jump directly to repo detail screen
```

---

## Workplan

### Phase 1: Project Setup
- [ ] Add ink dependencies (`ink`, `ink-spinner`, `ink-text-input`, `ink-select-input`, `ink-table`)
- [ ] Create `src/tui/` directory structure
- [ ] Add `coco-tui` binary entry point in package.json
- [ ] Configure TypeScript for ink JSX

### Phase 2: Core Infrastructure
- [ ] Create API client module (reuse from web or create shared)
- [ ] Create WebSocket/Socket.IO client for streaming
- [ ] Build shared hooks: `useStatus`, `useRepositories`, `useWorkers`
- [ ] Create TUI router/navigation system (screen stack)

### Phase 3: Status Dashboard (Priority 1)
- [ ] `<StatusScreen>` - System health overview
  - Daemon, Redis, GitHub, CoCo CLI status
  - Worker counts by status
  - Auto-refresh indicator
- [ ] Status indicators: ✅ ⚠️ ❌ with ANSI colors

### Phase 4: Repository List (Priority 2)
- [ ] `<RepositoriesScreen>` - Main dashboard
  - Table with: name, status, workers, branch
  - Search/filter input
  - Keyboard navigation (j/k or arrows)
- [ ] `<AddRepoForm>` - Initialize new repo
- [ ] Delete/repair confirmation dialogs

### Phase 5: Repository Detail (Priority 3)
- [ ] `<RepoDetailScreen>` - Tempering Station equivalent
  - Agent status cards
  - Worker list with status
  - Quick actions (spawn worker)
- [ ] `<SpawnWorkerForm>` - Task, branch, model inputs
- [ ] `<LiveOutput>` - Streaming log pane

### Phase 6: Worker Inspector (Priority 4)
- [ ] `<WorkerDetailScreen>` - Truffle Inspector equivalent
  - Worker header (task, status, branch, PR)
  - Streaming output panel
  - Git log display
  - Control buttons (nudge, pause, terminate)
- [ ] Resource usage display (CPU/memory)

### Phase 7: Metrics Dashboard (Priority 5)
- [ ] `<MetricsScreen>` - ASCII charts
  - Worker throughput (bar chart)
  - PR cycle time (sparkline)
  - CI success rate (percentage bar)
- [ ] Use `ink-progress-bar` or ASCII art for charts

### Phase 8: Polish & Integration
- [ ] Global keybindings (q=quit, ?=help, /=search)
- [ ] Help screen with keyboard shortcuts
- [ ] Error handling and offline mode
- [ ] Color theme support (respect NO_COLOR)
- [ ] Add to main CLI as `coco tui` command

---

## Architecture

```
src/tui/
├── index.tsx              # Entry point, App component
├── router.tsx             # Screen navigation state
├── api/
│   └── client.ts          # HTTP + WebSocket client
├── hooks/
│   ├── useStatus.ts
│   ├── useRepositories.ts
│   ├── useWorkers.ts
│   └── useStreaming.ts
├── screens/
│   ├── StatusScreen.tsx
│   ├── RepositoriesScreen.tsx
│   ├── RepoDetailScreen.tsx
│   ├── WorkerDetailScreen.tsx
│   └── MetricsScreen.tsx
├── components/
│   ├── StatusIndicator.tsx
│   ├── Table.tsx
│   ├── LogPane.tsx
│   ├── ConfirmDialog.tsx
│   ├── TextInput.tsx
│   └── Header.tsx
└── utils/
    └── colors.ts
```

## Key Features Mapping

| Web UI | TUI Equivalent |
|--------|----------------|
| FactoryFloor (/) | RepositoriesScreen |
| StatusPage (/status) | StatusScreen |
| TemperingStation (/repos/:name) | RepoDetailScreen |
| TruffleInspector (/repos/:r/workers/:w) | WorkerDetailScreen |
| MetricsDashboard (/metrics) | MetricsScreen |
| Modals/dialogs | Overlay components |
| Toast notifications | Status bar messages |
| Breadcrumbs | Header with path |

## Keyboard Navigation

```
Global:
  q / Ctrl+C  - Quit
  ?           - Help
  /           - Search (context-aware)
  Esc         - Back / Cancel
  Tab         - Next focus
  Enter       - Select / Confirm

Lists:
  j / ↓       - Move down
  k / ↑       - Move up
  g           - Go to top
  G           - Go to bottom

Actions:
  n           - New (spawn worker, add repo)
  d           - Delete (with confirmation)
  r           - Refresh
  s           - Status page
  m           - Metrics page
```

## Dependencies to Add

```json
{
  "ink": "^5.0.0",
  "ink-spinner": "^5.0.0",
  "ink-text-input": "^6.0.0",
  "ink-select-input": "^5.0.0",
  "ink-table": "^3.1.0",
  "ink-progress-bar": "^3.0.0",
  "cli-boxes": "^3.0.0",
  "figures": "^6.0.0"
}
```

## Notes

- **Shared code opportunity**: API client, types, and some hooks could be shared between web and TUI
- **Streaming**: ink supports re-rendering on state changes, works well with WebSocket events
- **Testing**: ink has `ink-testing-library` for component tests
- **Accessibility**: Respect `NO_COLOR` env var, support `--no-color` flag
