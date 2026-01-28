# API Reference

CoCoPilot exposes two sets of REST API endpoints:

1. **Internal API** -- Used by the Cocoa Board dashboard for repository, worker, and agent management. These routes are nested under `/api/v1/repositories/`.
2. **External Integration API** -- A flat API designed for external tools, scripts, and custom dashboards. These routes are nested under `/api/v1/`.

Both APIs are served by the same Express.js server at `http://localhost:<webPort>` (default port `3000`).

---

## External Integration API

The external API provides a simplified, flat interface for programmatic access. Workers are accessible by name across all repositories without needing to specify the repo hierarchy.

**Base URL:** `http://localhost:3000/api/v1`

### Workers

#### POST /api/v1/workers

Spawn a new worker.

**Request Body:**

```json
{
  "task": "Add unit tests for the auth module",
  "repoName": "my-app",
  "branch": "main",
  "name": "Snickers",
  "model": "claude-sonnet-4-5"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | `string` | Yes | Task description for the worker |
| `repoName` | `string` | Yes | Name of the tracked repository |
| `branch` | `string` | No | Base branch to start from |
| `name` | `string` | No | Custom worker name (auto-assigned candy name if omitted) |
| `model` | `string` | No | AI model override |

**Response (201):**

```json
{
  "name": "Snickers",
  "task": "Add unit tests for the auth module",
  "branch": "work/Snickers",
  "status": "starting",
  "repoName": "my-app",
  "createdAt": "2026-01-28T12:00:00.000Z"
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| `400` | Missing `task` or `repoName` |
| `404` | Repository not tracked |
| `409` | Worker name already exists or max workers reached |

---

#### GET /api/v1/workers

List all workers across all tracked repositories.

**Response (200):**

```json
[
  {
    "name": "Snickers",
    "task": "Add unit tests",
    "status": "working",
    "repoName": "my-app",
    "createdAt": "2026-01-28T12:00:00.000Z"
  },
  {
    "name": "KitKat",
    "task": "Fix login bug",
    "status": "completed",
    "repoName": "api-service",
    "createdAt": "2026-01-28T11:00:00.000Z"
  }
]
```

---

#### GET /api/v1/workers/:name

Get a specific worker by name. Searches across all repositories.

**Response (200):**

```json
{
  "name": "Snickers",
  "task": "Add unit tests",
  "status": "working",
  "branch": "work/Snickers",
  "repoName": "my-app",
  "createdAt": "2026-01-28T12:00:00.000Z"
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| `404` | Worker not found |

---

#### DELETE /api/v1/workers/:name

Stop and remove a worker by name. Searches across all repositories.

**Response:** `204 No Content`

**Errors:**

| Status | Description |
|--------|-------------|
| `404` | Worker not found |

---

### Webhooks

Register callback URLs to receive event notifications. Webhooks are stored in memory and reset on daemon restart.

#### POST /api/v1/webhooks

Register a new webhook.

**Request Body:**

```json
{
  "url": "https://example.com/hooks/cocopilot",
  "events": ["worker.completed", "pr.merged"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes | Callback URL (must be a valid URL) |
| `events` | `string[]` | Yes | Event types to subscribe to (at least one) |

**Valid Events:**

| Event | Description |
|-------|-------------|
| `worker.created` | A new Truffle worker was spawned |
| `worker.updated` | A worker's status changed |
| `worker.completed` | A worker finished its task |
| `worker.failed` | A worker encountered an error |
| `worker.removed` | A worker was terminated |
| `pr.created` | A pull request was created |
| `pr.merged` | A pull request was merged |
| `ci.failed` | CI checks failed on a PR |

**Response (201):**

```json
{
  "id": "a1b2c3d4-e5f6-...",
  "url": "https://example.com/hooks/cocopilot",
  "events": ["worker.completed", "pr.merged"],
  "createdAt": "2026-01-28T12:00:00.000Z"
}
```

**Errors:**

| Status | Description |
|--------|-------------|
| `400` | Missing or invalid `url`, missing or empty `events`, or invalid event names |

---

#### GET /api/v1/webhooks

List all registered webhooks.

**Response (200):**

```json
[
  {
    "id": "a1b2c3d4-e5f6-...",
    "url": "https://example.com/hooks/cocopilot",
    "events": ["worker.completed", "pr.merged"],
    "createdAt": "2026-01-28T12:00:00.000Z"
  }
]
```

---

#### DELETE /api/v1/webhooks/:id

Remove a registered webhook.

**Response:** `204 No Content`

**Errors:**

| Status | Description |
|--------|-------------|
| `404` | Webhook not found |

---

### System Status

#### GET /api/v1/status

Returns system health information.

**Response (200):**

```json
{
  "daemon": {
    "up": true,
    "status": "running",
    "pid": 12345,
    "uptimeSeconds": 3600,
    "startedAt": "2026-01-28T11:00:00.000Z"
  },
  "redis": {
    "connected": true
  },
  "workers": {
    "total": 5,
    "byStatus": {
      "working": 3,
      "completed": 1,
      "stuck": 1
    }
  },
  "repositories": 2,
  "version": "1.0.0"
}
```

---

### Metrics

#### GET /api/v1/metrics

Returns aggregated metrics across all tracked repositories and workers.

**Response (200):**

```json
{
  "workerThroughput": [
    { "hour": "2026-01-28T00:00", "count": 2 },
    { "hour": "2026-01-28T01:00", "count": 0 }
  ],
  "prCycleTime": [
    { "date": "2026-01-27", "avgHours": 1.5 },
    { "date": "2026-01-28", "avgHours": 2.3 }
  ],
  "ciSuccessRate": [
    { "status": "pass", "count": 12 },
    { "status": "fail", "count": 3 }
  ],
  "tokenUsage": [
    { "model": "claude-sonnet-4-5", "tokens": 8 },
    { "model": "gpt-5", "tokens": 2 }
  ]
}
```

**Metrics Fields:**

| Field | Description |
|-------|-------------|
| `workerThroughput` | Tasks completed per hour over the last 24 hours |
| `prCycleTime` | Average time from PR creation to merge, grouped by day (in hours) |
| `ciSuccessRate` | Total pass vs fail counts across all workers |
| `tokenUsage` | Task counts grouped by AI model (note: counts tasks, not actual tokens) |

---

## Internal Dashboard API

These endpoints are used by the Cocoa Board web dashboard. They follow a repository-scoped hierarchy.

**Base URL:** `http://localhost:3000/api/v1`

### Configuration

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

### Workers (Repository-Scoped)

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

## Error Format

All API errors follow a consistent format:

```json
{
  "error": {
    "status": 404,
    "message": "Worker \"Snickers\" not found"
  }
}
```

| Field | Description |
|-------|-------------|
| `error.status` | HTTP status code |
| `error.message` | Human-readable error description |
