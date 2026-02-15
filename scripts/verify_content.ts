#!/usr/bin/env node
/**
 * Real-World Content Verification Script
 * 
 * 1. Crawls a list of sample sites and saves HTML to timestamped folder
 * 2. Crawls news.google.com, extracts article links, crawls each article
 * 
 * Usage: node --import tsx scripts/verify_content.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

const API = 'http://localhost:31172';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BASE_DIR = path.join(process.cwd(), 'data', `run_${TIMESTAMP}`);
const CONCURRENCY = 5;

// ─── Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function crawlUrl(url: string): Promise<{ success: boolean; content: string; engine: string; statusCode: number; error?: string }> {
  try {
    const res = await fetch(`${API}/api/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, engine: 'auto' }),
    });
    const data = await res.json() as any;
    return {
      success: data.success ?? false,
      content: data.content ?? '',
      engine: data.engineUsed ?? '?',
      statusCode: data.statusCode ?? 0,
      error: data.error,
    };
  } catch (e: any) {
    return { success: false, content: '', engine: 'error', statusCode: 0, error: e.message };
  }
}

function saveContent(dir: string, filename: string, url: string, content: string, engine: string) {
  ensureDir(dir);
  // First line = source URL, second = engine, then blank, then content
  const header = `<!-- URL: ${url} -->\n<!-- Engine: ${engine} -->\n<!-- Fetched: ${new Date().toISOString()} -->\n\n`;
  fs.writeFileSync(path.join(dir, filename), header + content);
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
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

// ─── Part 1: Sample Sites ──────────────────────────────────────

const SAMPLE_SITES = [
  'https://www.reddit.com/r/technology',
  'https://www.bloomberg.com/',
  'https://www.google.com/search?q=weather',
  'https://www.amazon.com/',
  'https://www.ebay.com/',
  'https://www.zillow.com/',
  'https://www.nytimes.com/',
  'https://www.wsj.com/',
  'https://www.washingtonpost.com/',
  'https://techcrunch.com/',
  'https://www.linkedin.com/',
  'https://finance.yahoo.com/',
  'https://www.glassdoor.com/Job/jobs.htm',
  'https://www.nike.com/',
  'https://news.ycombinator.com/',
];

async function partOneSampleSites() {
  const dir = path.join(BASE_DIR, 'sample_sites');
  ensureDir(dir);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Part 1: Crawling ${SAMPLE_SITES.length} sample sites`);
  console.log(`  Output: ${dir}`);
  console.log('═══════════════════════════════════════════════════════\n');

  await runBatch(SAMPLE_SITES, CONCURRENCY, async (url) => {
    const hostname = new URL(url).hostname.replace('www.', '');
    const pathPart = new URL(url).pathname.replace(/\//g, '_').slice(0, 30);
    const filename = `${hostname}${pathPart}.html`;

    const result = await crawlUrl(url);
    if (result.success) {
      saveContent(dir, filename, url, result.content, result.engine);
      console.log(`  ✅ ${hostname.padEnd(25)} ${result.content.length.toString().padStart(10)} chars  via ${result.engine}`);
    } else {
      console.log(`  ❌ ${hostname.padEnd(25)} ERROR: ${result.error?.slice(0, 60)}`);
    }
    return result;
  });
}

// ─── Part 2: Google News Articles ──────────────────────────────

async function partTwoGoogleNews() {
  const dir = path.join(BASE_DIR, 'google_news_articles');
  ensureDir(dir);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Part 2: Crawling Google News → extracting articles');
  console.log(`  Output: ${dir}`);
  console.log('═══════════════════════════════════════════════════════\n');

  // Step 1: Fetch Google News homepage
  console.log('  Fetching news.google.com...');
  const newsResult = await crawlUrl('https://news.google.com/');
  if (!newsResult.success) {
    console.log(`  ❌ Failed to fetch Google News: ${newsResult.error}`);
    return;
  }
  saveContent(dir, '_google_news_homepage.html', 'https://news.google.com/', newsResult.content, newsResult.engine);
  console.log(`  ✅ Google News fetched: ${newsResult.content.length} chars via ${newsResult.engine}`);

  // Step 2: Extract article links
  const $ = cheerio.load(newsResult.content);
  const allLinks: { url: string; text: string }[] = [];

  // Google News uses <a> tags with hrefs starting with ./articles/ or containing article URLs
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    // Skip very short link text (icons, buttons)
    if (text.length < 10) return;
    // Skip category/nav links
    if (text.length > 200) return;

    let resolvedUrl = '';

    if (href.startsWith('http://') || href.startsWith('https://')) {
      // External link — direct article URL
      resolvedUrl = href;
    } else if (href.startsWith('./articles/') || href.startsWith('./read/')) {
      // Google News internal link — resolve to full URL
      resolvedUrl = `https://news.google.com/${href.replace('./', '')}`;
    }

    if (resolvedUrl && !resolvedUrl.includes('accounts.google') && !resolvedUrl.includes('support.google')) {
      allLinks.push({ url: resolvedUrl, text: text.slice(0, 100) });
    }
  });

  // Deduplicate by URL
  const seen = new Set<string>();
  const uniqueLinks = allLinks.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  console.log(`\n  Found ${uniqueLinks.length} unique article links`);

  // Take first 20 articles
  const articlesToFetch = uniqueLinks.slice(0, 20);
  console.log(`  Fetching first ${articlesToFetch.length} articles...\n`);

  // Write link manifest
  const manifest = articlesToFetch.map((l, i) => `${i + 1}. ${l.text}\n   ${l.url}`).join('\n\n');
  fs.writeFileSync(path.join(dir, '_manifest.txt'), manifest);

  // Step 3: Crawl each article
  let successCount = 0;
  let failCount = 0;

  await runBatch(articlesToFetch, CONCURRENCY, async (link) => {
    const idx = articlesToFetch.indexOf(link) + 1;
    const padIdx = String(idx).padStart(2, '0');
    
    // Try to get the actual domain from the URL
    let domain = 'unknown';
    try {
      domain = new URL(link.url).hostname.replace('www.', '');
    } catch {
      domain = 'googlenews';
    }

    const filename = `${padIdx}_${sanitizeFilename(domain)}.html`;

    const result = await crawlUrl(link.url);
    if (result.success && result.content.length > 500) {
      saveContent(dir, filename, link.url, result.content, result.engine);
      console.log(`  ✅ ${padIdx}. ${domain.padEnd(30)} ${result.content.length.toString().padStart(10)} chars  via ${result.engine}`);
      successCount++;
    } else if (result.success) {
      saveContent(dir, filename, link.url, result.content, result.engine);
      console.log(`  ⚠️  ${padIdx}. ${domain.padEnd(30)} ${result.content.length.toString().padStart(10)} chars  via ${result.engine} (suspiciously small)`);
      successCount++;
    } else {
      console.log(`  ❌ ${padIdx}. ${domain.padEnd(30)} ERROR: ${result.error?.slice(0, 50)}`);
      failCount++;
    }
    return result;
  });

  console.log(`\n  Articles: ${successCount} succeeded, ${failCount} failed out of ${articlesToFetch.length}`);
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  ensureDir(BASE_DIR);
  console.log(`\n📁 Output directory: ${BASE_DIR}\n`);

  await partOneSampleSites();
  await partTwoGoogleNews();

  // Summary
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  DONE');
  console.log(`  📁 Review files at: ${BASE_DIR}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
