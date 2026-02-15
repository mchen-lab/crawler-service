#!/usr/bin/env node
/**
 * Google News Browser Crawl Test
 * 
 * Uses the REAL browser engine to:
 * 1. Fetch news.google.com homepage (rendered HTML via browser)
 * 2. Extract article links from the rendered DOM
 * 3. Follow each Google News article link (JS redirect) to get actual article
 * 4. Save homepage + articles to data/gnews_browser_<timestamp>/
 * 
 * Usage: node --import tsx scripts/test_gnews_browser.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:31172';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BASE_DIR = path.join(process.cwd(), 'data', `gnews_browser_${TIMESTAMP}`);
const MAX_ARTICLES = 15;    // How many article links to follow
const CONCURRENCY = 5;      // Parallel browser tabs

// ─── Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface FetchResult {
  success: boolean;
  content: string;
  markdown: string;
  statusCode: number;
  finalUrl: string;
  engine: string;
  error?: string;
}

async function browserFetch(url: string, opts: { renderDelayMs?: number; format?: string } = {}): Promise<FetchResult> {
  try {
    const body: any = {
      url,
      engine: 'browser',
      renderJs: true,
      renderDelayMs: opts.renderDelayMs ?? 3000,
    };
    if (opts.format) body.format = opts.format;

    const res = await fetch(`${API}/api/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json() as any;
    return {
      success: data.success ?? false,
      content: data.content ?? '',
      markdown: data.markdown ?? data.content ?? '',
      statusCode: data.statusCode ?? 0,
      finalUrl: data.url ?? url,
      engine: data.engineUsed ?? '?',
      error: data.error,
    };
  } catch (e: any) {
    return { success: false, content: '', markdown: '', statusCode: 0, finalUrl: url, engine: 'error', error: e.message };
  }
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 80);
}

async function runBatch<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// ─── Extract article links from Google News HTML ────────────────

interface ArticleLink {
  href: string;
  text: string;
}

function extractArticleLinks(html: string): ArticleLink[] {
  const links: ArticleLink[] = [];
  const seen = new Set<string>();

  // Google News article links can be:
  //   href="./read/CBMi..."    (current format as of 2026)
  //   href="./articles/CBMi..." (older format)
  const regex = /<a[^>]*href="([^"]*\/(?:read|articles)\/CBMi[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    let href = match[1];
    const rawText = match[2];
    
    // Strip HTML tags from link text to get clean title
    const text = rawText.replace(/<[^>]+>/g, '').trim();
    if (!text || text.length < 5) continue;

    // Resolve relative URLs and decode HTML entities
    if (href.startsWith('./')) {
      href = `https://news.google.com/${href.slice(2)}`;
    } else if (href.startsWith('/')) {
      href = `https://news.google.com${href}`;
    }
    href = href.replace(/&amp;/g, '&');

    // Deduplicate by href
    if (seen.has(href)) continue;
    seen.add(href);

    links.push({ href, text });
  }

  return links;
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  ensureDir(BASE_DIR);
  console.log(`\n📁 Output: ${BASE_DIR}`);
  console.log(`🌐 Using BROWSER engine for everything`);
  console.log(`⚡ Concurrency: ${CONCURRENCY}`);
  console.log(`📄 Max articles: ${MAX_ARTICLES}\n`);

  // ─── Step 1: Fetch the Google News homepage ──────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  STEP 1: Fetching news.google.com homepage');
  console.log('═══════════════════════════════════════════════════════\n');

  const startHomepage = Date.now();
  const homepage = await browserFetch('https://news.google.com/', { renderDelayMs: 5000 });
  const homepageDuration = ((Date.now() - startHomepage) / 1000).toFixed(1);

  if (!homepage.success) {
    console.log(`  ❌ Failed to fetch homepage: ${homepage.error}`);
    return;
  }

  // Save homepage HTML
  fs.writeFileSync(path.join(BASE_DIR, '00_homepage.html'), homepage.content);
  console.log(`  ✅ Homepage fetched in ${homepageDuration}s`);
  console.log(`     Content: ${homepage.content.length.toLocaleString()} chars`);
  console.log(`     Engine: ${homepage.engine}`);
  console.log(`     Final URL: ${homepage.finalUrl}`);

  // ─── Step 2: Extract article links ───────────────────────────
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  STEP 2: Extracting article links from homepage');
  console.log('═══════════════════════════════════════════════════════\n');

  const allLinks = extractArticleLinks(homepage.content);
  console.log(`  Found ${allLinks.length} unique article links`);

  if (allLinks.length === 0) {
    console.log('  ⚠️  No article links found. Saving homepage for inspection.');
    console.log(`  📁 Check: ${path.join(BASE_DIR, '00_homepage.html')}`);
    return;
  }

  const toFetch = allLinks.slice(0, MAX_ARTICLES);
  console.log(`  Will fetch top ${toFetch.length} articles\n`);

  // Save manifest
  const manifest = toFetch.map((a, i) => `${(i + 1).toString().padStart(2, '0')}. ${a.text}\n    ${a.href}`).join('\n\n');
  fs.writeFileSync(path.join(BASE_DIR, '00_manifest.txt'), manifest);

  // ─── Step 3: Crawl each article ──────────────────────────────
  console.log('═══════════════════════════════════════════════════════');
  console.log('  STEP 3: Crawling articles via browser');
  console.log('═══════════════════════════════════════════════════════\n');

  let succeeded = 0;
  let failed = 0;
  const results: { idx: number; title: string; finalUrl: string; success: boolean; chars: number; engine: string }[] = [];
  const startArticles = Date.now();

  await runBatch(toFetch, CONCURRENCY, async (link) => {
    const idx = toFetch.indexOf(link) + 1;
    const padIdx = String(idx).padStart(2, '0');
    const titleSlug = sanitizeFilename(link.text.slice(0, 60));

    // Fetch article — browser follows JS redirect to real article
    const result = await browserFetch(link.href, { renderDelayMs: 3000, format: 'markdown' });
    const contentToSave = result.markdown || result.content || '';

    // Determine the actual source domain from the final URL
    let sourceDomain = '?';
    try { sourceDomain = new URL(result.finalUrl).hostname.replace('www.', ''); } catch {}

    results.push({
      idx,
      title: link.text,
      finalUrl: result.finalUrl,
      success: result.success && contentToSave.length > 200,
      chars: contentToSave.length,
      engine: result.engine,
    });

    if (result.success && contentToSave.length > 200) {
      // Save as markdown with metadata header
      const header = [
        `> Title: ${link.text}`,
        `> Source: ${sourceDomain}`,
        `> Google News URL: ${link.href}`,
        `> Final URL: ${result.finalUrl}`,
        `> Engine: ${result.engine}`,
        `> Fetched: ${new Date().toISOString()}`,
        `> Content length: ${contentToSave.length} chars`,
        '',
        '---',
        '',
      ].join('\n');

      fs.writeFileSync(path.join(BASE_DIR, `${padIdx}_${titleSlug}.md`), header + contentToSave);

      const lines = contentToSave.split('\n').filter(l => l.trim().length > 20);
      const qualityTag = lines.length < 5 ? ' ⚠️ LOW' : '';
      console.log(`  ✅ ${padIdx}. [${sourceDomain.padEnd(25)}] ${contentToSave.length.toString().padStart(7)} ch  ${lines.length.toString().padStart(3)} ln  ${link.text.slice(0, 45)}${qualityTag}`);
      succeeded++;
    } else {
      console.log(`  ❌ ${padIdx}. [${sourceDomain.padEnd(25)}] ${result.error?.slice(0, 50) || `empty (${contentToSave.length} chars)`}`);
      failed++;
    }
  });

  const articlesDuration = ((Date.now() - startArticles) / 1000).toFixed(1);

  // ─── Summary ─────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Articles found on page:  ${allLinks.length}`);
  console.log(`  Articles crawled:        ${toFetch.length}`);
  console.log(`  Succeeded:               ${succeeded} (${toFetch.length > 0 ? (succeeded / toFetch.length * 100).toFixed(0) : 0}%)`);
  console.log(`  Failed:                  ${failed}`);
  console.log(`  Homepage fetch:          ${homepageDuration}s`);
  console.log(`  Article crawl time:      ${articlesDuration}s`);
  console.log(`  Total time:              ${((Date.now() - startHomepage) / 1000).toFixed(1)}s`);

  // Show unique source domains
  const domains = new Set(results.filter(r => r.success).map(r => {
    try { return new URL(r.finalUrl).hostname.replace('www.', ''); } catch { return '?'; }
  }));
  console.log(`\n  Source domains (${domains.size}):`);
  for (const d of [...domains].sort()) {
    console.log(`    ${d}`);
  }

  // Save summary JSON
  const summary = {
    timestamp: TIMESTAMP,
    homepageChars: homepage.content.length,
    linksFound: allLinks.length,
    articlesCrawled: toFetch.length,
    succeeded,
    failed,
    homepageDurationSec: parseFloat(homepageDuration),
    articlesDurationSec: parseFloat(articlesDuration),
    results,
  };
  fs.writeFileSync(path.join(BASE_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  📁 Files: ${BASE_DIR}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
