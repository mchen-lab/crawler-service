#!/usr/bin/env node
/**
 * Real-World News Article Crawler — Markdown Output
 * 
 * Crawls major news sites, extracts article links, fetches each article
 * in MARKDOWN format (stripped HTML) so you can verify readable content.
 * 
 * Key improvements over v1:
 *   - Uses format:"markdown" to get readable text, not raw HTML/CSS/JS
 *   - Better link filtering: requires date-like patterns or long slugs 
 *     typical of article URLs, skips hub/section/index pages
 *   - Saves .md files with URL on first line
 * 
 * Usage: node --import tsx scripts/crawl_news_articles.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

const API = 'http://localhost:31172';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BASE_DIR = path.join(process.cwd(), 'data', `news_${TIMESTAMP}`);
const CONCURRENCY = 3;
const MAX_ARTICLES_PER_SOURCE = 5;

// ─── News sources to crawl ─────────────────────────────────────
const NEWS_SOURCES = [
  { name: 'cnn',             url: 'https://www.cnn.com/' },
  { name: 'bbc',             url: 'https://www.bbc.com/news' },
  { name: 'reuters',         url: 'https://www.reuters.com/' },
  { name: 'apnews',          url: 'https://apnews.com/' },
  { name: 'nytimes',         url: 'https://www.nytimes.com/' },
  { name: 'washingtonpost',  url: 'https://www.washingtonpost.com/' },
  { name: 'theguardian',     url: 'https://www.theguardian.com/us' },
  { name: 'techcrunch',      url: 'https://techcrunch.com/' },
  { name: 'arstechnica',     url: 'https://arstechnica.com/' },
  { name: 'theverge',        url: 'https://www.theverge.com/' },
  { name: 'wired',           url: 'https://www.wired.com/' },
  { name: 'cnbc',            url: 'https://www.cnbc.com/' },
  { name: 'npr',             url: 'https://www.npr.org/' },
  { name: 'hackernews',      url: 'https://news.ycombinator.com/' },
];

// ─── Helpers ────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface CrawlResult {
  success: boolean;
  content: string;       // HTML (used for link extraction)
  markdown: string;      // Markdown (readable text for saving)
  engine: string;
  statusCode: number;
  error?: string;
}

async function crawlUrl(url: string, wantMarkdown = false): Promise<CrawlResult> {
  try {
    const body: any = { url, engine: 'auto' };
    if (wantMarkdown) body.format = 'markdown';
    
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

// ─── Extract ARTICLE links (not sections/hubs) ──────────────────

function isArticleUrl(urlStr: string, baseHostname: string): boolean {
  try {
    const u = new URL(urlStr);
    const p = u.pathname;
    
    // Must be on the same domain
    const linkHost = u.hostname.replace('www.', '');
    const baseHost = baseHostname.replace('www.', '');
    if (!linkHost.includes(baseHost) && !baseHost.includes(linkHost)) return false;

    // Skip root and very short paths
    if (p === '/' || p.length < 10) return false;

    // Skip common non-article patterns
    const skipPatterns = [
      /^\/(login|signup|subscribe|about|contact|privacy|terms|careers|help|faq|search|tag|topic|section|author|profile|settings|account|video|live|hub)\b/i,
      /^\/(manifest|favicon|robots|sitemap|feed|rss|api)\b/i,
      /\.(jpg|jpeg|png|gif|svg|pdf|css|js|mp4|mp3|xml|json)$/i,
      /^\/[a-z-]{1,20}\/?$/i,  // Simple single-segment paths like /world/ or /business/
    ];
    for (const pat of skipPatterns) {
      if (pat.test(p)) return false;
    }

    // Positive signals for article-like URLs:
    // 1. Has a date pattern (2024/01/15 or 2024-01-15)
    const hasDate = /\/20\d{2}\/\d{2}\/\d{2}/.test(p) || /\/20\d{2}-\d{2}-\d{2}/.test(p);
    // 2. Has a long slug (> 3 segments or last segment > 15 chars)
    const segments = p.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    const hasLongSlug = lastSegment.length > 15 && lastSegment.includes('-');
    // 3. Has an article ID pattern
    const hasId = /\/[a-f0-9]{8,}/.test(p) || /\/\d{5,}/.test(p);
    // 4. Deep path (3+ segments)
    const hasDeepPath = segments.length >= 3;

    return hasDate || hasLongSlug || hasId || hasDeepPath;
  } catch {
    return false;
  }
}

function extractArticleLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseHostname = new URL(baseUrl).hostname;
  const links: string[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    
    // Link text should look like an article headline (15-200 chars)
    if (text.length < 15 || text.length > 300) return;

    let fullUrl: string;
    try { fullUrl = new URL(href, baseUrl).href; } catch { return; }

    // Remove query params and hash for dedup
    const clean = fullUrl.split('?')[0].split('#')[0];
    if (seen.has(clean)) return;
    seen.add(clean);

    if (isArticleUrl(fullUrl, baseHostname)) {
      links.push(fullUrl);
    }
  });

  return links;
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  ensureDir(BASE_DIR);
  console.log(`\n📁 Output: ${BASE_DIR}`);
  console.log(`📰 Sources: ${NEWS_SOURCES.length}`);
  console.log(`📄 Max articles/source: ${MAX_ARTICLES_PER_SOURCE}`);
  console.log(`📝 Format: Markdown (readable text)\n`);

  let grandTotal = 0;
  let grandSuccess = 0;
  let grandFailed = 0;
  const allResults: { source: string; url: string; success: boolean; engine: string; chars: number }[] = [];

  for (const source of NEWS_SOURCES) {
    const sourceDir = path.join(BASE_DIR, source.name);
    ensureDir(sourceDir);

    console.log(`\n═══════════════════════════════════════════════════════`);
    console.log(`  ${source.name.toUpperCase()} (${source.url})`);
    console.log(`═══════════════════════════════════════════════════════`);

    // Step 1: Fetch homepage (HTML for link extraction)
    const homeResult = await crawlUrl(source.url, false);
    if (!homeResult.success) {
      console.log(`  ❌ Homepage failed: ${homeResult.error?.slice(0, 60)}`);
      continue;
    }
    console.log(`  📄 Homepage: ${homeResult.content.length} chars`);

    // Step 2: Extract article links
    const articleLinks = extractArticleLinks(homeResult.content, source.url);
    const toFetch = articleLinks.slice(0, MAX_ARTICLES_PER_SOURCE);
    console.log(`  🔗 Found ${articleLinks.length} article links, fetching ${toFetch.length}\n`);

    if (toFetch.length === 0) {
      console.log(`  ⚠️  No article-like links found on homepage`);
      // Save the homepage markdown for inspection
      const homeMd = await crawlUrl(source.url, true);
      if (homeMd.success) {
        const header = `> URL: ${source.url}\n> Engine: ${homeMd.engine}\n> Fetched: ${new Date().toISOString()}\n\n---\n\n`;
        fs.writeFileSync(path.join(sourceDir, '_homepage.md'), header + homeMd.markdown);
      }
      continue;
    }

    // Save link manifest
    const manifest = toFetch.map((u, i) => `${i + 1}. ${u}`).join('\n');
    fs.writeFileSync(path.join(sourceDir, '_article_links.txt'), manifest);

    // Step 3: Crawl articles in MARKDOWN mode
    let srcSuccess = 0;
    let srcFailed = 0;

    await runBatch(toFetch, CONCURRENCY, async (articleUrl) => {
      const idx = toFetch.indexOf(articleUrl) + 1;
      const padIdx = String(idx).padStart(2, '0');
      
      // Build filename from URL slug
      const urlPath = new URL(articleUrl).pathname;
      const pathSegments = urlPath.split('/').filter(Boolean);
      const slug = sanitizeFilename(pathSegments.slice(-2).join('_') || `article_${idx}`);
      const filename = `${padIdx}_${slug}.md`;

      const result = await crawlUrl(articleUrl, true);
      const contentToSave = result.markdown || result.content;

      allResults.push({
        source: source.name,
        url: articleUrl,
        success: result.success,
        engine: result.engine,
        chars: contentToSave.length,
      });

      if (result.success && contentToSave.length > 200) {
        const header = `> URL: ${articleUrl}\n> Engine: ${result.engine}\n> Fetched: ${new Date().toISOString()}\n\n---\n\n`;
        fs.writeFileSync(path.join(sourceDir, filename), header + contentToSave);
        
        // Quick quality check: count readable lines (non-empty, non-tag)
        const lines = contentToSave.split('\n').filter(l => l.trim().length > 20);
        const qualityTag = lines.length < 5 ? ' ⚠️ LOW TEXT' : '';
        
        console.log(`  ✅ ${padIdx}. ${contentToSave.length.toString().padStart(8)} ch  ${lines.length.toString().padStart(4)} lines  ${result.engine.padEnd(22)} ${slug.slice(0, 35)}${qualityTag}`);
        srcSuccess++;
      } else {
        console.log(`  ❌ ${padIdx}. FAILED  ${result.error?.slice(0, 50)}`);
        srcFailed++;
      }
      return result;
    });

    grandTotal += toFetch.length;
    grandSuccess += srcSuccess;
    grandFailed += srcFailed;
    console.log(`  ${source.name}: ${srcSuccess}/${toFetch.length} articles`);
  }

  // ─── Grand Summary ───────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('  GRAND SUMMARY');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Sources:   ${NEWS_SOURCES.length}`);
  console.log(`  Articles:  ${grandTotal}`);
  console.log(`  Succeeded: ${grandSuccess} (${grandTotal > 0 ? (grandSuccess/grandTotal*100).toFixed(0) : 0}%)`);
  console.log(`  Failed:    ${grandFailed} (${grandTotal > 0 ? (grandFailed/grandTotal*100).toFixed(0) : 0}%)`);

  const engineCounts: Record<string, number> = {};
  for (const r of allResults) {
    engineCounts[r.engine] = (engineCounts[r.engine] || 0) + 1;
  }
  console.log('\n  By Engine:');
  for (const [eng, cnt] of Object.entries(engineCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${eng.padEnd(30)} ${String(cnt).padStart(4)} (${(cnt / allResults.length * 100).toFixed(0)}%)`);
  }

  const small = allResults.filter(r => r.success && r.chars < 1000);
  if (small.length > 0) {
    console.log('\n  ⚠️  Suspiciously small (<1K chars):');
    for (const r of small) {
      console.log(`    [${r.source}] ${r.chars}ch ${r.url.slice(0, 70)}`);
    }
  }

  const summary = { timestamp: TIMESTAMP, grandTotal, grandSuccess, grandFailed, engineCounts, results: allResults };
  fs.writeFileSync(path.join(BASE_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  📁 Files: ${BASE_DIR}`);
  console.log('═══════════════════════════════════════════════════════\n');
}

main().catch(console.error);
