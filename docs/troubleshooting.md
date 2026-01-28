# Troubleshooting

When the chocolate factory hits a snag, check this guide. Below are the most common issues and how to resolve them.

## Docker Not Running

**Symptom:** `coco start` fails with a Docker connection error, or workers fail to spawn.

**Diagnosis:**

```bash
docker info
```

If this returns an error like `Cannot connect to the Docker daemon`, Docker isn't running.

**Fix:**

```bash
# macOS
open -a Docker

# Linux (systemd)
sudo systemctl start docker

# Verify
docker info
```

Make sure your user is in the `docker` group (Linux) so you can run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
# Log out and back in for this to take effect
```

---

## Redis Connection Refused

**Symptom:** The Ganache Bus fails to connect. Logs show `ECONNREFUSED 127.0.0.1:6379` or agent messages aren't being delivered.

**Diagnosis:**

```bash
redis-cli ping
```

If this returns an error instead of `PONG`, Redis isn't running or isn't reachable.

**Fix:**

```bash
# Start Redis via Docker (recommended)
docker run -d --name cocopilot-redis -p 6379:6379 redis:7.4.6-alpine

# Or via system service (Linux)
sudo systemctl start redis

# Or via Homebrew (macOS)
brew services start redis
```

If Redis is running on a non-default host or port, update the configuration:

```bash
# Edit ~/.cocopilot/config.json
{
  "redis": {
    "host": "your-redis-host",
    "port": 6380
  }
}
```

Or set the environment variable:

```bash
export REDIS_URL=redis://your-redis-host:6380
```

**Note:** The Ganache Bus uses two Redis connections (one for publishing, one for subscribing, as required by the Redis pub/sub protocol). Both connect to the same server. Retry logic uses exponential backoff up to 5 seconds with a maximum of 10 retries.

---

## Port 3000 Already in Use

**Symptom:** `coco start` fails with `EADDRINUSE: address already in use :::3000`.

**Diagnosis:**

```bash
# Find what's using port 3000
lsof -i :3000
# or on Linux
ss -tlnp | grep 3000
```

**Fix:**

Option 1 -- Kill the conflicting process:

```bash
# Find the PID from lsof output, then:
kill <pid>
```

Option 2 -- Use a different port:

```bash
coco start --port 3001
```

Or set it permanently in `~/.cocopilot/config.json`:

```json
{
  "webPort": 3001
}
```

---

## Worker Stuck (Not Making Progress)

**Symptom:** A Truffle worker shows as active but hasn't made commits or progress in a long time. The Chocolatier may have already sent a nudge.

**Diagnosis:**

Check worker status from the dashboard or API:

```bash
# Via REST API
curl http://localhost:3000/api/v1/repositories/your-repo/workers

# Via CLI
coco status --json
```

Look for workers with low progress percentage or a long time since last activity.

**Fix:**

Option 1 -- Nudge the worker (gives it a reminder to keep going):

```bash
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers/Snickers/nudge
```

The Chocolatier automatically nudges workers that have been inactive for more than 15 minutes, but you can nudge manually at any time.

Option 2 -- Terminate and respawn:

```bash
# Terminate the stuck worker
curl -X DELETE http://localhost:3000/api/v1/repositories/your-repo/workers/Snickers

# Spawn a new one with the same (or refined) task
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Same task description, maybe with more detail"}'
```

Option 3 -- Check the worker's Docker container directly:

```bash
# List CoCoPilot containers
docker ps --filter label=cocopilot.managed

# Check logs for a specific worker
docker logs cocopilot-truffle-Snickers
```

---

## Merge Conflicts

**Symptom:** A worker's PR has merge conflicts with the base branch. The PR cannot be merged automatically.

**Diagnosis:**

The Temperer or Enrober will detect this when polling PRs. Check the PR Pipeline page on the Cocoa Board, or:

```bash
gh pr view <pr-number> --json mergeable
```

**Fix:**

Option 1 -- Spawn a fixup worker. When CI fails or conflicts are detected, the Temperer sends a `SPAWN_FIXUP` message to the Chocolatier, which automatically spawns a new worker to address the issue. Check if a fixup worker was already spawned:

```bash
coco status --json
```

Option 2 -- Resolve manually. If auto-fixup didn't work:

```bash
# Check out the worker's branch
git checkout work/Snickers

# Rebase onto main
git rebase main

# Resolve conflicts, then push
git push --force-with-lease
```

Option 3 -- Close the PR and respawn with updated context. If the conflicts are too complex:

```bash
gh pr close <pr-number>
curl -X POST http://localhost:3000/api/v1/repositories/your-repo/workers \
  -H 'Content-Type: application/json' \
  -d '{"task": "Redo the task, accounting for recent changes to main"}'
```

---

## Daemon Won't Start (Stale PID File)

**Symptom:** `coco start` reports that the daemon is already running, but it isn't.

**Diagnosis:**

```bash
# Check if the PID in the file is actually running
cat ~/.cocopilot/daemon.pid
ps -p $(cat ~/.cocopilot/daemon.pid)
```

If the process doesn't exist, the PID file is stale from a previous crash.

**Fix:**

```bash
# Remove the stale PID file
rm ~/.cocopilot/daemon.pid

# Start again
coco start
```

---

## State Corruption After Crash

**Symptom:** After a crash or power loss, `coco status` shows incorrect state -- workers listed as running that don't exist, or missing workers that are actually running.

**Fix:**

CoCoPilot includes automatic state recovery. On daemon restart, it:

1. Detects corrupted state files and backs them up
2. Reconciles persisted state with actual Docker containers
3. Marks orphaned workers (in state but no container) as `stuck`
4. Marks unknown containers (running but not in state) for cleanup

Simply restart the daemon:

```bash
coco stop --force
coco start
```

Check the daemon log for recovery details:

```bash
cat ~/.cocopilot/daemon.log
```

---

## GitHub CLI Authentication Issues

**Symptom:** `coco init` fails with authentication errors, or workers can't create PRs.

**Diagnosis:**

```bash
gh auth status
```

**Fix:**

```bash
# Re-authenticate
gh auth login

