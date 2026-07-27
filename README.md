# 🧠 Pi Memory
> **⚠️ Migrated from Codeberg → GitHub**: This repository has moved permanently to [GitHub](https://github.com/tobias-weiss-ai-xr/pi-memory). The Codeberg mirror is deprecated.


**Experiential memory for [pi](https://pi.dev).**

Pi Memory learns from past coding sessions — capturing insights, decisions, patterns, and warnings — and surfaces them in future sessions so you never repeat mistakes or forget hard-won knowledge.

## Features

- **Session-aware**: Auto-loads memories relevant to your current project at session start
- **Auto-bookmark**: Lightweight session bookmark stored at session end
- **5 memory categories**: `insight`, `pattern`, `decision`, `warning`, `todo`
- **Searchable**: Full-text search across topic, content, tags, and project
- **Tag system**: Organize memories with freeform tags
- **Importance scoring**: Prioritize critical learnings (1-5 scale)
- **Status command**: `/memory stats` to see memory dashboard
- **Cross-agent compatible**: Designed to work alongside Graphiti (structured facts → Graphiti, experiential knowledge → Pi Memory)

## Installation

```bash
# From local path
pi install /path/to/pi-memory

# From GitHub (once published)
pi install git:github.com/tobias-weiss-ai-xr/pi-memory

# Reload to activate
/reload
```

## Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Search past learnings by query, category, or project |
| `memory_store` | Store a new experiential memory |
| `memory_stats` | Show memory statistics and distribution |

## Commands

| Command | Description |
|---------|-------------|
| `/memory stats` | Show memory status, total entries, recent items |
| `/memory search <query>` | Quick search from command line |

## Quick Start

```bash
# Check current memory status
/memory stats

# Store something you just learned
memory_store topic="..." category=insight content="..." tags="tag1,tag2" importance=3

# Search before starting a task
memory_search query="docker port mapping"
```

## How It Works

```
Session Start                Session End
    │                            │
    ▼                            ▼
┌──────────┐               ┌──────────┐
│ Load      │               │ Store    │
│ memories  │    ┌─────────►│ bookmark │
│ for this  │    │          │ (auto)   │
│ project   │    │          └──────────┘
└────┬─────┘    │               │
     │          │               ▼
     │    ┌─────┴──────┐  ┌──────────┐
     │    │ During     │  │ Manual   │
     └───►│ Session    │──► store    │
          │ agent can  │  │ via tool │
          │ search/    │  └──────────┘
          │ store via  │
          │ tools      │
          └────────────┘
```

## Storage

All data is stored locally in `~/.pi/agent/memory/experiences.json`. No external services, no telemetry, no cloud sync.

## Memory Categories

| Category | When to Use | Importance Hint |
|----------|-------------|-----------------|
| `insight` | Non-obvious truth discovered | 3-4 |
| `pattern` | Reusable approach that worked | 3-4 |
| `decision` | Architectural choice + rationale | 4-5 |
| `warning` | Pitfall to avoid | 4-5 |
| `todo` | Future task | 1-2 |

## License

MIT
