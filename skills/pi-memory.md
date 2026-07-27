---
description: Experiential memory — learn from past sessions and persist patterns, decisions, and insights across sessions.
---

# Pi Memory

Pi Memory is an experiential memory system that learns from past coding sessions and surfaces relevant prior knowledge.

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

## Categories

| Category | When to Use | Example |
|----------|-------------|---------|
| `insight` | Discovered a non-obvious truth about a system | "Traefik needs network_mode:host for ACME" |
| `pattern` | A reusable approach that worked well | "Store JSON state in ~/.config/app/" |
| `decision` | An architectural choice with rationale | "Chose SQLite over JSON for queryability" |
| `warning` | A pitfall to avoid in the future | "UFW blocks Docker → host via external IP" |
| `todo` | Something to address in a future session | "Add proper error handling to the memory store" |

## Session Lifecycle

- **Session start**: Pi Memory automatically loads relevant memories for the current project
- **Session end**: A lightweight bookmark is stored automatically
- **Manual store**: Use `memory_store` during or after significant discoveries

## Integration with Graphiti

Pi Memory is for **experiential** memory (coding patterns, lessons learned, decisions).
Graphiti is for **structured** memory (entities, relationships, cross-agent facts).
Use both: Graphiti for structured data, Pi Memory for experiential knowledge.

## Best Practices

1. Store after every significant discovery or decision
2. Use specific, searchable topics
3. Set importance=4 or 5 for critical learnings
4. Tag generously for better search
5. Use `memory_stats` at session start to see what's available
