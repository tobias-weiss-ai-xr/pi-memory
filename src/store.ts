/**
 * pi-memory: JSON-file based experiential memory store.
 *
 * Stores experiences as structured records in ~/.pi/agent/memory/
 * Categories: insight, pattern, decision, warning, todo
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

function ensureDir(): void {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true, mode: 0o755 });
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

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Store a new memory entry.
 */
export function storeMemory(entry: Omit<MemoryEntry, "id" | "timestamp" | "project"> & { project?: string; cwd?: string }): MemoryEntry {
  const store = load();
  const newEntry: MemoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    project: entry.project || detectProject(entry.cwd),
    ...entry,
  };
  store.entries.push(newEntry);
  save(store);
  return newEntry;
}

/**
 * Search memories by text query (matches topic, content, tags).
 */
export function searchMemories(query: string, limit = 20): MemoryEntry[] {
  const store = load();
  const q = query.toLowerCase();
  return store.entries
    .filter(e =>
      e.topic.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q)) ||
      e.project.toLowerCase().includes(q)
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

/**
 * Get memories relevant to a project.
 */
export function getMemoriesByProject(project: string, limit = 10): MemoryEntry[] {
  const store = load();
  return store.entries
    .filter(e => e.project === project)
    .sort((a, b) => b.importance - a.importance || new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
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
 * Get the storage file path (for diagnostics).
 */
export function getStorePath(): string {
  return STORE_FILE;
}
