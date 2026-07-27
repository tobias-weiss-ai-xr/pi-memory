# 🧠 Pi Memory

> Experiential memory for [pi](https://pi.dev) — learns from past coding sessions, surfaces relevant knowledge, and persists insights across sessions.

[![GitHub](https://img.shields.io/badge/github-tobias--weiss--ai--xr/pi--memory-blue)](https://github.com/tobias-weiss-ai-xr/pi-memory)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Overview

Pi Memory captures **what you learn while coding** — insights, decisions, patterns, and warnings — and makes them available in future sessions so you never repeat mistakes or forget hard-won knowledge.

**Key differentiator:** Memories are **automatically injected into the model's context** at session start via pi's `resources_discover` system. The model sees relevant past learnings without having to call any tool — though it can still search for more.

### How It Works

```
Session Start                          Session End
     │                                      │
     ▼                                      │
┌────────────────────┐                      │
│ 1. Context Prompt   │                      │
│    written with     │                      │
│    top memories     │                      │
│    (auto)           │                      │
└────────┬───────────┘                      │
         │                                  │
         ▼                                  ▼
┌────────────────────┐            ┌────────────────────┐
│ 2. resources_       │            │ 6. Session          │
│    discover serves  │            │    bookmark stored  │
│    prompt to model  │            │    (auto)           │
└────────┬───────────┘            └────────┬───────────┘
         │                                 │
         ▼                                 ▼
┌────────────────────┐            ┌────────────────────┐
│ 3. Model sees past  │            │ 7. Auto-prune old   │
│    learnings in     │            │    low-importance   │
│    system prompt    │            │    entries (TTL)    │
└────────────────────┘            └────────────────────┘
         │
         │  ┌──────────────────────┐
         └──│ 4. Agent can search   │
            │ 5. Agent can store    │
            │    new learnings      │
            └──────────────────────┘
```

## Features

### 🧠 Auto-Context at Session Start
Relevant memories from past sessions are automatically injected into the model's system prompt — no tool call needed. The prompt is categorized (⚠️ Warnings first, then 🏛️ Decisions, 💡 Insights, 🔄 Patterns), with relevance scores and star ratings.

### 🔍 Smart Relevance Search
Search results are sorted by `(importance × 60%) + (recency × 40%)` — a critical warning from months ago outranks a trivial insight from yesterday. Multi-term queries match ALL terms and score by match ratio.

### 🔄 Smart Dedup
Same discovery across sessions? Stores merge: keeps the longer description, takes the maximum importance, combines all tags. No duplicate entries for the same lesson.

### 🧹 Auto-Prune
Low-importance entries (≤2★) older than the TTL (default: 90 days) are automatically removed at session shutdown. Keeps the store lean without losing critical knowledge.

### 🔗 Session Tracking
Every memory is linked to its pi session via `PI_SESSION_ID`. `memory_stats` shows how many entries were stored in the current session.

### 🏷️ Tag System + Autocomplete
Organize memories with freeform tags. When storing without tags, the tool suggests existing tags from the store.

## Installation

```bash
# From local path (development)
pi install /path/to/pi-memory

# From GitHub
pi install git:github.com/tobias-weiss-ai-xr/pi-memory

# Reload to activate
/reload

# Verify
/memory stats
```

## Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `memory_search` | Search past learnings by query, category, or project. Results sorted by relevance. | `query`, `limit?`, `category?`, `project?` |
| `memory_store` | Store a new memory. Auto-deduplicates across sessions. Auto-suggests importance by category. | `topic`, `content`, `category`, `tags?`, `importance?` |
| `memory_stats` | Show memory statistics, distribution by category/project, and this-session count. | *(none)* |
| `memory_update` | Update an existing memory by ID (content, importance, tags). | `id`, `content?`, `importance?`, `tags?` |
| `memory_delete` | Delete a memory by ID. Irreversible. | `id` |

## Commands

| Command | Description |
|---------|-------------|
| `/memory stats` | Show memory status, total entries, recent items |
| `/memory search <query>` | Quick search from command line |
| `/memory export` | Export all memories to a JSON backup file |
| `/memory prune` | Force-prune old low-importance entries |

## Quick Start

```bash
# 1. Check current memory status
/memory stats

# 2. Store something you just learned
memory_store topic="UFW blocks Docker port 9090" \
  category=warning \
  content="Prometheus in Docker can't reach host services via VPN IP if UFW blocks the port. Use 127.0.0.1 instead." \
  tags="docker,ufw,networking" \
  importance=4

# 3. Search before starting a task
memory_search query="docker port mapping"

# 4. Find and update a memory
memory_search query="UFW" category=warning
memory_update id="mem_xxx_yyy" content="Updated details..." importance=5
```

## Memory Categories

| Category | Icon | When to Use | Auto-Importance |
|----------|------|-------------|-----------------|
| `warning` | ⚠️ | Pitfall to avoid | 4★ |
| `decision` | 🏛️ | Architectural choice + rationale | 4★ |
| `insight` | 💡 | Non-obvious truth discovered | 3★ |
| `pattern` | 🔄 | Reusable approach that worked | 3★ |
| `todo` | 📋 | Future task | 2★ |
| `session` | 📝 | Session bookmark (auto-stored) | 1★ |

When you omit `importance`, the tool picks the suggested value above.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_MEMORY_TTL_DAYS` | `90` | Auto-prune threshold for low-importance entries (min 7) |
| `PI_MEMORY_MAX_CONTEXT` | `8` | Max memories injected into session context (1-20) |
| `PI_MEMORY_STORE_DIR` | `~/.pi/agent/memory` | Override storage path (for testing) |
| `PI_SESSION_ID` | *(auto)* | Injected by pi, links memories to current session |

## Storage

All data is stored locally in `~/.pi/agent/memory/experiences.json`.

```
~/.pi/agent/memory/
├── experiences.json          # All memories (JSON array)
└── prompts/
    └── <project>.md          # Generated context prompt for each project
```

No external services, no telemetry, no cloud sync. Export with `/memory export` for backups.

## Integration with Graphiti

| System | Purpose | Best For |
|--------|---------|----------|
| **Pi Memory** | Experiential knowledge | Coding patterns, gotchas, decisions |
| **[Graphiti](https://github.com/tobias-weiss-ai-xr/ansible)** | Structured entity graph | Hosts, services, cross-agent facts |

Use both: `memory_search` for experiential knowledge, `graphiti_search` for structured data.

## Testing

```bash
# Install test dependencies
npm install

# Run the 22 unit tests
npx tsx src/tests.ts
```

Tests cover: `suggestedImportance`, `formatMemory`, TTL config, max context config, export/import, and store operations.

## Development

```bash
# TypeScript check
npx tsc --noEmit

# Install local changes
pi install .

# Reload in pi
/reload
```

## License

MIT
