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

// Allow override via PI_MEMORY_STORE_DIR for testing
const BASE_DIR = process.env.PI_MEMORY_STORE_DIR || path.join(os.homedir(), ".pi", "agent", "memory");
const STORE_FILE = path.join(BASE_DIR, "experiences.json");
const PROMPT_DIR = path.join(BASE_DIR, "prompts");

function ensureDir(dir: string = BASE_DIR): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

// ─── In-memory cache + deferred writes ───────────────────────────────────────

let cachedStore: MemoryStore | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
let isDirty = false;

/**
 * Load the store from disk (once, then cached in memory).
 * Subsequent calls return the cached version instantly.
 */
function load(): MemoryStore {
  if (cachedStore) return cachedStore;
  ensureDir();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    cachedStore = JSON.parse(raw) as MemoryStore;
    return cachedStore;
  } catch {
    cachedStore = { entries: [] };
    return cachedStore;
  }
}

/**
 * Mark the in-memory store as dirty and schedule a deferred write.
 * Multiple writes within the same tick are batched into one disk write.
 */
function markDirty(store: MemoryStore): void {
  cachedStore = store;
  isDirty = true;
  if (saveTimeout === null) {
    // Use queueMicrotask to batch writes within the same event loop tick
    saveTimeout = setTimeout(() => {
      flush();
    }, 100); // 100ms debounce — fast stores batch together
  }
}

/**
 * Force-flush pending writes to disk immediately.
 */
export function flush(): void {
  if (saveTimeout !== null) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (isDirty && cachedStore) {
    ensureDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(cachedStore, null, 2), "utf-8");
    isDirty = false;
  }
}

/**
 * Invalidate the in-memory cache so the next load() re-reads from disk.
 */
export function invalidateCache(): void {
  cachedStore = null;
  isDirty = false;
}

/**
 * Save the store to disk immediately (synchronous, no cache).
 */
