/**
 * pi-memory: JSON-file based experiential memory store.
 *
 * Stores experiences as structured records in ~/.pi/agent/memory/
 * Categories: insight, pattern, decision, warning, todo
 *
 * v2 improvements:
 *  - Importance-boosted relevance scoring for search
 *  - Session ID capture from PI_SESSION_ID env
 *  - Export/import for backup
 *  - Update/delete by ID
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MemoryCategory = "insight" | "pattern" | "decision" | "warning" | "todo" | "session";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  timestamp: string;           // ISO 8601
  project: string;             // repo name or cwd basename
  topic: string;               // short label
  content: string;             // the actual memory
  tags: string[];              // freeform tags for search
  sessionId?: string;          // pi session ID if available
  filePaths?: string[];        // related source files
  importance: number;          // 1-5, 5 = most important
}

export interface MemoryStore {
  entries: MemoryEntry[];
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const BASE_DIR = path.join(os.homedir(), ".pi", "agent", "memory");
const STORE_FILE = path.join(BASE_DIR, "experiences.json");
const PROMPT_DIR = path.join(BASE_DIR, "prompts");

function ensureDir(dir: string = BASE_DIR): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

function load(): MemoryStore {
  ensureDir();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    return { entries: [] };
  }
}

function save(store: MemoryStore): void {
  ensureDir();
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = Date.now();

function generateId(): string {
  return `mem_${(idCounter++).toString(36)}_${Date.now().toString(36)}`;
}

function detectProject(cwd?: string): string {
  if (!cwd) return "unknown";
  // Try to find git remote, fall back to dirname
  try {
    const gitConfig = path.join(cwd, ".git", "config");
    if (fs.existsSync(gitConfig)) {
      const content = fs.readFileSync(gitConfig, "utf-8");
      const match = content.match(/url\s*=\s*.*[\/:]([^\/]+)\.git/);
      if (match) return match[1];
    }
  } catch { /* ignore */ }
  return path.basename(cwd);
}

/**
 * Relevance score for a memory entry: combines importance (0-5) with recency.
 * Score range: 0-1 where 1 = most relevant.
 * importance contributes 60%, recency contributes 40%.
 */
