/**
 * pi-memory: Experiential memory extension for pi.
 *
 * Hooks into session lifecycle to:
 *  - Inject relevant past memories into context at session start
 *  - Auto-store a structured session bookmark at shutdown
 *  - Provide memory_search, memory_store, memory_stats tools
 *  - Provide memory_update, memory_delete, memory_export, memory_prune
 *  - Populate session ID from PI_SESSION_ID env var
 *
 * Install:  pi install /path/to/pi-memory
 * Reload:   /reload
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  storeMemory,
  searchMemories,
  getMemoriesByProject,
  getRecentMemories,
  getStats,
  getStorePath,
  getPromptDir,
  deleteMemory,
  updateMemory,
  exportMemories,
  importMemories,
  pruneOldMemories,
  writeContextPrompt,
  formatMemory,
  getAllTags,
  suggestedImportance,
  getTTLDays,
  relevanceScore,
  flush,
  detectProject,
  type MemoryCategory,
} from "../src/store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function textResult(text: string): AgentToolResult<any> {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // Periodic flush timer: ensures pending writes don't get lost if pi crashes
  const flushInterval = setInterval(() => { flush(); }, 5000);

  // ── Session start: write prompt file (loaded by resources_discover) ──────
  // resources_discover fires after session_start, so the prompt file is written
  // first, then automatically loaded into the model's context on the same session.
  // This ensures the model sees relevant memories without having to call a tool.

  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const project = detectProject(cwd);
    const stats = getStats();
    if (stats.total === 0) return;

    // Write context prompt file (loaded via resources_discover)
    const promptFile = writeContextPrompt(project);
    const projectMemories = getMemoriesByProject(project, 5);

    if (ctx.hasUI) {
      const short = projectMemories.length > 0
        ? `\u{1F9E0} ${projectMemories.length} memories for ${project} (${stats.total} total across ${Object.keys(stats.byProject).length} projects)`
        : `\u{1F9E0} ${stats.total} memories across ${Object.keys(stats.byProject).length} projects`;
      ctx.ui.setStatus("pi-memory", short);

      if (promptFile) {
        ctx.ui.notify(`\u{1F9E0} ${projectMemories.length} relevant memories loaded into context`, "info");
      }
    }
  });

  // ── Resources discover: serve prompt file to model's context ─────────────
  // Fires after session_start. Returns the prompt file path that was just written
  // by session_start, which gets loaded into the model's system prompt.

  pi.on("resources_discover", (_event, ctx) => {
    const project = detectProject(ctx.cwd);
    const promptPath = path.join(getPromptDir(), `${project}.md`);
    if (fs.existsSync(promptPath)) {
      return { promptPaths: [promptPath] };
    }
    return {};
  });

  // ── Session end: auto-store enriched bookmark ────────────────────────────

  function getGitBranch(cwd: string): string {
    try {
      const { execSync } = require("node:child_process");
      return execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { cwd, encoding: "utf-8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch { return ""; }
  }

  pi.on("session_shutdown", async (_event, ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const project = detectProject(cwd);
    const now = new Date().toISOString().slice(0, 10);
    const branch = getGitBranch(cwd);
    const branchTag = branch ? `, branch=${branch}` : "";

    // Store an enriched session bookmark with git context
    storeMemory({
      category: "session",
      topic: `Session in ${project} — ${now}${branch ? ` (${branch})` : ""}`,
      content: `Session completed in ${project} on ${now}.${branchTag}`
        + ` Key activities, decisions, and outcomes should be stored as separate entries using memory_store.`,
      tags: [project, "session", now, ...(branch ? [branch] : [])],
      importance: 2,
      cwd,
    });

    // Prune old low-importance entries (auto-maintenance, TTL from PI_MEMORY_TTL_DAYS)
    const ttlDays = getTTLDays();
    const pruned = pruneOldMemories(ttlDays, 3);
    if (pruned > 0 && ctx.hasUI) {
      ctx.ui.notify(`\u{1F9E0} Pruned ${pruned} old low-importance memories (TTL: ${ttlDays}d)`, "info");
    }

    // Flush pending writes to disk before session exits
    flush();
    clearInterval(flushInterval);
  });

  // ── Register: memory_search tool ───────────────────────────────────────────

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search pi-memory's experiential database for past learnings, decisions, patterns, and warnings. Use at session start to retrieve prior context.",
    promptSnippet: "memory_search: Retrieve prior experiential learnings from past sessions. Call at session start to load relevant context.",
    parameters: Type.Object({
      query: Type.String({ description: "Search keywords (matches topic, content, tags, project). Empty string returns all sorted by relevance." }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
      category: Type.Optional(Type.String({ description: "Filter by category: insight, pattern, decision, warning, todo" })),
      project: Type.Optional(Type.String({ description: "Filter by project name" })),
    }),
    async execute(
      _id: string,
      params: { query: string; limit?: number; category?: string; project?: string },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      let results = searchMemories(params.query, params.limit || 10);

      if (params.category) {
        results = results.filter(r => r.category === params.category);
      }
      if (params.project) {
        results = results.filter(r => r.project === params.project);
      }

      if (results.length === 0) {
        return textResult("No matching memories found.");
      }

      // Compute relevance scores for display
      const lines = results.map(m => {
        const score = relevanceScore(m);
        return formatMemory(m, score);
      });

      return textResult(`Found ${results.length} memory entr${results.length === 1 ? "y" : "ies"} (sorted by relevance):\n\n${lines.join("\n\n")}`);
    },
  });

  // ── Register: memory_store tool ────────────────────────────────────────────

  pi.registerTool({
    name: "memory_store",
    label: "Memory Store",
    description: "Store an experiential learning, decision, pattern, warning, or todo into pi-memory. Auto-deduplicates: if same topic+project+category exists, updates it. Use after completing a task, discovering a workaround, or making an architectural decision.",
    promptSnippet: "memory_store: Persist learnings, patterns, and decisions for future sessions. Auto-deduplicates.",
    parameters: Type.Object({
      topic: Type.String({ description: "Short title for this memory (e.g., 'UFW blocks Docker port 9090')" }),
      content: Type.String({ description: "Detailed description of what was learned, decided, or observed" }),
      category: Type.String({ description: "insight, pattern, decision, warning, or todo" }),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags for search (e.g., 'docker,ufw,networking')" })),
      importance: Type.Optional(Type.Number({ description: "Importance 1-5 (default 3). Use 4-5 for critical learnings." })),
    }),
    async execute(
      _id: string,
      params: { topic: string; content: string; category: string; tags?: string; importance?: number },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      const validCategories: MemoryCategory[] = ["insight", "pattern", "decision", "warning", "todo", "session"];
      const cat = params.category as MemoryCategory;
      if (!validCategories.includes(cat)) {
        const hint = getAllTags().filter(t => t.includes(params.category.toLowerCase())).slice(0, 5);
        const tagHint = hint.length ? `\nDid you mean tags: ${hint.join(", ")}?` : "";
        return textResult(`Invalid category. Choose: ${validCategories.join(", ")}.${tagHint}`);
      }

      // Auto-suggest importance if not provided
      const importance = params.importance !== undefined
        ? Math.min(5, Math.max(1, params.importance))
        : suggestedImportance(cat);

      // Suggest existing tags if none provided
      const tags = params.tags
        ? params.tags.split(",").map(t => t.trim()).filter(Boolean)
        : [];

      const { entry, updated, similar } = storeMemory({
        category: cat,
        topic: params.topic,
        content: params.content,
        tags,
        importance,
        cwd: ctx.cwd,
      });

      if (ctx.hasUI) {
        ctx.ui.notify(`\u{1F9E0} ${updated ? "Updated" : "Stored"}: ${params.topic}`, "info");
      }

      const tagTip = tags.length === 0 && getAllTags().length > 0
        ? `\nTip: Add tags to improve search. Existing: ${getAllTags().slice(0, 8).join(", ")}`
        : "";

      // Show similar existing memories (potential duplicates)
      const similarTip = similar && similar.length > 0
        ? `\n\nRelated existing memories:\n${similar.map(m => `  [${m.importance}★] ${m.topic} (${m.timestamp.slice(0, 10)})`).join("\n")}`
        : "";

      return textResult(`${updated ? "Updated" : "Stored"} as [${entry.category}] with id ${entry.id} in project ${entry.project}.${tagTip}${similarTip}`);
    },
  });

  // ── Register: memory_stats tool ────────────────────────────────────────────

  pi.registerTool({
    name: "memory_stats",
    label: "Memory Stats",
    description: "Show pi-memory statistics: total entries, breakdown by category, top projects, and tags. Use to check if memory is populated.",
    promptSnippet: "memory_stats: Show experiential memory statistics",
    parameters: Type.Object({}),
    async execute(
      _id: string,
      _params: object,
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      const stats = getStats();
      // Count entries from the current session
      const sessionCount = searchMemories("", 999)
        .filter(e => e.sessionId === process.env.PI_SESSION_ID).length;
      const lines: string[] = [
        `\u{1F9E0} Pi Memory Stats`,
        `Total entries: ${stats.total}`,
        `Storage: ${getStorePath()}`,
        `This session: ${sessionCount} entries stored`,
        ``,
        `By category:`,
      ];

      for (const [cat, count] of Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${cat}: ${count}`);
      }

      lines.push(``, `By project (top 10):`);
      for (const [proj, count] of Object.entries(stats.byProject).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
        lines.push(`  ${proj}: ${count}`);
      }

      if (stats.topTags.length > 0) {
        lines.push(``, `Top tags: ${stats.topTags.join(", ")}`);
      }

      return textResult(lines.join("\n"));
    },
  });

  // ── Register: memory_update tool ──────────────────────────────────────────

  pi.registerTool({
    name: "memory_update",
    label: "Memory Update",
    description: "Update an existing memory entry by ID. Use when you need to correct or supplement a previously stored memory.",
    promptSnippet: "memory_update: Update or supplement an existing memory entry",
    parameters: Type.Object({
      id: Type.String({ description: "ID of the memory to update (from memory_search results)" }),
      content: Type.Optional(Type.String({ description: "New content (replace existing)" })),
      importance: Type.Optional(Type.Number({ description: "New importance 1-5" })),
      tags: Type.Optional(Type.String({ description: "New comma-separated tags" })),
    }),
    async execute(
      _id: string,
      params: { id: string; content?: string; importance?: number; tags?: string },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      const updates: Record<string, any> = {};
      if (params.content) updates.content = params.content;
      if (params.importance) updates.importance = Math.min(5, Math.max(1, params.importance));
      if (params.tags) updates.tags = params.tags.split(",").map(t => t.trim()).filter(Boolean);

      const result = updateMemory(params.id, updates);
      if (!result) {
        return textResult(`Memory ${params.id} not found. Use memory_search to find valid IDs.`);
      }

      if (_ctx?.hasUI) {
        _ctx.ui.notify(`\u{1F9E0} Updated: ${result.topic}`, "info");
      }

      return textResult(`Updated memory ${params.id}: ${result.topic}`);
    },
  });

  // ── Register: memory_delete tool ──────────────────────────────────────────

  pi.registerTool({
    name: "memory_delete",
    label: "Memory Delete",
    description: "Delete a memory entry by ID. Irreversible — use with care.",
    promptSnippet: "memory_delete: Remove a memory entry from the store",
    parameters: Type.Object({
      id: Type.String({ description: "ID of the memory to delete (from memory_search results)" }),
    }),
    async execute(
      _id: string,
      params: { id: string },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      const ok = deleteMemory(params.id);
      if (!ok) {
        return textResult(`Memory ${params.id} not found.`);
      }
      return textResult(`Deleted memory ${params.id}.`);
    },
  });

  // ── Register: memory_export tool ──────────────────────────────────────────

  pi.registerTool({
    name: "memory_export",
    label: "Memory Export",
    description: "Export all memories as JSON. Returns a file path to the exported backup.",
    promptSnippet: "memory_export: Backup all memories to a JSON file",
    parameters: Type.Object({}),
    async execute(
      _id: string,
      _params: object,
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      const json = exportMemories();
      const outPath = path.join(getStorePath(), "..", `pi-memory-export-${Date.now()}.json`);
      fs.writeFileSync(outPath, json, "utf-8");
      const stats = getStats();
      return textResult(`Exported ${stats.total} entries to ${outPath}`);
    },
  });

  // ── Register: memory_import tool ──────────────────────────────────────────

  pi.registerTool({
    name: "memory_import",
    label: "Memory Import",
    description: "Import memories from a JSON backup file. Merges with existing memories (no duplicates by ID).",
    promptSnippet: "memory_import: Restore memories from a JSON backup file",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the JSON export file to import" }),
    }),
    async execute(
      _id: string,
      params: { path: string },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      try {
        const content = fs.readFileSync(params.path, "utf-8");
        const imported = importMemories(content, true);
        const stats = getStats();
        return textResult(`Imported ${imported} new entries from ${params.path}. Total: ${stats.total}`);
      } catch (err: any) {
        return textResult(`Import failed: ${err.message}`);
      }
    },
  });

  // ── Register: memory_find tool ────────────────────────────────────────────

  pi.registerTool({
    name: "memory_find",
    label: "Memory Find",
    description: "Look up a memory entry by its ID. Use after memory_search to get full details of a specific result.",
    promptSnippet: "memory_find: Get full details of a memory entry by ID",
    parameters: Type.Object({
      id: Type.String({ description: "ID of the memory to retrieve (from memory_search results)" }),
    }),
    async execute(
      _id: string,
      params: { id: string },
      _sig: AbortSignal | undefined,
      _up: AgentToolUpdateCallback<any> | undefined,
      _ctx: ExtensionContext,
    ): Promise<AgentToolResult<any>> {
      // Search all entries for the ID
      const all = searchMemories("", 99999);
      const found = all.find(e => e.id === params.id);
      if (!found) {
        return textResult(`Memory ${params.id} not found.`);
      }
      const formatted = formatMemory(found, relevanceScore(found));
      return textResult(`Found memory ${params.id}:\n\n${formatted}`);
    },
  });

  // ── Register: /memory command ──────────────────────────────────────────────

  pi.registerCommand("memory", {
    description: "Show pi-memory status and recent entries. Usage: /memory [stats|search <query>|export|prune]",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const stats = getStats();
      const parts = args.trim().toLowerCase();

      if (parts === "stats" || parts === "") {
        const msg = [
          `\u{1F9E0} Pi Memory: ${stats.total} entries, ${Object.keys(stats.byProject).length} projects`,
          `Latest: ${getRecentMemories(3).map(m => `[${m.category}] ${m.topic}`).join(" | ")}`,
          `Storage: ${getStorePath()}`,
        ].join("\n");
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
      } else if (parts.startsWith("search ")) {
        const query = parts.slice(7);
        const results = searchMemories(query, 5);
        const msg = results.length
          ? results.map(m => `[${m.importance}★] ${m.topic}`).join("\n")
          : "No results.";
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
      } else if (parts === "export") {
        const json = exportMemories();
        const outPath = path.join(getStorePath(), "..", `pi-memory-export-${Date.now()}.json`);
        fs.writeFileSync(outPath, json, "utf-8");
        if (ctx.hasUI) ctx.ui.notify(`\u{1F9E0} Exported to ${outPath}`, "info");
      } else if (parts === "prune") {
        const pruned = pruneOldMemories(90, 3);
        if (ctx.hasUI) ctx.ui.notify(`\u{1F9E0} Pruned ${pruned} old low-importance entries`, "info");
      } else {
        if (ctx.hasUI) ctx.ui.notify("Usage: /memory [stats|search <query>|export|prune]", "info");
      }
    },
  });
}
