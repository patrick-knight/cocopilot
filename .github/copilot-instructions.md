# Copilot Instructions for CoCoPilot

## Build, test, and lint
- Node: >= 23 (see package.json engines)
- Build: `npm run build` (runs `tsc` then `vite build` for the web UI)
- Lint/typecheck: `npm run lint` (tsc --noEmit)
- Unit/integration tests: `npm test` (Jest)
- Single Jest test file: `npm test -- src/git/worktree.test.ts`
- Single Jest test by name: `npm test -- -t "initializeRepository"`
- E2E API/CLI tests (Jest): `npm run test:e2e` (tests/e2e)
- E2E UI tests (Playwright): `npm run test:e2e:ui`
- Single Playwright spec: `npx playwright test tests/e2e/ui/dashboard.spec.ts`

## High-level architecture
- **CLI + daemon**: `src/cli/coco.ts` is the CLI entrypoint; it starts/stops the **Concher** daemon (`src/daemon/concher.ts`) which owns lifecycle, state, container orchestration, and agent supervision.
- **Server + API**: Express + Socket.IO server lives in `src/server/app.ts`, exposes REST under `/api/v1`, serves the built web UI from `dist-web`, and bridges real-time streams via Socket.IO/Redis.
- **State + persistence**: `src/state` manages global/daemon/repo state, persisted to `~/.cocopilot/state.json` with atomic writes; global config lives in `~/.cocopilot/config.json`.
- **Agents + messaging**: Core agents are in `src/agents` (Chocolatier supervisor, Temperer/Enrober merge agents, Reviewer/Security, Truffle workers). Messaging is via `src/messaging` (Redis bus + file store fallback).
- **Web UI**: React 19 app in `web/` built with Vite + Tailwind CSS + React Router v7. Real-time updates via Socket.IO client hooks in `src/web/hooks/`. Production build emitted to `dist-web`.
- **MCP integration**: MCP server wiring lives in `src/mcp` and GitHub MCP defaults in `src/github/mcp-config.ts`.
- **Copilot SDK**: `src/copilot/` wraps `@github/copilot-sdk` with `CopilotClientWrapper`, a tool system (`defineTool` + `createAgentTools` factory), and managed sessions for streaming.

## Key conventions

### Scoped broker identities
Always use `scopedAgentName` / `scopedWorkerName` from `src/agents/scoped-name.ts` for broker subscriptions (pattern `type:repoName`). Use `bareNameFromScoped` when mapping back to state keys. Bare names trigger broker warnings.

### Agent communication
Agents communicate **exclusively** via `MessageBroker` (never direct method calls). Use `broker.send()` with typed `MessageType` enum values. Messages are fire-and-forget async; durability comes from the file store replay mechanism, not ACK waiting.

### Message types
26 typed messages cover task lifecycle (`TASK_ASSIGNED`, `TASK_COMPLETE`, `TASK_FAILED`), PR workflow (`PR_CREATED`, `PR_MERGED`, `CI_FAILED`, `SPAWN_FIXUP`), reviews, health checks (`STATUS_REQUEST`/`STATUS_RESPONSE`, `NUDGE`), and worker control. Type-safe payloads are enforced via `MessagePayloadMap` in `src/messaging/types.ts`.

### State management
- State hierarchy: `DaemonState` → `repositories` (map) → `RepoState` → `agents` + `workers` maps.
- Always mutate state through `StateManager` methods, never write files directly.
- Writes are serialized via an operation queue and use atomic temp-file-then-rename.
- `StateManager` emits events (`workerAdded`, `workerUpdated`, `agentUpdated`, etc.) that Concher and the web server consume.

### Worktree layout
Worker branches are `work/<WorkerName>` and their worktrees live under `~/.cocopilot/repos/<repoName>/worktrees/<WorkerName>/`. Cleanup is idempotent (safe to call multiple times). See `src/git/worktree.ts`.

### Docker containers
Container names follow `cocopilot-{type}[-{workerName}]`. All managed containers are labeled with `cocopilot.managed-by=true` and `cocopilot.container-type` for filtering. Resource limits use string parsing (`4g`, `512m` for memory; `2`, `0.5` for CPU).

### API routes
Routes live under `src/api/v1/` and follow this pattern: extract/validate params → look up state via `stateManager.getRepo()` → use `next(createApiError(status, message))` for errors → return JSON. Routes trigger agent actions by sending messages via `broker.send()`.

### Worker naming
Workers are auto-assigned candy names (20 adjectives × 20 nouns = 400 combinations, e.g. "SweetCaramel", "RichNougat"). Names are unique per repo with a configurable worker limit (default 10).

### Configuration hierarchy
Environment variables (`COCOPILOT_{PROVIDER}_KEY`) take priority over `~/.cocopilot/config.json` (global) which is overridden by `.cocopilot/config.json` (per-repo). API keys are encrypted with AES-256-GCM in `~/.cocopilot/keys.json`.

### Custom agents
Define in `.cocopilot/agents/*.md` with YAML frontmatter (name/description/model/triggers/tools) and a markdown system prompt body. Loaded by `src/agents/custom-agent-loader.ts`.

### Testing patterns
- Tests use real class instances (e.g. `StateManager`) against mocked external services.
- E2E tests live in `tests/e2e/`; unit tests are co-located with source (`*.test.ts`).
- `jest.setup.cjs` provides `TextEncoder`/`TextDecoder` polyfills needed by react-router-dom v7.
- Jest module mapper strips `.js` extensions and redirects `openapi.ts` to `__mocks__/openapi.ts`.

### Model configuration
`src/models.ts` defines `AVAILABLE_MODELS` with cost multipliers. Default model is `claude-sonnet-4.5`. Use `getModel()`, `isValidModel()`, and `MODEL_SELECT_OPTIONS` for lookups and UI rendering.