# Verify access to the repository
gh repo view your-org/your-repo
```

Make sure the token has the required scopes: `repo`, `read:org`, and `workflow` (if CI uses GitHub Actions).

---

## Workers Exceeding Resource Limits

**Symptom:** Worker containers are killed by Docker OOM killer, or tasks fail silently.

**Diagnosis:**

```bash
# Check container stats
docker stats --filter label=cocopilot.managed --no-stream

# Check if a container was OOM killed
docker inspect cocopilot-truffle-Snickers --format='{{.State.OOMKilled}}'
```

**Fix:**

Increase resource limits in `~/.cocopilot/config.json`:

```json
{
  "containerMemoryLimit": "8g",
  "containerCpuLimit": "4"
}
```

Then reload the configuration:

```bash
# Send SIGHUP to the daemon to reload config
kill -HUP $(cat ~/.cocopilot/daemon.pid)
```

New workers will use the updated limits. Existing workers keep their original limits until they are terminated and respawned.

---

## Too Many Workers (Max Workers Reached)

**Symptom:** Spawning a new worker fails with a "max workers" error.

**Diagnosis:**

```bash
coco status --json | grep -c "truffle"
```

**Fix:**

Either terminate idle workers or increase the limit:

```json
{
  "maxWorkersPerRepo": 15
}
```

---

## BYOK Key Errors

**Symptom:** `coco config keys set` fails with an error about the password or key format.

### Missing Password

```
Error: Set COCOPILOT_KEYS_PASSWORD environment variable to encrypt your keys.
```

**Fix:**

```bash
export COCOPILOT_KEYS_PASSWORD="your-secure-password"
coco config keys set anthropic sk-ant-your-key
```

### Key Format Validation Failed

```
Error: Key does not match expected format for anthropic.
```

**Fix:**

If your key is valid but doesn't match the expected format pattern, use `--skip-validation`:

```bash
coco config keys set anthropic your-key --skip-validation
```

Expected key formats:

| Provider | Pattern |
|----------|---------|
| `anthropic` | Starts with `sk-ant-`, followed by 20+ alphanumeric characters |
| `openai` | Starts with `sk-`, followed by 20+ alphanumeric characters |
| `azure` | 32-character hexadecimal string |

### Cannot Decrypt Keys File

If you've changed your password or the `~/.cocopilot/keys.json` file is corrupted, the system will start fresh with a new file. To reset manually:

```bash
rm ~/.cocopilot/keys.json
```

Then re-add your keys with the new password.

---

## MCP Server Connection Failures

**Symptom:** Custom MCP servers fail to load or agents can't access external tools.

**Diagnosis:**

Check the per-repo config for syntax errors:

```bash
cat .cocopilot/config.json | python3 -m json.tool
```

**Common issues:**

1. **Missing required fields:** Every MCP server entry needs `name`, `url`, and `transport`.
2. **Invalid transport:** Must be exactly `"stdio"` or `"sse"`.
3. **SSE server unreachable:** For SSE transport, CoCoPilot validates reachability with a HEAD request (5-second timeout). Ensure the server is running and accessible.

**Fix for SSE connectivity:**

```bash
# Test if the server is reachable
curl -I http://localhost:8080/mcp
```

If the server isn't running, start it before starting CoCoPilot agents.

**Fix for stdio transport:**

Ensure the command path in `url` is executable:

```bash
which my-mcp-tool     # Verify it's in PATH
chmod +x /path/to/tool  # Ensure it's executable
```

---

## Custom Agent Parsing Errors

**Symptom:** `coco agents list` shows fewer agents than expected, or `coco agents spawn` fails.

**Diagnosis:**

Check stderr output when listing agents -- malformed files are skipped with a warning:

```bash
coco agents list 2>&1
```

**Common issues:**

1. **Missing frontmatter delimiters:** Files must start with `---` and have a closing `---`.
2. **Missing `name` field:** Every agent definition requires a `name` in frontmatter.
3. **Missing `class` field:** Must be `"persistent"` or `"ephemeral"`.
4. **Invalid `class` value:** Only `persistent` and `ephemeral` are valid.

**Fix:**

Verify the file format:

```markdown
---
name: my-agent
class: persistent
tools:
  - read_file
---
Your system prompt here.
```

See the [Custom Agents Guide](custom-agents.md) for the full specification.

---

## Metrics Dashboard Not Loading

**Symptom:** The metrics page at `http://localhost:3000/metrics` shows an error or no data.

**Diagnosis:**

Check that the metrics API endpoint is responding:

```bash
curl http://localhost:3000/api/v1/metrics
```

**Common issues:**

1. **No data yet:** Metrics are computed from worker state. If no workers have completed tasks, charts will be empty.
2. **Daemon not running:** The metrics API requires the Concher daemon to be active.
3. **Dashboard connection lost:** The metrics page auto-refreshes every 30 seconds. If the daemon was restarted, refresh the browser page.

**Fix:**

Restart the daemon and ensure workers have run:

```bash
coco stop
coco start
coco status
```

---

## Need More Help?

- Check the daemon log: `~/.cocopilot/daemon.log`
- Check Docker container logs: `docker logs cocopilot-truffle-<name>`
- Check the Ganache Bus message directory: `~/.cocopilot/repos/<repo>/messages/`
- Open the Cocoa Board at `http://localhost:3000` for real-time diagnostics
- File an issue on the repository's GitHub page
