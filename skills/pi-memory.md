---
description: Experiential memory — learn from past sessions and persist patterns, decisions, and insights across sessions.
---

# Pi Memory

Pi Memory is an experiential memory system that learns from past coding sessions
and surfaces relevant prior knowledge. **Always use it at session start and end.**

## Tools

### memory_search
Search past learnings, decisions, patterns, and warnings.

```
memory_search query="docker port mapping" limit=5
memory_search query="grafana datasource" category=insight
memory_search query="pi-memory" project=pi-memory
```

### memory_store
Store an experiential learning, decision, pattern, warning, or todo.

```
memory_store topic="UFW blocks Docker port 9090" category=warning content="Prometheus in Docker can't reach host services via VPN IP if UFW blocks the port. Use 127.0.0.1 instead." tags="docker,ufw,networking" importance=4
memory_store topic="Use Store pattern for state" category=pattern content="Centralize mutable state in a Store module with load/save helpers. Avoid scattering file I/O across the codebase." tags="architecture,typescript"
```

### memory_stats
Check how many memories are stored and their distribution.

```
memory_stats
```

### memory_update
Update or correct an existing memory (find its ID via `memory_search` first).

```
memory_update id="mem_xxx_yyy" content="Corrected/supplemented content" importance=4
```

### memory_delete
Remove a memory by ID (irreversible).

```
memory_delete id="mem_xxx_yyy"
```

## Categories

| Category | When to Use | Example |
|----------|-------------|---------|
| `insight` | Discovered a non-obvious truth about a system | "Traefik needs network_mode:host for ACME" |
| `pattern` | A reusable approach that worked well | "Store JSON state in ~/.config/app/" |
| `decision` | An architectural choice with rationale | "Chose SQLite over JSON for queryability" |
| `warning` | A pitfall to avoid in the future | "UFW blocks Docker → host via external IP" |
| `todo` | Something to address in a future session | "Add proper error handling to the memory store" |

## Session Lifecycle (Mandatory)

### 1. Session Start — Retrieve Prior Context

**Always call `memory_search` at the beginning of every session** to load
relevant prior knowledge. You are NOT automatically given this context —
you must retrieve it explicitly.

```
# General: get context for current project
memory_search query="<current task topic>" project=<project>

# Get high-importance warnings for the project
memory_search query="" category=warning project=<project>

# Check overall memory stats
memory_stats
```

### 2. During Session — Store Discoveries Immediately

When you discover a non-obvious truth, fix a tricky bug, or make an
architectural decision, **store it right away** — don't wait until the end.

```
memory_store topic="<descriptive title>" category=insight \
  content="<what was learned, why it matters, how to reproduce>" \
  tags="key1,key2,project-name" importance=4
```

### 3. Session End — Persist Outcomes

**Always call `memory_store` at the end of every session** with a structured
summary covering: what was done, key decisions, what's left for next time.

```
memory_store topic="Session: <topic> - <date>" category=decision \
  content="Completed: <key accomplishments>.\nDecisions: <architectural choices>.\nNext: <what to tackle next>.\nIssues: <known problems>." \
  tags="session,<project>,<topic>" importance=3
```

## Project Patterns

When working with **Ansible infrastructure** (this repo), always store:

- Playbook or role changes with `project=ansible`
- Host-specific configs with tags like `host=<hostname>`
- Security fixes with tags `security,<cve-or-type>` and importance=4+
- Docker/container issues with tags `docker,<service>`
- Monitoring changes with tags `prometheus,grafana,alert`

## Integration with Graphiti

Pi Memory is for **experiential** memory (coding patterns, lessons learned,
decisions). Graphiti is for **structured** memory (entities, relationships,
cross-agent facts). Use both:

- **Graphiti** for structured data about hosts, services, and their relationships
- **Pi Memory** for experiential knowledge about how things work and gotchas

```
# Query Graphiti for structured context about a host/service:
graphiti_search query="<host or service name>"

# Store experiential learning:
memory_store topic="..." category=insight ...
```

## Best Practices

1. **Mandatory**: Call `memory_search` at session start + `memory_store` at session end
2. **Store immediately** after every significant discovery or decision
3. Use specific, searchable topics (not generic)
4. Set importance=4 or 5 for critical learnings (security, data loss risk)
5. Tag generously: include project, technology, domain
6. Use `memory_stats` at session start to see what's available