function saveSync(store: MemoryStore): void {
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
export function relevanceScore(entry: MemoryEntry): number {
  const importanceWeight = 0.6;
  const recencyWeight = 0.4;

  // Use decayed importance (old entries lose importance over time)
  const decayedImp = applyImportanceDecay(entry);
  const impScore = decayedImp / 5;

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
  /** Similar existing memories (to prevent accidental duplicates) */
  similar?: MemoryEntry[];
}

/**
 * Find memories with similar topic or content (for dedup hints).
 * Returns up to `limit` entries with the highest text similarity.
 * Excludes exact topic matches (those are handled by dedup logic).
 */
export function findSimilar(topic: string, content: string, limit = 3): MemoryEntry[] {
  const store = load();
  const topicLower = topic.toLowerCase();
  const contentWords = content.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  return store.entries
    .map(e => {
      const eTopic = e.topic.toLowerCase();
      const eContent = e.content.toLowerCase();

      // Exact topic matches are handled by dedup — skip them here
      if (eTopic === topicLower) return { entry: e, score: -1 };

      // Score: topic word overlap + content word overlap
      let score = 0;

      // Topic similarity: word overlap in topics
      const topicWords = topicLower.split(/\s+/);
      const eTopicWords = eTopic.split(/\s+/);
      for (const w of topicWords) {
        if (eTopicWords.includes(w)) score += 0.3;
      }

      // Content similarity: shared significant words
      const eContentWords = new Set(eContent.split(/\s+/).filter(w => w.length > 3));
      let matches = 0;
      for (const w of contentWords) {
        if (eContentWords.has(w)) matches++;
      }
      if (contentWords.length > 0) {
        score += (matches / contentWords.length) * 0.7;
      }

      return { entry: e, score };
    })
    .filter(x => x.score > 0.15) // meaningful similarity threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.entry);
}

/**
 * Store a new memory entry. Auto-populates sessionId if PI_SESSION_ID is set.
 * Deduplicates: if an entry with the same topic + project + category exists,
 * updates it instead of creating a duplicate.
 * Returns similar existing entries so the caller can warn about potential dupes.
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
    markDirty(store);
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
  markDirty(store);

  // Find similar entries for dedup hints (skip if it was an exact duplicate)
  const similar = findSimilar(entry.topic, entry.content || "", 3);

  return { entry: newEntry, updated: false, similar: similar.length > 0 ? similar : undefined };
}

/**
 * Search memories by text query, sorted by relevance score
 * (importance × recency × match quality).
 *
 * Matching strategy (fuzzy-tolerant):
 *  - Tokenizes query into words
 *  - Matches if ANY query word appears as a word boundary in topic/content/tags/project
 *  - Prefix matching: "net" matches "network", "networking"
 *  - Topic matches weighted higher than content matches
 *  - Multi-word queries: entries matching MORE terms rank higher
 *
 * @param query - Search string. Empty returns all entries sorted by relevance.
 * @param limit - Max results (default 20)
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

  // Tokenize query into words, strip special chars for matching
  const terms = q.split(/[\s,;:.!?()]+/).filter(t => t.length > 0);

  return store.entries
    .map(e => {
      const result = matchEntry(e, terms);
      if (!result) return null;
      const score = relevanceScore(e) * (0.4 + 0.6 * result.matchRatio);
      return { entry: e, score };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.entry);
}

/**
 * Detailed match result for a single entry against query terms.
 */
interface MatchResult {
  matchedTerms: number;
  totalTerms: number;
  matchRatio: number;     // matchedTerms / totalTerms
  topicMatches: number;
  contentMatches: number;
  tagMatches: number;
}

/**
 * Match an entry against query terms using fuzzy word-boundary matching.
 * Returns null if no terms match, or a MatchResult with details.
 */
function matchEntry(entry: MemoryEntry, terms: string[]): MatchResult | null {
  const topicLower = entry.topic.toLowerCase();
  const contentLower = entry.content.toLowerCase();
  const tagsLower = entry.tags.map(t => t.toLowerCase());
  const projectLower = entry.project.toLowerCase();

  // Build searchable text: topic counts triple, content once, tags once, project once
  const searchText = `${topicLower} ${topicLower} ${topicLower} ${contentLower} ${tagsLower.join(" ")} ${projectLower}`;

  let matchedTerms = 0;
  let topicMatches = 0;
  let contentMatches = 0;
  let tagMatches = 0;

  for (const term of terms) {
    if (term.length === 0) continue;

    // Prefix match: check if term appears as word boundary in any field
    // This handles "net" → "network", "docker" → "docker", etc.
    const topicHit = wordMatch(topicLower, term);
    const contentHit = wordMatch(contentLower, term);
    const tagHit = tagsLower.some(t => wordMatch(t, term));
    const projectHit = wordMatch(projectLower, term);

    if (topicHit || contentHit || tagHit || projectHit) {
      matchedTerms++;
      if (topicHit) topicMatches++;
      if (contentHit) contentMatches++;
      if (tagHit) tagMatches++;
    }
  }

  if (matchedTerms === 0) return null;

  return {
    matchedTerms,
    totalTerms: terms.length,
    matchRatio: matchedTerms / terms.length,
    topicMatches,
    contentMatches,
    tagMatches,
  };
}

/**
 * Check if a term matches text at a word boundary with prefix support.
 * "net" matches "network" (prefix) and "net" (exact) but not "internet"
 * (not at word boundary). Detects boundaries between different scripts
 * (e.g., Latin→CJK boundary at "Pod网络").
 */
function wordMatch(text: string, term: string): boolean {
  if (term.length === 0) return false;
  if (text === term) return true;

  let idx = 0;
  while (idx < text.length) {
    idx = text.indexOf(term, idx);
    if (idx === -1) return false;

    // Check word/script boundary BEFORE the match
    // Boundary exists at: start of string, after non-word char, or between different scripts
    if (idx > 0) {
      const beforeChar = text[idx - 1];
      const firstTermChar = text[idx];
      if (!isWordChar(beforeChar)) {
        // OK: boundary due to non-word char
      } else if (!sameScript(beforeChar, firstTermChar)) {
        // OK: boundary due to script change (e.g., "d"→"网" at "Pod网络")
      } else {
        // NOT a boundary: same script word char before the match
        idx = idx + 1;
        continue;
      }
    }

    // Prefix match: term can be shorter than the word it matches
    // "net" at start of "networking" → match (prefix)
    // "net" as exact word "net" → match (exact word)
    return true;
  }
  return false;
}

/**
 * Categorize a character: "latin" (ASCII letter), "digit", "cjk" (CJK ideograph),
 * "unicode" (other non-ASCII), or "other" (whitespace, punctuation).
 * Used for word boundary detection across different scripts.
 */
type CharType = "latin" | "digit" | "cjk" | "unicode" | "other";

function charType(ch: string): CharType {
  if (ch.length === 0) return "other";
  const code = ch.codePointAt(0)!;
  // Digits
  if (code >= 0x30 && code <= 0x39) return "digit";
  // ASCII letters
  if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A) || code === 0x5F) return "latin";
  // CJK Unified Ideographs + Extension A + B + Compatibility
  if ((code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x20000 && code <= 0x2A6DF) ||
      (code >= 0xF900 && code <= 0xFAFF)) return "cjk";
  // Other non-ASCII (non-CJK unicode letters)
  if (code > 0x7F &&
      (code < 0x0300 || code > 0x036F) && // skip combining diacritics
      code !== 0x200B && // zero-width space
      code !== 0x200C && code !== 0x200D) return "unicode"; // ZWNJ, ZWJ
  return "other";
}

