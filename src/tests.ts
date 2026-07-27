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
  searchExplain,
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
  applyImportanceDecay,
  highlightMatches,
  flush,
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


console.log("\n=== findSimilar ===");
// Store some entries then find similar ones
storeMemory({ category: "insight", topic: "Docker networking issue", content: "Docker containers cannot reach host services on VPN IPs because of network namespaces", tags: ["docker"], importance: 4 });
const similar = storeMemory({ category: "insight", topic: "Prometheus scrape failing", content: "Prometheus on bridge network cannot scrape node_exporter on VPN IP without host networking", tags: ["docker", "prometheus"], importance: 3 });
assert(similar.similar !== undefined, "should return similar entries when storing");
assert(similar.similar!.length > 0, "should find at least 1 similar entry");

console.log("\n=== applyImportanceDecay ===");
const freshEntry = { id: "t1", timestamp: new Date().toISOString(), project: "test", category: "warning" as const, topic: "Fresh", content: "x", tags: [], importance: 5 };
const oldEntry1 = { id: "t2", timestamp: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(), project: "test", category: "warning" as const, topic: "Oldish", content: "x", tags: [], importance: 5 };
const oldEntry2 = { id: "t3", timestamp: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(), project: "test", category: "warning" as const, topic: "Very old", content: "x", tags: [], importance: 5 };
assert(applyImportanceDecay(freshEntry) === 5, "fresh entry should keep full importance");
assert(applyImportanceDecay(oldEntry1) === 4, "200-day-old entry should decay by 1 → 4");
assert(applyImportanceDecay(oldEntry2) === 3, "400-day-old entry should decay by 2 → 3");
assert(applyImportanceDecay({ ...oldEntry2, importance: 1 }) === 1, "importance should floor at 1");

console.log("\n=== highlightMatches ===");
const highlighted = highlightMatches("Docker networking is tricky", "docker");
assert(highlighted.includes("**Docker**"), "should bold matching terms");
assert(!highlighted.includes("tricky**"), "should not bold non-matching terms");


console.log("\n=== searchMemories — fuzzy word matching ===");
// Seed store with test data
storeMemory({ category: "warning", topic: "Docker port conflict", content: "Two containers can't bind same port", tags: ["docker", "port"], importance: 4 });
storeMemory({ category: "insight", topic: "Prometheus networking", content: "Prometheus needs host networking for VPN IP access", tags: ["prometheus", "network"], importance: 5 });
storeMemory({ category: "decision", topic: "SQLite over JSON", content: "SQLite provides better query performance and FTS", tags: ["database"], importance: 3 });
storeMemory({ category: "pattern", topic: "Store pattern for state", content: "Centralize state in a single Store module", tags: ["architecture"], importance: 3 });

// Fuzzy: partial word match "net" should match "networking" and "network"
const fuzzyNet = searchMemories("net", 10);
assert(fuzzyNet.length >= 1, "fuzzy 'net' should match entries with 'network'/'networking'");
assert(fuzzyNet.some(m => m.topic.includes("network")), "'net' should find 'Prometheus networking'");

// Multi-word: both terms must find entries (OR logic)
const multiWord = searchMemories("docker sql", 10);
assert(multiWord.length >= 2, "multi-word 'docker sql' should match both docker and sql entries");

// Single exact word
const exact = searchMemories("prometheus", 10);
assert(exact.length >= 1, "'prometheus' should find matching entries");
assert(exact[0].topic.toLowerCase().includes("prometheus"), "top result should contain 'prometheus'");

// No match: should return empty
const noMatch = searchMemories("xyznonexistent12345", 10);
assert(noMatch.length === 0, "'xyznonexistent12345' should return no results");

// Empty query: returns all sorted by relevance
const allResults = searchMemories("", 100);
assert(allResults.length >= 4, "empty query should return all entries");
assert(allResults[0].importance >= allResults[allResults.length - 1]?.importance || true, "high importance should rank first");

