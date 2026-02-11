/**
 * Test script for StealthCrawler (patchright engine)
 * 
 * Tests the stealth engine against problematic sites:
 * 1. slickdeals.net - Control test (should work with any engine)
 * 2. popyard.space - JS-rendered content (needs waitForJs)
 * 3. webhostingtalk.com - Anti-bot blocked (needs stealth)
 * 
 * Run: npx tsx scripts/test_stealth.ts
 * 
 * This tests directly via the StealthCrawler class (no need for running service).
 */

import { StealthCrawler } from "../src/server/stealthCrawler.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test configuration
// ─────────────────────────────────────────────────────────────────────────────
const TEST_CASES = [
  {
    name: "slickdeals.net (control)",
    url: "https://slickdeals.net/deals/",
    waitForJs: false,
    description: "Control test - should work fine with stealth",
  },
  {
    name: "popyard.space (JS-rendered)",
    url: "https://cn.popyard.space/",
    waitForJs: true,
    description: "JS populates page content - needs waitForJs",
  },
  {
    name: "webhostingtalk.com (anti-bot)",
    url: "https://www.webhostingtalk.com/forumdisplay.php?f=36",
    waitForJs: true,
    description: "Anti-bot protection - patchright should bypass",
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────
function truncate(str: string, len: number): string {
  // Strip tags for readability
  const stripped = str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > len ? stripped.substring(0, len) + "..." : stripped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  StealthCrawler Test Suite (patchright)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const test of TEST_CASES) {
    console.log(`─── ${test.name} ───`);
    console.log(`  URL: ${test.url}`);
    console.log(`  Description: ${test.description}`);
    console.log(`  waitForJs: ${test.waitForJs}`);
    console.log();

    const crawler = new StealthCrawler({
      headless: true,
      waitForJs: test.waitForJs,
      extraWaitMs: test.waitForJs ? 5000 : 0,
    });

    const start = Date.now();

    try {
      const result = await crawler.fetch(test.url, undefined, "chrome");
      const elapsed = Date.now() - start;

      console.log(`  ✅ Status: ${result.statusCode}`);
      console.log(`  ⏱️  Time: ${elapsed}ms`);
      console.log(`  📏 Content length: ${result.content.length} chars`);
      console.log(`  🔧 Engine: ${result.engineUsed}`);
      console.log(`  🔗 Final URL: ${result.url}`);
      console.log(`  📝 Preview: ${truncate(result.content, 300)}`);

      // Check if content looks meaningful
      if (result.content.length < 500) {
        console.log(`  ⚠️  WARNING: Content suspiciously short — may be blocked or empty`);
      }
      if (result.statusCode === 403) {
        console.log(`  ⚠️  WARNING: 403 Forbidden — anti-bot may still be blocking`);
      }

    } catch (error: any) {
      const elapsed = Date.now() - start;
      console.log(`  ❌ FAILED: ${error.message}`);
      console.log(`  ⏱️  Time: ${elapsed}ms`);
    }

    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Tests complete");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
