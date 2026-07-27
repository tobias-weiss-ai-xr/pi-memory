---
description: "Experiential memory: learn from past sessions and persist patterns, decisions, and insights across sessions. Memories are auto-injected into context at session start."
---

# 🧠 Pi Memory

Pi Memory is an experiential memory system that learns from past coding sessions
and surfaces relevant prior knowledge. **Relevant memories are automatically injected
into the model's system prompt at session start** — but you can still search for more.

> 💡 **Tip:** Your session already has relevant memories loaded. Scroll up or
> check the system prompt to see them. Use the tools below for deeper search.

---

## Tools

### `memory_search`
Search past learnings. Results sorted by relevance (importance × recency).

```
memory_search query="docker port mapping" limit=5
memory_search query="grafana datasource" category=insight
memory_search query=""                        # All, sorted by relevance
memory_search query="ansible" project=ansible  # Filter by project
```

### `memory_store`
Store a new learning. Auto-deduplicates: if same topic+project+category exists
across sessions, it merges content, boosts importance, and combines tags.
**Importance is auto-suggested by category** (warnings/decisions → 4★, insights/patterns → 3★, etc.).

```
# Full example:
memory_store topic="UFW blocks Docker port 9090" \
  category=warning \
  content="Prometheus in Docker can't reach host services via VPN IP if UFW blocks the port. Use 127.0.0.1 instead." \
  tags="docker,ufw,networking" \
  importance=4

# Minimal (importance auto-assigned from category):
memory_store topic="State management pattern" \
  category=pattern \
  content="Centralize mutable state in a Store module with load/save helpers."
```

### `memory_stats`
Show memory statistics, category/project distribution, and this-session count.

```
memory_stats
```

### `memory_update`
Update an existing memory by ID (find it via `memory_search` first).

```
memory_update id="mem_xxx_yyy" content="Updated content" importance=5
memory_update id="mem_xxx_yyy" tags="new,tags,here"
```

### `memory_delete`
Remove a memory by ID (irreversible).

```
memory_delete id="mem_xxx_yyy"
```

---

## Categories

| Category | Icon | When to Use | Auto-Importance | Example |
|----------|------|-------------|-----------------|---------|
| `warning` | ⚠️ | Pitfall to avoid | **4★** | "UFW blocks Docker → host via external IP" |
| `decision` | 🏛️ | Architectural choice | **4★** | "Chose SQLite over JSON for queryability" |
| `insight` | 💡 | Non-obvious truth | **3★** | "Traefik needs network_mode:host for ACME" |
| `pattern` | 🔄 | Reusable approach | **3★** | "Store pattern for state management" |
| `todo` | 📋 | Future task | **2★** | "Add error handling to memory store" |

---

## Session Lifecycle

### 1. Session Start — Review Context (Optional)

Relevant memories are **automatically loaded** into your system prompt.
You don't need to search — they're already there. However, you can still:

```
# Get additional context on a specific topic
memory_search query="<specific topic>" limit=5

# Check overall memory stats
memory_stats
```

### 2. During Session — Store Discoveries Immediately

**When you discover something important, store it right away.**

```
memory_store topic="<descriptive title>" category=insight \
  content="<what was learned, why it matters, how to reproduce>" \
  tags="key1,key2,project-name"
```

Good candidates for storing:
- A non-obvious bug fix
- An architectural decision with rationale
- A CLI incantation or config trick
- A security gotcha
- A tool or workflow pattern

### 3. Session End — Persist Outcomes

A session bookmark is stored automatically. For deeper persistence, store
a structured summary of what was accomplished:

```
memory_store topic="Session summary: <topic>" category=decision \
  content="Completed: <accomplishments>.\\n"
  content+="Decisions: <key choices>.\\n"
  content+="Next: <what to tackle next>.\\n"
  content+="Issues: <known problems>." \
  tags="session,<project>" \
  importance=3
```

---

## Project-Specific Guidance

### Ansible Infrastructure (`ansible-private`)

- Store playbook/role changes with `project=ansible`
- Tag with `host=<hostname>` for host-specific configs
- Security fixes: tags `security,<cve>`, importance 4+
- Docker issues: tags `docker,<service>`
- Monitoring changes: tags `prometheus,grafana,alert`

### General

- Use `project=<repo-name>` (auto-detected from git remote)
- Tag with technology names: `docker, typescript, python, ansible`
- Set importance=4+ for anything that could cause data loss or security issues
- Set importance=2 for nice-to-haves and minor observations

---

## Integration with Graphiti

| System | Purpose | When to Use |
|--------|---------|-------------|
| **Pi Memory** (`memory_search`) | Experiential knowledge | Coding patterns, gotchas, decisions, learnings |
| **Graphiti** (`graphiti_search`) | Structured entity graph | Hosts, services, relationships, cross-agent facts |

```
# Experiential: "how" and "why"
memory_search query="Traefik" category=warning

# Structured: "what" and "where"
graphiti_search query="traefik proxy config"
```

---

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `PI_MEMORY_TTL_DAYS` | `90` | Auto-prune old low-importance entries |
| `PI_MEMORY_MAX_CONTEXT` | `8` | Max memories in auto-context prompt |

---

## Best Practices

1. ✅ **Auto-context is loaded** — but search for specifics if needed
2. ✅ **Store immediately** after every significant discovery
3. ✅ Use specific, searchable topics (not "Fixed bug")
4. ✅ Set importance=4-5 for critical learnings
5. ✅ Tag generously: include project + technology + domain
6. ✅ Use `memory_stats` to check what's available
7. ✅ Use `memory_update` to correct or supplement entries
