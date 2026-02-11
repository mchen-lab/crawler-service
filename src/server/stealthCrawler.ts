/**
 * Stealth Crawler using Patchright
 * 
 * Uses Patchright (stealth-patched Playwright) to bypass advanced anti-bot detection.
 * Patchright is a drop-in Playwright replacement that fixes:
 * - navigator.webdriver leak
 * - CDP Runtime.enable detection
 * - HeadlessChrome user-agent leak
 * - Various browser fingerprinting issues
 * 
 * This crawler launches a LOCAL patched Chromium (no browserless dependency).
 */

import { chromium, type Browser, type Page, type BrowserContext } from "patchright";
import type { FetchResult } from "./crawlerClients.js";

// --- Header Presets (reused pattern) ---
const CHROME_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
};

export type HeaderPreset = "chrome" | undefined;

function getPresetHeaders(preset?: HeaderPreset): Record<string, string> {
  if (preset === 'chrome') return CHROME_HEADERS;
  return {};
}

// --- Stealth Crawler Options ---
export interface StealthCrawlerOptions {
  headless?: boolean;       // Default: true (new headless mode)
  waitForJs?: boolean;      // Wait for JS to finish rendering (networkidle + delay)
  waitTimeout?: number;     // Max wait time in ms (default: 30000)
  extraWaitMs?: number;     // Extra wait after networkidle (default: 3000)
  proxy?: string;           // Proxy URL
}

// --- Stealth Crawler ---
export class StealthCrawler {
  private options: Required<StealthCrawlerOptions>;

  constructor(options: StealthCrawlerOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      waitForJs: options.waitForJs ?? false,
      waitTimeout: options.waitTimeout ?? 30000,
      extraWaitMs: options.extraWaitMs ?? 3000,
      proxy: options.proxy ?? '',
    };
  }

  async fetch(
    url: string,
    headers?: Record<string, string>,
    preset?: HeaderPreset,
    responseType: "text" | "base64" = "text"
  ): Promise<FetchResult> {
    let browser: Browser | null = null;

    try {
      // Launch options
      const launchArgs = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
      ];

      const launchOptions: any = {
        headless: this.options.headless,
        args: launchArgs,
      };

      // Add proxy if configured
      if (this.options.proxy) {
        launchOptions.proxy = {
          server: this.options.proxy,
        };
      }

      // Launch patchright's patched Chromium
      browser = await chromium.launch(launchOptions);

      // Create context with realistic viewport and user agent
      const contextOptions: any = {
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
      };

      const context: BrowserContext = await browser.newContext(contextOptions);
      const page: Page = await context.newPage();

      // Apply headers
      const finalHeaders = { ...getPresetHeaders(preset), ...headers };
      if (Object.keys(finalHeaders).length > 0) {
        await page.setExtraHTTPHeaders(finalHeaders);
      }

      // Navigate with appropriate wait strategy
      // Use 'load' for waitForJs (not 'networkidle' — it hangs on sites with continuous
      // background activity like ads/analytics). 'load' + extraWaitMs is more reliable.
      const waitUntil = this.options.waitForJs ? 'load' : 'domcontentloaded';
      console.log(`[StealthCrawler] Navigating to ${url} (waitUntil: ${waitUntil}, waitForJs: ${this.options.waitForJs})`);

      const response = await page.goto(url, {
        waitUntil: waitUntil as any,
        timeout: this.options.waitTimeout,
      });

      // Extra wait for JS-rendered content
      if (this.options.waitForJs && this.options.extraWaitMs > 0) {
        console.log(`[StealthCrawler] Extra wait ${this.options.extraWaitMs}ms for JS rendering...`);
        await page.waitForTimeout(this.options.extraWaitMs);
      }

      // Get content
      const content = await page.content();
      const statusCode = response?.status() || 200;
      const responseHeaders = response?.headers() || {};
      const finalUrl = page.url();

      // Cleanup
      await context.close();

      return {
        statusCode,
        content,
        headers: responseHeaders as Record<string, string>,
        url: finalUrl,
        engineUsed: 'patchright:stealth',
        responseType,
      };

    } catch (error: any) {
      throw new Error(`StealthCrawler failed for ${url}: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }
}