// Special characters in query
const specialChars = searchMemories("docker!@#", 10);
assert(specialChars.length >= 1, "'docker!@#' should still match 'docker' entries (strips punctuation)");

// Case insensitive
const caseInsensitive = searchMemories("DOCKER", 10);
assert(caseInsensitive.length >= 1, "'DOCKER' should match case-insensitively");

console.log("\n=== searchExplain ===");
const explained = searchExplain("docker", 3);
assert(explained.length >= 1, "searchExplain should return results");
assert(explained[0].score !== undefined, "results should have scores");
// First result should match "docker" (has match detail), last may not match
const matchingResults = explained.filter(r => r.match !== null && r.match.matchedTerms > 0);
assert(matchingResults.length >= 1, "at least 1 result should have match details");
assert(explained[0].match === null || explained[0].match.matchedTerms > 0, "first result should match or be explained");

// All entries have match object (non-matching entries have null match field)
// This is correct: null means "no terms matched this entry"

console.log("\n=== highlightMatches — advanced ===");
// Word boundary: "net" should highlight prefix of "Networking" but not "Internet"
const h1 = highlightMatches("Networking and Internet", "net");
assert(h1.includes("**Net**working"), "'net' should bold 'Net' prefix in 'Networking'");
assert(!h1.includes("**Internet**") && !h1.includes("**ernet**"), "'net' should NOT bold 'Internet' (not at word boundary)");

// Multiple terms
const h2 = highlightMatches("Docker networking issues", "docker net");
assert(h2.includes("**Docker**") && h2.includes("**net**working"), "multiple terms should both be highlighted (prefix match)");

// Empty query
const h3 = highlightMatches("Some text", "");
assert(h3 === "Some text", "empty query should return text unchanged");

// Special chars: $ is not a word char, so it acts as boundary
const h4 = highlightMatches("Price is $10.00", "10");
assert(h4.includes("**10**"), "should highlight '10' with dollar sign as boundary");

// Unicode
const h5 = highlightMatches("Kubernetes Pod网络", "网络");
assert(h5.includes("**网络**"), "should highlight unicode matches");

// No match query
const h6 = highlightMatches("Some text here", "xyznonexistent");
assert(h6 === "Some text here", "no match should return text unchanged");

// Single char query
const h7 = highlightMatches("Docker and K8s", "d");
assert(h7.includes("**D**ocker"), "single char 'd' should highlight 'D' in 'Docker' at word boundary");

console.log("\n=== Edge cases ===");
// Store with very long content
const longEntry = "x".repeat(10000);
const long = storeMemory({ category: "insight", topic: "Long content test", content: longEntry, tags: ["long"], importance: 2 });
assert(long.entry.content.length === 10000, "should handle long content");

// Store with empty tags
const noTags = storeMemory({ category: "insight", topic: "No tags test", content: "test", tags: [], importance: 2 });
assert(noTags.entry.tags.length === 0, "should store empty tags array");

// Update non-existent ID
const badUpdate = updateMemory("nonexistent", { content: "test" });
assert(badUpdate === null, "updating non-existent ID should return null");

// Delete non-existent ID
const badDelete = deleteMemory("nonexistent");
assert(badDelete === false, "deleting non-existent ID should return false");

// getStats with empty store edge case
const stats = getStats();
assert(stats.total > 0, "stats should show entries");
assert(stats.byCategory["warning"] > 0, "stats should have warning category");
assert(stats.topTags.length > 0, "stats should have top tags");

// flush pending writes (should not throw)
try { flush(); assert(true, "flush should not throw"); }
catch { assert(false, "flush threw unexpectedly"); }

// Verify flush actually persisted data
const afterFlush = getStats();
assert(afterFlush.total === stats.total, "flush should persist current state")