function relevanceScore(entry: MemoryEntry): number {
  const importanceWeight = 0.6;
  const recencyWeight = 0.4;

  // Normalize importance to 0-1
  const impScore = entry.importance / 5;

  // Recency: exponential decay over 180 days
  const ageMs = Date.now() - new Date(entry.timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.exp(-ageDays / 90); // half-life ~62 days

  return (impScore * importanceWeight) + (recencyScore * recencyWeight);
}

/**
 * Get current pi session ID from environment if available.
 */
function getSessionId(): string | undefined {
  return process.env.PI_SESSION_ID || undefined;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Result from storeMemory: the stored/updated entry and whether it was an update.
 */
export interface StoreResult {
  entry: MemoryEntry;
  updated: boolean;
}

/**
 * Store a new memory entry. Auto-populates sessionId if PI_SESSION_ID is set.
 * Deduplicates: if an entry with the same topic + project + category exists,
 * updates it instead of creating a duplicate.
 */
export function storeMemory(entry: Omit<MemoryEntry, "id" | "timestamp" | "project"> & { project?: string; cwd?: string }): StoreResult {
  const store = load();
  const sessionId = getSessionId();

  // Check for duplicate by topic + project + category
  const project = entry.project || detectProject(entry.cwd);
  const existing = store.entries.findIndex(e =>
    e.topic === entry.topic &&
    e.project === project &&
    e.category === entry.category &&
    e.sessionId !== sessionId // only dedup across different sessions
  );

  const now = new Date().toISOString();

  if (existing !== -1) {
    // Merge content, update timestamp, boost importance
    const old = store.entries[existing];
    store.entries[existing] = {
      ...old,
      timestamp: now,
      sessionId: sessionId || old.sessionId,
      content: old.content.length < (entry.content?.length || 0)
        ? entry.content! : old.content,
      importance: Math.max(old.importance, entry.importance || 3),
      tags: [...new Set([...old.tags, ...(entry.tags || [])])],
    };
    save(store);
    return { entry: store.entries[existing], updated: true };
  }

  const newEntry: MemoryEntry = {
    id: generateId(),
    timestamp: now,
    project,
    sessionId,
    ...entry,
    tags: entry.tags || [],
  };
  store.entries.push(newEntry);
  save(store);
  return { entry: newEntry, updated: false };
}

/**
 * Search memories by text query, sorted by relevance score
 * (importance × recency). Matches topic, content, tags, and project.
 */
export function searchMemories(query: string, limit = 20): MemoryEntry[] {
  const store = load();
  const q = query.toLowerCase().trim();

  // Empty query returns all, sorted by relevance
  if (!q) {
    return store.entries
      .map(e => ({ entry: e, score: relevanceScore(e) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.entry);
  }

  const terms = q.split(/\s+/).filter(Boolean);

  return store.entries
    .map(e => {
      const text = `${e.topic} ${e.content} ${e.tags.join(" ")} ${e.project}`.toLowerCase();
      // Count how many search terms match
      const matchCount = terms.filter(t => text.includes(t)).length;
      if (matchCount === 0) return null; // no match
      const matchRatio = matchCount / terms.length;
      return { entry: e, score: relevanceScore(e) * (0.5 + 0.5 * matchRatio) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.entry);
}

/**
 * Get high-value context memories for a project: top project-specific memories
 * plus cross-project warnings/decisions with high importance.
 * Deduplicates by topic and ensures category diversity.
 */
export function getContextMemories(project: string, limit = 8): MemoryEntry[] {
  const store = load();
  const seenTopics = new Set<string>();

  // Project memories: all high-importance (>=3) + recent medium-importance (>=2)
  const projectMemories = store.entries
    .filter(e =>
      e.project === project &&
      e.importance >= 2 &&
      !seenTopics.has(e.topic)
    )
    .sort((a, b) => relevanceScore(b) - relevanceScore(a));

  // Add cross-project warnings and decisions with importance >= 4
  const crossProject = store.entries
    .filter(e =>
      e.project !== project &&
      e.importance >= 4 &&
      (e.category === "warning" || e.category === "decision") &&
      !seenTopics.has(e.topic)
    )
    .sort((a, b) => relevanceScore(b) - relevanceScore(a));

  // Interleave: take top project memories, then fill gaps with cross-project
  const result: MemoryEntry[] = [];
  const projectLimit = Math.ceil(limit * 0.65);
  const crossLimit = limit - projectLimit;

  for (const m of projectMemories) {
    if (result.length >= projectLimit) break;
    seenTopics.add(m.topic);
    result.push(m);
  }

  // Ensure category diversity: prefer underrepresented categories
  const categoryCount = new Map<string, number>();
  for (const m of result) {
    categoryCount.set(m.category, (categoryCount.get(m.category) || 0) + 1);
  }

  for (const m of crossProject) {
    if (result.length >= limit) break;
    if (seenTopics.has(m.topic)) continue;
    const catCount = categoryCount.get(m.category) || 0;
    // Prefer warnings and decisions that are underrepresented in project memories
    if (catCount >= 2) continue; // already have 2 of this category
    seenTopics.add(m.topic);
    categoryCount.set(m.category, catCount + 1);
    result.push(m);
  }

  // If we still have slots, fill with remaining high-scoring memories
  if (result.length < limit) {
    const allCandidates = [...projectMemories, ...crossProject];
    for (const m of allCandidates) {
      if (result.length >= limit) break;
      if (seenTopics.has(m.topic)) continue;
      seenTopics.add(m.topic);
      result.push(m);
    }
  }

  return result;
}

/**
 * Get memories relevant to a project (sorted by relevance).
 */
export function getMemoriesByProject(project: string, limit = 10): MemoryEntry[] {
  const store = load();
  return store.entries
    .filter(e => e.project === project)
    .map(e => ({ entry: e, score: relevanceScore(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.entry);
}

/**
 * Get recent memories across all projects.
 */
export function getRecentMemories(limit = 10): MemoryEntry[] {
  const store = load();
  return store.entries
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get memories by category.
 */
export function getMemoriesByCategory(category: MemoryCategory, limit = 20): MemoryEntry[] {
  const store = load();
  return store.entries
    .filter(e => e.category === category)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get summary stats about stored memories.
 */
/**
 * Get all unique tags across all entries (for autocomplete).
 */
export function getAllTags(): string[] {
  const store = load();
  const tags = new Set<string>();
  for (const e of store.entries) {
    for (const t of e.tags) {
      tags.add(t);
    }
  }
  return [...tags].sort();
}

/**
 * Get suggested importance for a category.
 */
export function suggestedImportance(category: MemoryCategory): number {
  switch (category) {
    case "warning": return 4;
    case "decision": return 4;
    case "insight": return 3;
    case "pattern": return 3;
    case "todo": return 2;
    case "session": return 1;
    default: return 3;
  }
}

/**
 * Format a memory entry for display (adds relevance score when available).
 */
export function formatMemory(m: MemoryEntry, score?: number): string {
  const date = m.timestamp.slice(0, 10);
  const tagStr = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
  const stars = "★".repeat(m.importance) + "☆".repeat(5 - m.importance);
  const scoreStr = score !== undefined ? ` (${(score * 100).toFixed(0)}%)` : "";
  return `[${date}] [${m.category}] ${stars}${scoreStr} ${m.project}: ${m.topic}${tagStr}\n  ${m.content.slice(0, 300)}`;
}

/**
 * Get summary stats about stored memories.
 */
export function getStats(): { total: number; byCategory: Record<string, number>; byProject: Record<string, number>; topTags: string[] } {
  const store = load();
  const byCategory: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const tagCount: Record<string, number> = {};

  for (const e of store.entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    byProject[e.project] = (byProject[e.project] || 0) + 1;
    for (const t of e.tags) {
      tagCount[t] = (tagCount[t] || 0) + 1;
    }
  }

  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag]) => tag);

  return {
    total: store.entries.length,
    byCategory,
    byProject,
    topTags,
  };
}

/**
 * Delete a memory entry by ID.
 */
export function deleteMemory(id: string): boolean {
  const store = load();
  const idx = store.entries.findIndex(e => e.id === id);
  if (idx === -1) return false;
  store.entries.splice(idx, 1);
  save(store);
  return true;
}

/**
 * Update an existing memory entry (partial update by ID).
 */
export function updateMemory(id: string, updates: Partial<Omit<MemoryEntry, "id" | "timestamp" | "project">>): MemoryEntry | null {
  const store = load();
  const idx = store.entries.findIndex(e => e.id === id);
  if (idx === -1) return null;
  store.entries[idx] = {
    ...store.entries[idx],
    ...updates,
    timestamp: new Date().toISOString(),
    tags: updates.tags || store.entries[idx].tags,
  };
  save(store);
  return store.entries[idx];
}

/**
 * Export all memories as JSON (for backup).
 */
export function exportMemories(): string {
  const store = load();
  return JSON.stringify(store, null, 2);
}

/**
 * Import memories from JSON string (merges, no dupe overwrite).
 */
export function importMemories(json: string, merge = true): number {
  const imported = JSON.parse(json) as MemoryStore;
  if (!imported.entries || !Array.isArray(imported.entries)) {
    throw new Error("Invalid memory format");
  }
  const store = load();
  const existing = store.entries.length;
  const existingIds = new Set(store.entries.map(e => e.id));

  if (merge) {
    // Only add entries whose IDs don't already exist
    for (const e of imported.entries) {
      if (!existingIds.has(e.id)) {
        store.entries.push(e);
        existingIds.add(e.id);
      }
    }
  } else {
    // Replace entire store
    store.entries = imported.entries;
  }

  save(store);
  return store.entries.length - existing;
}

/**
 * Get TTL (in days) from environment variable PI_MEMORY_TTL_DAYS, default 90.
 */
export function getTTLDays(): number {
  const env = process.env.PI_MEMORY_TTL_DAYS;
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n >= 7) return n;
  }
  return 90;
}

/**
 * Get max context memories from env var PI_MEMORY_MAX_CONTEXT, default 8.
 */
export function getMaxContextMemories(): number {
  const env = process.env.PI_MEMORY_MAX_CONTEXT;
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n >= 1 && n <= 20) return n;
  }
  return 8;
}

/**
 * Prune old low-importance memories (auto-maintenance).
 * Removes entries with importance <= 2 that are older than TTL.
 * TTL defaults to 90 days, configurable via PI_MEMORY_TTL_DAYS env var.
 */
export function pruneOldMemories(maxAgeDays?: number, minImportance = 3): number {
  const days = maxAgeDays ?? getTTLDays();
  const store = load();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const before = store.entries.length;
  store.entries = store.entries.filter(e =>
    e.importance >= minImportance ||
    new Date(e.timestamp).getTime() > cutoff
  );
  save(store);
  return before - store.entries.length;
}

/**
 * Write context memories to a prompt file that pi's resource system can load.
 * Returns the path to the generated prompt file, or null if no memories.
 *
 * The prompt is formatted for easy parsing by the model: grouped by category
 * with clear headers, importance badges, and relevance scores.
 */
export function writeContextPrompt(project: string): string | null {
  const limit = getMaxContextMemories();
  const memories = getContextMemories(project, limit);
  if (memories.length === 0) return null;

  ensureDir(PROMPT_DIR);

  const lines: string[] = [
    "---",
    "description: Past session memories relevant to this project, auto-loaded by pi-memory.",
    "---",
    "",
    `# 🧠 Prior Knowledge: ${project}`,
    "",
    "These memories from past sessions are relevant to the current project.",
    "They are sorted by relevance (importance × recency).",
    "Pay special attention to ⚠️ Warnings and ⭐ high-importance entries.",
    "",
  ];

  // Group by category for better readability
  const grouped: Record<string, MemoryEntry[]> = {};
  for (const m of memories) {
    const cat = m.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }

  // Category display order: warnings first, then decisions, insights, patterns, rest
  const catOrder = ["warning", "decision", "insight", "pattern", "todo", "session"];
  const catIcons: Record<string, string> = {
    warning: "⚠️",
    decision: "🏛️",
    insight: "💡",
    pattern: "🔄",
    todo: "📋",
    session: "📝",
  };
  const catLabels: Record<string, string> = {
    warning: "Warnings",
    decision: "Decisions",
    insight: "Insights",
    pattern: "Patterns",
    todo: "Todos",
    session: "Sessions",
  };

  for (const cat of catOrder) {
    const entries = grouped[cat];
    if (!entries) continue;

    lines.push(`### ${catIcons[cat] || "•"} ${catLabels[cat] || cat}`);
    lines.push("");

    for (const m of entries) {
      const score = relevanceScore(m);
      const stars = "★".repeat(m.importance) + "☆".repeat(5 - m.importance);
      const tagStr = m.tags.length ? ` \`${m.tags.join("` `")}\`` : "";
      const date = m.timestamp.slice(0, 10);

      lines.push(`**${m.topic}** — ${stars} (${(score * 100).toFixed(0)}%) — ${date}`);
      lines.push(`> ${m.content.replace(/\n/g, "\n> ")}`);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
  }

  lines.push(
    "> _End of pi-memory context. Use \`memory_search\` to find more specific or older memories._",
  );

  const filePath = path.join(PROMPT_DIR, `${project}.md`);
  fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

/**
 * Get the storage file path (for diagnostics).
 */
export function getStorePath(): string {
  return STORE_FILE;
}

/**
 * Get the prompt directory path.
 */
export function getPromptDir(): string {
  return PROMPT_DIR;
}