/**
 * Check if two characters belong to the same "script" for word boundary purposes.
 * Different scripts (Latin, CJK, digits) create boundaries between them.
 */
function sameScript(a: string, b: string): boolean {
  return charType(a) === charType(b);
}

/**
 * Check if a character is a "word character" (any letter or digit in any script).
 */
function isWordChar(ch: string): boolean {
  return charType(ch) !== "other";
}

/**
 * Escape special characters in a string for use in a RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Search with explanation: returns entries with detailed match info.
 * Useful for debugging search quality.
 */
export function searchExplain(query: string, limit = 5): Array<{ entry: MemoryEntry; match: MatchResult | null; score: number }> {
  const store = load();
  const q = query.toLowerCase().trim();
  const terms = q ? q.split(/[\s,;:.!?()]+/).filter(t => t.length > 0) : [];

  return store.entries
    .map(e => {
      const match = terms.length > 0 ? matchEntry(e, terms) : { matchedTerms: 0, totalTerms: 0, matchRatio: 1, topicMatches: 0, contentMatches: 0, tagMatches: 0 };
      // Non-matching entries get a 60% penalty vs matching entries
      const matchMultiplier = match ? (0.4 + 0.6 * match.matchRatio) : 0.4;
      const score = relevanceScore(e) * matchMultiplier;
      return { entry: e, match, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
 * Apply time-based importance decay. Reduces importance of very old entries
 * so they don't permanently dominate search results.
 * Decay schedule: importance drops by 1 after 180 days, by 2 after 365 days.
 * Minimum importance after decay is 1.
 */
export function applyImportanceDecay(entry: MemoryEntry): number {
  const ageMs = Date.now() - new Date(entry.timestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  let decay = 0;
  if (ageDays > 365) decay = 2;
  else if (ageDays > 180) decay = 1;

  return Math.max(1, entry.importance - decay);
}

/**
 * Format search results with highlighted matching terms.
 * Wraps matched words in **bold** markers using word-boundary matching.
 * Uses wordMatch logic for boundary detection (unicode-safe, no regex \b).
 */
export function highlightMatches(text: string, query: string): string {
  if (!query || !query.trim()) return text;
  const terms = query.toLowerCase().split(/[\s,;:.!?()]+/).filter(t => t.length > 0);
  if (terms.length === 0) return text;

  const lower = text.toLowerCase();
  const result: string[] = [];
  let pos = 0;

  while (pos < lower.length) {
    // Find the earliest word match at current position
    let bestIdx = -1;
    let bestTerm = "";

    for (const term of terms) {
      const idx = lower.indexOf(term, pos);
      if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
        // Verify word/script START boundary (prefix matching allowed)
        if (idx > 0) {
          const beforeChar = lower[idx - 1];
          const firstMatchChar = lower[idx];
          if (isWordChar(beforeChar) && sameScript(beforeChar, firstMatchChar)) {
            continue; // no boundary — same script continues
          }
        }
        bestIdx = idx;
        bestTerm = term;
      }
    }

    if (bestIdx === -1) {
      // No more matches
      result.push(text.slice(pos));
      break;
    }

    // Add text before match + highlighted match
    result.push(text.slice(pos, bestIdx));
    result.push("**");
    result.push(text.slice(bestIdx, bestIdx + bestTerm.length));
    result.push("**");
    pos = bestIdx + bestTerm.length;
  }

  return result.join("");
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
  markDirty(store);
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
  markDirty(store);
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

  markDirty(store);
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
  markDirty(store);
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