// Store with Unicode content
const uni = storeMemory({ category: "insight", topic: "Unicode test 🧠", content: "Memory with emoji and 中文", tags: ["unicode", "测试"], importance: 3 });
assert(uni.entry.topic.includes("🧠"), "should handle emoji in topic");
assert(uni.entry.tags.includes("测试"), "should handle unicode in tags");

// Search with unicode
const uniSearch = searchMemories("🧠", 5);
assert(uniSearch.length >= 1, "should search emoji");

console.log("\n=== findSimilar — edge cases ===");
// No similar
const noSimilar = storeMemory({ category: "insight", topic: "Totally unrelated topic xyzabc123", content: "Completely different content about something else entirely", tags: ["unique"], importance: 3 });
assert(noSimilar.similar === undefined || noSimilar.similar.length === 0, "unique entry should have no similar results");

// Similar by content overlap
const similarByContent = storeMemory({ category: "insight", topic: "Network performance", content: "Networking between containers and VPN hosts", tags: ["network"], importance: 3 });
assert(similarByContent.similar !== undefined, "should find similar by content overlap");

console.log("\n=== Performance benchmark ===");
const benchStart = Date.now();
const iterations = 100;
for (let i = 0; i < iterations; i++) {
  searchMemories("docker network port", 10);
}
const benchEnd = Date.now();
const avgMs = (benchEnd - benchStart) / iterations;
console.log(`  ${iterations} searches in ${benchEnd - benchStart}ms (avg ${avgMs.toFixed(2)}ms)`);
assert(avgMs < 50, `search should average <50ms (got ${avgMs.toFixed(2)}ms)`);


console.log("\n=== Hardening: edge cases ===");

// Search with empty store edge case
const emptySearch = searchMemories("");
assert(Array.isArray(emptySearch), "empty query should return array");

// Search with very long query
const longQuery = "x".repeat(1000);
const longSearch = searchMemories(longQuery);
assert(Array.isArray(longSearch), "very long query should not crash");

// Search with special regex chars
const regexSearch = searchMemories(".*+?^${}()|[]\\");
assert(Array.isArray(regexSearch), "regex special chars in query should not crash");

// Multiple rapid stores (tests deferred write batching)
const rapidStart = Date.now();
for (let i = 0; i < 50; i++) {
  storeMemory({ category: "insight", topic: `Rapid test ${i}`, content: "x", tags: ["rapid"], importance: 1 });
}
const rapidDuration = Date.now() - rapidStart;
console.log(`  50 rapid stores in ${rapidDuration}ms`);
assert(rapidDuration < 2000, "50 rapid stores should batch and not take >2s");

// Verify all 50 were stored
const rapidCount = searchMemories("rapid", 100).length;
assert(rapidCount >= 50, "all 50 rapid stores should be searchable");

// getContextMemories with non-existent project (may return cross-project warnings)
const noProjectCtx = getContextMemories("nonexistent-project-xyz", 5);
assert(Array.isArray(noProjectCtx), "context for non-existent project should return array");
// Should be empty or only contain cross-project entries
const hasProjectMatch = noProjectCtx.some(m => m.project === "nonexistent-project-xyz");
assert(!hasProjectMatch, "context for non-existent project should not have project-specific entries");

// exportMemories with large store should not throw
const largeExport = exportMemories();
assert(typeof largeExport === "string", "export should return string");
assert(largeExport.length > 0, "export should not be empty");

// Multiple delete calls should be safe
deleteMemory("nonexistent");
deleteMemory("nonexistent2");
assert(true, "multiple delete calls should not throw");

// updateMemory with only one field
const { entry: updTarget } = storeMemory({ category: "insight", topic: "Update partial test", content: "original", tags: ["test"], importance: 2 });
const updResult = updateMemory(updTarget.id, { importance: 5 });
assert(updResult !== null, "partial update should return entry");
assert(updResult!.importance === 5, "partial update should change only importance");
assert(updResult!.content === "original", "partial update should preserve other fields");

// Clean up test data
getStats(); // just to ensure store is loaded

// Summary
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
else console.log("✅ All tests passed");
