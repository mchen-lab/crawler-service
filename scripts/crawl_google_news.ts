#!/usr/bin/env node
/**
 * Google News Article Crawler
 * 
 * Uses Google News RSS feeds to get article links per category,
 * then uses BROWSER ENGINE (renderJs=true) to follow the JS redirects
 * and fetch actual article content in markdown format.
 * 
 * Google News encodes article URLs — they don't do HTTP 302 redirects,
 * instead they serve a JS page that does client-side redirect.
 * Only a browser engine can follow this.
 * 
 * Usage: node --import tsx scripts/crawl_google_news.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const API = 'http://localhost:31172';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BASE_DIR = path.join(process.cwd(), 'data', `gnews_${TIMESTAMP}`);
const CONCURRENCY = 5; // 5 parallel browser tabs
const ARTICLES_PER_CATEGORY = 5;

// ─── Google News RSS Topic IDs ──────────────────────────────────
const CATEGORIES: Record<string, string> = {
  'top_stories':   'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
  'world':         'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
  'business':      'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
  'technology':    'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
  'science':       'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
  'health':        'https://news.google.com/rss/topics/CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ?hl=en-US&gl=US&ceid=US:en',
  'sports':        'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en',
};

// ─── Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface CrawlResult {
  success: boolean;
  content: string;
  markdown: string;
  engine: string;
  statusCode: number;
  error?: string;
}

/**
 * Fetch a URL.
 * - For RSS feeds: use fast engine (plain HTTP)
 * - For Google News article links: use browser engine to follow JS redirect
 */
async function crawlUrl(
  url: string, 
  opts: { useBrowser?: boolean; wantMarkdown?: boolean } = {}
): Promise<CrawlResult> {
  try {
    const body: any = { url };
    
    if (opts.useBrowser) {
      // Use browser engine to follow JS redirects
      body.engine = 'browser';
      body.renderJs = true;
      body.renderDelayMs = 3000; // wait for JS redirect + page load
    } else {
      body.engine = 'auto';
    }
    
    if (opts.wantMarkdown) {
      body.format = 'markdown';
    }
    
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
      engine: data.engineUsed ?? '?',
      statusCode: data.statusCode ?? 0,
      error: data.error,
    };
  } catch (e: any) {
    return { success: false, content: '', markdown: '', engine: 'error', statusCode: 0, error: e.message };
  }
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 60);
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

// ─── Parse RSS XML ──────────────────────────────────────────────

interface Article {
  title: string;
  url: string;
  source: string;
  pubDate: string;
}

