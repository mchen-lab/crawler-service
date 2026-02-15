/**
 * BrowserPool — Persistent Browser with Tab-per-Request
 * 
 * Keeps ONE browser connected to Browserless (or local Chrome).
 * Each fetch request opens a new tab, navigates, gets content, and closes the tab.
 * A "keepalive" tab (about:blank) stays open to prevent the browser from auto-closing.
 * 
 * Benefits:
 *   - No per-request WebSocket connect overhead (~1.5s saved per request)
 *   - Supports concurrent requests via parallel tabs
 *   - Auto-reconnects if browser disconnects
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import type { FetchResult, HeaderPreset } from "./crawlerClients.js";

// Cast to any for puppeteer-extra TS compat
const puppeteer = puppeteerExtra as any;
puppeteer.use(StealthPlugin());

// ─── Types ────────────────────────────────────────────────────

export interface BrowserPoolConfig {
  browserlessUrl: string;
  proxyUrl?: string;
  stealth?: boolean;
  headless?: boolean;
}

export interface TabFetchOptions {
  headers?: Record<string, string>;
  preset?: HeaderPreset;
  responseType?: "text" | "base64";
  renderDelayMs?: number;
}

// ─── BrowserPool Singleton ────────────────────────────────────

// Maximum tabs before recycling the browser to prevent Chrome memory bloat
const MAX_TABS_BEFORE_RECYCLE = 200;

class BrowserPool {
  private browser: Browser | null = null;
  private keepalivePage: Page | null = null;
  private config: BrowserPoolConfig | null = null;
  private connecting: Promise<void> | null = null;
  private activeTabCount = 0;
  private tabsUsed = 0;       // Total tabs opened on current browser instance
  private recycleCount = 0;   // How many times browser has been recycled
  private stale = false;      // Marked true when tabsUsed >= MAX_TABS_BEFORE_RECYCLE

  /**
   * Connect to browserless (or launch local browser).
   * Safe to call multiple times — only connects once.
   */
  async connect(config: BrowserPoolConfig): Promise<void> {
    this.config = config;

    // If already connected, skip
    if (this.browser && this.browser.isConnected()) {
      return;
    }

    // Prevent concurrent connect races
    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = this._doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async _doConnect(): Promise<void> {
    const config = this.config!;

    try {
      // Build the WebSocket endpoint URL
      let wsEndpoint = config.browserlessUrl;

      if (config.stealth !== false) {
        wsEndpoint = wsEndpoint.replace(/\/?$/, '/chrome/stealth');
      }

      const params: string[] = [];

      if (config.proxyUrl) {
        params.push(`--proxy-server=${encodeURIComponent(config.proxyUrl)}`);
      }

      const launchOpts = {
        headless: config.headless !== false ? 'new' : false,
        args: [
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
        ]
      };
      params.push(`launch=${encodeURIComponent(JSON.stringify(launchOpts))}`);

      if (params.length > 0) {
        const joinChar = wsEndpoint.includes('?') ? '&' : '?';
        wsEndpoint = `${wsEndpoint}${joinChar}${params.join('&')}`;
      }

      console.log(`[BrowserPool] Connecting to: ${wsEndpoint}`);
      this.browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
      }) as Browser;

      // Open a keepalive tab so the browser doesn't auto-close when all other tabs close
      this.keepalivePage = await this.browser.newPage();
      await this.keepalivePage.goto('about:blank');

      // Reset per-instance counters
      this.tabsUsed = 0;
      this.stale = false;

      // Listen for disconnects to auto-reconnect on next request
      this.browser.on('disconnected', () => {
        console.log('[BrowserPool] Browser disconnected. Will reconnect on next request.');
        this.browser = null;
        this.keepalivePage = null;
        this.stale = false;
      });

      console.log('[BrowserPool] Connected successfully. Keepalive tab open.');

    } catch (e: any) {
      console.error(`[BrowserPool] Failed to connect to Browserless: ${e.message}`);
      console.log('[BrowserPool] Will retry on next request.');
      this.browser = null;
      this.keepalivePage = null;
      throw e;
    }
  }

  /**
   * Ensure browser is connected — auto-reconnect if needed.
   */
  private async ensureConnected(): Promise<Browser> {
    if (!this.config) {
      throw new Error('[BrowserPool] Not configured. Call connect() first.');
    }

    // Recycle browser if stale (tab limit reached) and no active tabs
    if (this.stale && this.activeTabCount === 0 && this.browser) {
      console.log(`[BrowserPool] Recycling browser after ${this.tabsUsed} tabs (recycle #${this.recycleCount + 1})`);
      await this.disconnect();
      this.recycleCount++;
    }

    if (!this.browser || !this.browser.isConnected()) {
      console.log('[BrowserPool] Reconnecting...');
      await this.connect(this.config);
    }

    return this.browser!;
  }

  /**
   * Fetch a URL using a new tab in the persistent browser.
   * Opens tab → navigates → gets content → closes tab.
   * Auto-reconnects and retries once if browser disconnects mid-fetch.
   */
  async fetchInTab(url: string, options: TabFetchOptions = {}): Promise<FetchResult> {
    return this._fetchInTabInternal(url, options, true);
  }

  private async _fetchInTabInternal(
    url: string, 
    options: TabFetchOptions, 
    allowRetry: boolean
  ): Promise<FetchResult> {
    const browser = await this.ensureConnected();
    const { headers, renderDelayMs, responseType = "text" } = options;

    let page: Page | null = null;
    this.activeTabCount++;
    this.tabsUsed++;

    // Mark browser as stale if tab limit reached
    if (this.tabsUsed >= MAX_TABS_BEFORE_RECYCLE && !this.stale) {
      console.log(`[BrowserPool] Tab limit reached (${this.tabsUsed}/${MAX_TABS_BEFORE_RECYCLE}). Will recycle when all tabs close.`);
      this.stale = true;
    }

    try {
      // Open new tab
      page = await browser.newPage();

      // Apply headers
      if (headers && Object.keys(headers).length > 0) {
        await page.setExtraHTTPHeaders(headers);
      }

      // Navigate to URL
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for JS rendering if requested (e.g., for JS redirects)
      if (renderDelayMs && renderDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, renderDelayMs));
      }

      // Get content
      const content = await page.content();
      const statusCode = response?.status() || 200;
      const responseHeaders = response?.headers() || {};
      const finalUrl = page.url();

      return {
        statusCode,
        content,
        headers: responseHeaders as Record<string, string>,
        url: finalUrl,
        engineUsed: "crawlee:browserless",
        responseType,
      };

    } catch (e: any) {
      // If browser disconnected during this fetch, reconnect and retry once
      if (allowRetry && (!this.browser || !this.browser.isConnected())) {
        console.log(`[BrowserPool] Browser disconnected during fetch of ${url}. Reconnecting and retrying...`);
        page = null; // Already dead, can't close
        return this._fetchInTabInternal(url, options, false);
      }
      throw new Error(`[BrowserPool] Tab fetch failed for ${url}: ${e.message}`);
    } finally {
      // Always close the tab
      this.activeTabCount--;
      if (page) {
        try { await page.close(); } catch {}
      }
    }
  }

  /**
   * Disconnect from browser and clean up.
   */
  async disconnect(): Promise<void> {
    if (this.keepalivePage) {
      try { await this.keepalivePage.close(); } catch {}
      this.keepalivePage = null;
    }
    if (this.browser) {
      try { await this.browser.disconnect(); } catch {}
      this.browser = null;
    }
    console.log('[BrowserPool] Disconnected.');
  }

  /** Check if browser is connected */
  isConnected(): boolean {
    return !!(this.browser && this.browser.isConnected());
  }

  /** Get active tab count (for monitoring) */
  getActiveTabCount(): number {
    return this.activeTabCount;
  }

  /** Get pool status for health checks */
  getStatus(): { connected: boolean; activeTabs: number; tabsUsed: number; recycleCount: number; stale: boolean } {
    return {
      connected: this.isConnected(),
      activeTabs: this.activeTabCount,
      tabsUsed: this.tabsUsed,
      recycleCount: this.recycleCount,
      stale: this.stale,
    };
  }
}

// Export singleton instance
export const browserPool = new BrowserPool();
