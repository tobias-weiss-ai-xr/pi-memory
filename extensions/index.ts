/**
 * pi-memory: Experiential memory extension for pi.
 *
 * Hooks into session lifecycle to:
 *  - Auto-store experiences, decisions, and patterns at session end
 *  - Retrieve relevant memories at session start
 *  - Provide memory_search, memory_store, and memory_stats tools
 *
 * Install:  pi install /path/to/pi-memory
 * Reload:   /reload
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as path from "node:path";
import {
  storeMemory,
  searchMemories,
  getMemoriesByProject,
  getRecentMemories,
  getStats,
  getStorePath,
  type MemoryCategory,
} from "../src/store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectProject(cwd?: string): string {
  if (!cwd) return "unknown";
  try {
    const { execSync } = require("node:child_process");
    const remote = execSync("git config --get remote.origin.url", { cwd, encoding: "utf-8", timeout: 3000 }).trim();
    const match = remote.match(/[\/:]([^\/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch { /* not a git repo */ }
  return path.basename(cwd);
}

function textResult(text: string): AgentToolResult<any> {
  return { content: [{ type: "text" as const, text }], details: {} };
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── Session start: surface relevant memories ──────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const project = detectProject(cwd);
    const stats = getStats();
    if (stats.total === 0) return;

    const projectMemories = getMemoriesByProject(project, 5);
    const short = projectMemories.length > 0
      ? `\u{1F9E0} ${projectMemories.length} memories loaded for ${project}`
      : `\u{1F9E0} ${stats.total} memories across ${Object.keys(stats.byProject).length} projects`;

    if (ctx.hasUI) {
      ctx.ui.setStatus("pi-memory", short);
    }
  });

  // ── Session end: auto-store experiences ────────────────────────────────────

  pi.on("session_shutdown", async (_event, ctx) => {
    const cwd = ctx.cwd || process.cwd();
    const project = detectProject(cwd);
    storeMemory({
      category: "session",
      topic: `Session in ${project}`,
      content: `Coding session in ${project} at ${new Date().toISOString().slice(0, 10)}`,
      tags: [project, "session"],
      importance: 1,
      cwd,
    });
  });

  // ── Register: memory_search tool ───────────────────────────────────────────

  pi.registerTool({
    name: "memory_search",
    label: "Memory Search",
    description: "Search pi-memory's experiential database for past learnings, decisions, patterns, and warnings. Use at session start to retrieve prior context.",
    promptSnippet: "memory_search: Retrieve prior experiential learnings from past sessions",
    parameters: Type.Object({
      query: Type.String({ description: "Search keywords (matches topic, content, tags, project)" }),
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

      const lines = results.map(m => {
        const date = m.timestamp.slice(0, 10);
        const tagStr = m.tags.length ? ` [${m.tags.join(", ")}]` : "";
        return `[${date}] [${m.category}] ${m.project}: ${m.topic}${tagStr}\n  ${m.content.slice(0, 300)}`;
      });

      return textResult(`Found ${results.length} memory entr${results.length === 1 ? "y" : "ies"}:\n\n${lines.join("\n\n")}`);
    },
  });

  // ── Register: memory_store tool ────────────────────────────────────────────

  pi.registerTool({
    name: "memory_store",
    label: "Memory Store",
    description: "Store an experiential learning, decision, pattern, warning, or todo into pi-memory. Use after completing a task, discovering a workaround, or making an architectural decision.",
    promptSnippet: "memory_store: Persist learnings, patterns, and decisions for future sessions",
    parameters: Type.Object({
      topic: Type.String({ description: "Short title for this memory (e.g., 'UFW blocks Docker port 9090')" }),
      content: Type.String({ description: "Detailed description of what was learned, decided, or observed" }),
      category: Type.String({ description: "insight, pattern, decision, warning, or todo" }),
      tags: Type.Optional(Type.String({ description: "Comma-separated tags for search (e.g., 'docker,ufw,networking')" })),
      importance: Type.Optional(Type.Number({ description: "Importance 1-5 (default 3)" })),
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
        return textResult(`Invalid category. Choose: ${validCategories.join(", ")}`);
      }

      const entry = storeMemory({
        category: cat,
        topic: params.topic,
        content: params.content,
        tags: params.tags ? params.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
        importance: Math.min(5, Math.max(1, params.importance || 3)),
        cwd: ctx.cwd,
      });

      if (ctx.hasUI) {
        ctx.ui.notify(`\u{1F9E0} Stored: ${params.topic}`, "info");
      }

      return textResult(`Stored as [${entry.category}] with id ${entry.id} in project ${entry.project}.`);
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
      const lines: string[] = [
        `\u{1F9E0} Pi Memory Stats`,
        `Total entries: ${stats.total}`,
        `Storage: ${getStorePath()}`,
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

  // ── Register: /memory command ──────────────────────────────────────────────

  pi.registerCommand("memory", {
    description: "Show pi-memory status and recent entries",
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
          ? results.map(m => `[${m.category}] ${m.topic}`).join("\n")
          : "No results.";
        if (ctx.hasUI) ctx.ui.notify(msg, "info");
      } else {
        if (ctx.hasUI) ctx.ui.notify("Usage: /memory [stats|search <query>]", "info");
      }
    },
  });
}
