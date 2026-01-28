# Custom Agents Guide

CoCoPilot comes with four built-in agent types (Chocolatier, Temperer, Enrober, Truffle), but you can define your own agents to extend the system. Custom agents are configured using Markdown files with YAML frontmatter, placed in the `.cocopilot/agents/` directory of your repository.

## Creating an Agent Definition

Create a `.md` file in `.cocopilot/agents/`. The file uses YAML frontmatter for configuration and the Markdown body as the agent's system prompt.

### File Format

```markdown
---
name: reviewer
class: persistent
tools:
  - read_file
  - search_code
---
You are a code reviewer agent for CoCoPilot.

Your responsibilities:
1. Review all pull requests for correctness and style
2. Flag potential security issues
3. Suggest improvements to test coverage

When reviewing, focus on:
- Logic errors and edge cases
- Consistent naming conventions
- Missing error handling
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Agent display name. Must be unique across all agents. |
| `class` | `"persistent" \| "ephemeral"` | Yes | Agent lifecycle type (see below). |
| `tools` | `string[]` | No | Tool names the agent has access to. Defaults to empty. |

### Agent Classes

**Persistent** agents stay running until explicitly stopped. Use persistent agents for long-running tasks like monitoring, reviewing, or coordinating.

```yaml
class: persistent
```

**Ephemeral** agents run once and stop when their task is complete. Use ephemeral agents for one-off tasks like generating a report or running a specific analysis.

```yaml
class: ephemeral
```

### System Prompt

Everything after the closing `---` frontmatter delimiter is used as the agent's system prompt. Write this in Markdown. The prompt is passed directly to the Copilot SDK session, so you can use the same conventions as any AI system prompt -- describe the agent's role, responsibilities, rules, and expected behavior.

## CLI Commands

### List Agent Definitions

Scan and display all agent definitions found in `.cocopilot/agents/`:

```bash
coco agents list
```

To scan a different directory:

```bash
coco agents list --dir /path/to/agents
```

For machine-readable output:

```bash
coco agents list --json
```

### Spawn a Custom Agent

Start an agent from a definition file:

```bash
coco agents spawn --from .cocopilot/agents/reviewer.md
```

Override the AI model for this agent:

```bash
coco agents spawn --from .cocopilot/agents/reviewer.md --model gpt-5
```

## Examples

### Security Reviewer

An agent that monitors PRs for security issues:

```markdown
---
name: security-reviewer
class: persistent
tools:
  - read_file
  - search_code
  - send_message
---
You are a security reviewer for this repository.

Monitor all new pull requests and review them for:
1. SQL injection vulnerabilities
2. Cross-site scripting (XSS)
3. Authentication and authorization issues
4. Secrets or credentials committed to code
5. Insecure dependencies

When you find an issue, send a message to the Chocolatier with the PR number and a description of the vulnerability.
```

### Documentation Generator

An ephemeral agent that generates documentation on demand:

```markdown
---
name: docs-generator
class: ephemeral
tools:
  - read_file
  - search_code
---
You are a documentation generator.

Your task: scan the codebase and generate API documentation for all exported functions and classes. Output the documentation in Markdown format.

Focus on:
- Public function signatures and their parameters
- Return types and possible errors
- Usage examples where the function is called in the codebase
```

### Test Coverage Analyzer

An ephemeral agent that reports on test coverage:

```markdown
---
name: coverage-analyzer
class: ephemeral
tools:
  - read_file
  - search_code
---
You are a test coverage analyzer.

Scan the codebase and identify:
1. Source files without corresponding test files
2. Public functions that are not covered by any test
3. Complex functions (high cyclomatic complexity) that lack tests

Produce a prioritized report listing the files and functions most in need of test coverage.
```

## Agent Definition Parsing

CoCoPilot uses a lightweight YAML frontmatter parser that supports:

- **Scalar values**: `name: reviewer`
- **Simple arrays**: Lines starting with `  - ` under a key
- **Comments**: Lines starting with `#` are ignored
- **Blank lines**: Ignored in frontmatter

The parser does not support nested objects, multi-line strings, or other advanced YAML features. Keep frontmatter simple.

## Error Handling

When loading agent definitions, CoCoPilot:

- Skips files that fail to parse and logs a warning to stderr
- Requires both `name` and `class` fields -- missing either causes a parse error
- Validates `class` must be exactly `"persistent"` or `"ephemeral"`
- Validates all `tools` entries are strings

Common errors:

| Error | Cause |
|-------|-------|
| `Missing YAML frontmatter (--- delimiters)` | File doesn't start with `---` |
| `Missing required "name" field` | No `name:` in frontmatter |
| `Missing required "class" field` | No `class:` in frontmatter |
| `Invalid agent class "foo"` | `class:` is not `persistent` or `ephemeral` |

## File Organization

```
.cocopilot/
  agents/
    reviewer.md           # Custom reviewer agent
    security-scanner.md   # Security scanning agent
    docs-generator.md     # Documentation generator
  config.json             # Per-repo configuration
```

Agents are loaded from the `.cocopilot/agents/` directory relative to the repository root. Each `.md` file in this directory is treated as an agent definition.
