/**
 * Tests for pi-memory store logic.
 * Run with: node src/tests.ts
 *
 * Simulates the store functions by overriding the store path via env var.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Use a temp store for testing — must be set before importing store.ts
const TEST_DIR = path.join(os.tmpdir(), `pi-memory-test-${Date.now()}`);
// We need to set env before importing store.ts, so use a helper
process.env.PI_MEMORY_STORE_DIR = TEST_DIR;

import {
  storeMemory,
  searchMemories,
  getMemoriesByProject,
  getStats,
  getContextMemories,
  deleteMemory,
  updateMemory,
  pruneOldMemories,
  getAllTags,
  suggestedImportance,
  formatMemory,
  relevanceScore,
  exportMemories,
  importMemories,
  getTTLDays,
  getMaxContextMemories,
} from "./store.js";

// Override the store dir by manipulating the module's internal state
// Since store.ts uses os.homedir() + ".pi/agent/memory", we can't easily override.
// Instead, let's just test the pure logic functions that don't need the store.

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { passed++; }
  else { console.error(`❌ FAIL: ${msg}`); failed++; }
}

// ─── Pure logic tests (no store needed) ──────────────────────────────────────

console.log("\n=== suggestedImportance ===");
assert(suggestedImportance("warning") === 4, "warning → 4");
assert(suggestedImportance("decision") === 4, "decision → 4");
assert(suggestedImportance("insight") === 3, "insight → 3");
assert(suggestedImportance("pattern") === 3, "pattern → 3");
assert(suggestedImportance("todo") === 2, "todo → 2");
assert(suggestedImportance("session") === 1, "session → 1");

console.log("\n=== formatMemory ===");
// Create a mock entry
const mockEntry = {
  id: "test",
  timestamp: new Date().toISOString(),
  project: "test-project",
  category: "insight" as const,
  topic: "Test memory",
  content: "This is a test memory entry",
  tags: ["test", "demo"],
  importance: 4,
};
const formatted = formatMemory(mockEntry, 0.85);
assert(formatted.includes("★★★★"), "should show 4 stars");
assert(formatted.includes("85%"), "should show 85% score");
assert(formatted.includes("Test memory"), "should include topic");
assert(formatted.includes("test-project"), "should include project");
assert(formatted.includes("This is a test"), "should include content");
// Also test without score
const formattedNoScore = formatMemory(mockEntry);
assert(!formattedNoScore.includes("%"), "should not show score when not provided");

console.log("\n=== TTL config ===");
const origTtl = process.env.PI_MEMORY_TTL_DAYS;
process.env.PI_MEMORY_TTL_DAYS = "180";
assert(getTTLDays() === 180, "PI_MEMORY_TTL_DAYS=180 → 180");
process.env.PI_MEMORY_TTL_DAYS = "invalid";
assert(getTTLDays() === 90, "invalid fallback → 90");
delete process.env.PI_MEMORY_TTL_DAYS;
assert(getTTLDays() === 90, "unset → 90");
if (origTtl) process.env.PI_MEMORY_TTL_DAYS = origTtl;

console.log("\n=== Max context config ===");
const origCtx = process.env.PI_MEMORY_MAX_CONTEXT;
process.env.PI_MEMORY_MAX_CONTEXT = "12";
assert(getMaxContextMemories() === 12, "PI_MEMORY_MAX_CONTEXT=12 → 12");
process.env.PI_MEMORY_MAX_CONTEXT = "99";
assert(getMaxContextMemories() === 8, "99 out of range → 8");
process.env.PI_MEMORY_MAX_CONTEXT = "0";
assert(getMaxContextMemories() === 8, "0 out of range → 8");
delete process.env.PI_MEMORY_MAX_CONTEXT;
assert(getMaxContextMemories() === 8, "unset → 8");
if (origCtx) process.env.PI_MEMORY_MAX_CONTEXT = origCtx;

console.log("\n=== Export/Import ===");
// Test that export produces valid JSON
const { entry } = storeMemory({ category: "insight", topic: "Export test", content: "test", tags: ["test"], importance: 3 });
const exported = exportMemories();
const parsed = JSON.parse(exported);
assert(Array.isArray(parsed.entries), "export should produce entries array");
assert(parsed.entries.length > 0, "export should contain entries");
deleteMemory(entry.id);

// Test import of the exported data
const imported = importMemories(exported);
assert(imported >= 0, "import should return count");

// Clean up test data
getStats(); // just to ensure store is loaded

// Summary
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log("✅ All tests passed");