function parseRss(xml: string): Article[] {
  const articles: Article[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || '';
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || '';
    const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]
      ?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() || '';
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';

    if (link && title) {
      articles.push({ title, url: link, source, pubDate });
    }
  }
  return articles;
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  ensureDir(BASE_DIR);
  console.log(`\n📁 Output: ${BASE_DIR}`);
  console.log(`📰 Categories: ${Object.keys(CATEGORIES).length}`);
  console.log(`📄 Articles/category: ${ARTICLES_PER_CATEGORY}`);
  console.log(`🌐 Using BROWSER engine to follow Google News JS redirects`);
  console.log(`⚡ Concurrency: ${CONCURRENCY}\n`);

  let grandTotal = 0;
  let grandSuccess = 0;
  let grandFailed = 0;
  const allResults: { category: string; source: string; title: string; url: string; success: boolean; engine: string; chars: number }[] = [];
  const uniqueSources = new Set<string>();

  for (const [category, rssUrl] of Object.entries(CATEGORIES)) {
    const catDir = path.join(BASE_DIR, category);
    ensureDir(catDir);

    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`  ${category.toUpperCase()}`);
    console.log(`═══════════════════════════════════════════════════════`);

    // Step 1: Fetch RSS feed (fast HTTP is fine for RSS)
    console.log(`  Fetching RSS feed...`);
    const rssResult = await crawlUrl(rssUrl);
    if (!rssResult.success) {
      console.log(`  ❌ RSS fetch failed: ${rssResult.error}`);
      continue;
    }

    // Step 2: Parse articles from RSS
    const articles = parseRss(rssResult.content);
    const toFetch = articles.slice(0, ARTICLES_PER_CATEGORY);
    console.log(`  Found ${articles.length} articles in RSS, fetching ${toFetch.length}\n`);

    if (toFetch.length === 0) {
      // Save the raw RSS for debugging
      fs.writeFileSync(path.join(catDir, '_feed_raw.xml'), rssResult.content);
      console.log(`  ⚠️  No articles parsed from RSS feed`);
      continue;
    }

    // Save manifest
    const manifest = toFetch.map((a, i) => `${i + 1}. [${a.source}] ${a.title}\n   ${a.url}`).join('\n\n');
    fs.writeFileSync(path.join(catDir, '_manifest.txt'), manifest);

    // Step 3: Crawl each article using BROWSER engine to follow JS redirect
    let catSuccess = 0;
    let catFailed = 0;

    await runBatch(toFetch, CONCURRENCY, async (article) => {
      const idx = toFetch.indexOf(article) + 1;
      const padIdx = String(idx).padStart(2, '0');
      const sourceSlug = sanitizeFilename(article.source || 'unknown');
      const titleSlug = sanitizeFilename(article.title.slice(0, 40));
      const filename = `${padIdx}_${sourceSlug}_${titleSlug}.md`;

      // Use browser engine to follow the JS redirect
      const result = await crawlUrl(article.url, { useBrowser: true, wantMarkdown: true });
      const contentToSave = result.markdown || result.content || '';

      uniqueSources.add(article.source);
      allResults.push({
        category,
        source: article.source,
        title: article.title,
        url: article.url,
        success: result.success,
        engine: result.engine,
        chars: contentToSave.length,
      });

      if (result.success && contentToSave.length > 200) {
        const header = `> Source: ${article.source}\n> Title: ${article.title}\n> Google News URL: ${article.url}\n> Engine: ${result.engine}\n> Fetched: ${new Date().toISOString()}\n\n---\n\n`;
        fs.writeFileSync(path.join(catDir, filename), header + contentToSave);

        const lines = contentToSave.split('\n').filter(l => l.trim().length > 20);
        const qualityTag = lines.length < 5 ? ' ⚠️ LOW' : '';
        console.log(`  ✅ ${padIdx}. [${article.source.padEnd(20)}] ${contentToSave.length.toString().padStart(7)} ch  ${lines.length.toString().padStart(3)} lines  ${titleSlug.slice(0, 35)}${qualityTag}`);
        catSuccess++;
      } else {
        console.log(`  ❌ ${padIdx}. [${article.source.padEnd(20)}] ${result.error?.slice(0, 50) || 'empty content'}`);
        catFailed++;
      }
      return result;
    });

    grandTotal += toFetch.length;
    grandSuccess += catSuccess;
    grandFailed += catFailed;
    console.log(`\n  ${category}: ${catSuccess}/${toFetch.length} succeeded`);
  }

  // ─── Grand Summary ───────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  GRAND SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Categories:      ${Object.keys(CATEGORIES).length}`);
  console.log(`  Total articles:  ${grandTotal}`);
  console.log(`  Succeeded:       ${grandSuccess} (${grandTotal > 0 ? (grandSuccess/grandTotal*100).toFixed(0) : 0}%)`);
  console.log(`  Failed:          ${grandFailed}`);
  console.log(`  Unique sources:  ${uniqueSources.size}`);

  const engineCounts: Record<string, number> = {};
  for (const r of allResults) {
    engineCounts[r.engine] = (engineCounts[r.engine] || 0) + 1;
  }
  console.log('\n  By Engine:');
  for (const [eng, cnt] of Object.entries(engineCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${eng.padEnd(30)} ${String(cnt).padStart(4)}`);
  }

  console.log('\n  News sources encountered:');
  for (const src of [...uniqueSources].sort()) {
    console.log(`    ${src}`);
  }

  const summary = { timestamp: TIMESTAMP, grandTotal, grandSuccess, grandFailed, engineCounts, uniqueSources: [...uniqueSources], results: allResults };
  fs.writeFileSync(path.join(BASE_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  📁 Files: ${BASE_DIR}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
