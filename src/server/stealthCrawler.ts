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
const MODERN_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CHROME_HEADERS: Record<string, string> = {
  'User-Agent': MODERN_CHROME_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Sec-CH-UA': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-CH-UA-Mobile': '?0',
  'Sec-CH-UA-Platform': '"macOS"',
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
  renderDelayMs?: number;   // Fixed delay after page load (when waitForJs=false)
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
      renderDelayMs: options.renderDelayMs ?? 0,
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
      // Launch options — maximally stealthy
      const launchArgs = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
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

      // Create context with realistic viewport, user agent, and permissions
      const contextOptions: any = {
        viewport: { width: 1920, height: 1080 },
        userAgent: MODERN_CHROME_UA,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
        permissions: ['geolocation'],
      };

      const context: BrowserContext = await browser.newContext(contextOptions);
      const page: Page = await context.newPage();

      // Apply headers
      const finalHeaders = { ...getPresetHeaders(preset), ...headers };
      if (Object.keys(finalHeaders).length > 0) {
        await page.setExtraHTTPHeaders(finalHeaders);
      }

      // Navigate — try networkidle first for better JS rendering, fall back to domcontentloaded
      let response;
      if (this.options.waitForJs) {
        console.log(`[StealthCrawler] Navigating to ${url} (waitUntil: load + extraWait)`);
        response = await page.goto(url, {
          waitUntil: 'load' as any,
          timeout: this.options.waitTimeout,
        });
        if (this.options.extraWaitMs > 0) {
          console.log(`[StealthCrawler] Extra wait ${this.options.extraWaitMs}ms for JS rendering...`);
          await page.waitForTimeout(this.options.extraWaitMs);
        }
      } else if (this.options.renderDelayMs > 0) {
        // Middle ground: load page, then wait a fixed delay for initial JS
        console.log(`[StealthCrawler] Navigating to ${url} (domcontentloaded + renderDelayMs: ${this.options.renderDelayMs}ms)`);
        response = await page.goto(url, {
          waitUntil: 'domcontentloaded' as any,
          timeout: this.options.waitTimeout,
        });
        await page.waitForTimeout(this.options.renderDelayMs);
      } else {
        // Try networkidle with short timeout, fall back to domcontentloaded
        console.log(`[StealthCrawler] Navigating to ${url} (trying networkidle with 10s timeout)`);
        try {
          response = await page.goto(url, {
            waitUntil: 'networkidle' as any,
            timeout: 10000,
          });
        } catch (e: any) {
          console.log(`[StealthCrawler] networkidle timed out, falling back to domcontentloaded`);
          response = await page.goto(url, {
            waitUntil: 'domcontentloaded' as any,
            timeout: this.options.waitTimeout,
          });
        }
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
