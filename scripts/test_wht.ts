/**
 * Focused test for webhostingtalk.com anti-bot bypass
 * 
 * Tries multiple strategies:
 * 1. domcontentloaded (fast, may get challenge page)
 * 2. load event (wait for page load, not network)
 * 3. networkidle with longer timeout
 * 
 * Run: npx tsx scripts/test_wht.ts
 */

import { chromium } from "patchright";

const URL = "https://www.webhostingtalk.com/forumdisplay.php?f=36";

async function testStrategy(name: string, waitUntil: string, timeout: number, extraWaitMs: number) {
  console.log(`\n─── Strategy: ${name} ───`);
  console.log(`  waitUntil: ${waitUntil}, timeout: ${timeout}ms, extraWait: ${extraWaitMs}ms`);

  let browser = null;
  const start = Date.now();

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();

    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
    });

    const response = await page.goto(URL, {
      waitUntil: waitUntil as any,
      timeout,
    });

    if (extraWaitMs > 0) {
      console.log(`  Waiting extra ${extraWaitMs}ms...`);
      await page.waitForTimeout(extraWaitMs);
    }

    const content = await page.content();
    const statusCode = response?.status() || 0;
    const finalUrl = page.url();
    const elapsed = Date.now() - start;
    const title = await page.title();

    console.log(`  ✅ Status: ${statusCode}`);
    console.log(`  ⏱️  Time: ${elapsed}ms`);
    console.log(`  📏 Content length: ${content.length} chars`);
    console.log(`  📄 Title: ${title}`);
    console.log(`  🔗 Final URL: ${finalUrl}`);

    // Check for anti-bot indicators
    const lowerContent = content.toLowerCase();
    if (lowerContent.includes('cloudflare') || lowerContent.includes('challenge-platform')) {
      console.log(`  ⚠️  CLOUDFLARE challenge detected in content`);
    }
    if (lowerContent.includes('access denied') || lowerContent.includes('403 forbidden')) {
      console.log(`  ⚠️  ACCESS DENIED in content`);
    }
    if (lowerContent.includes('forumdisplay') || lowerContent.includes('thread')) {
      console.log(`  ✅ Forum content detected! Anti-bot bypassed!`);
    }

    // Print a snippet
    const stripped = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`  📝 Preview: ${stripped.substring(0, 400)}...`);

    await context.close();
  } catch (error: any) {
    const elapsed = Date.now() - start;
    console.log(`  ❌ FAILED: ${error.message.split('\n')[0]}`);
    console.log(`  ⏱️  Time: ${elapsed}ms`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  WebHostingTalk Anti-Bot Test (patchright)");
  console.log("═══════════════════════════════════════════════════════════════");

  // Strategy 1: domcontentloaded (fast - just see what we get)
  await testStrategy("domcontentloaded", "domcontentloaded", 30000, 0);

  // Strategy 2: load + extra wait (give challenge time to resolve)
  await testStrategy("load + 5s wait", "load", 30000, 5000);

  // Strategy 3: commit (earliest possible, then long wait for challenge)
  await testStrategy("commit + 10s wait", "commit", 30000, 10000);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Done");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
