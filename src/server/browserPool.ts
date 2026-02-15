/**
 * BrowserPool — Multi-Browser Round-Robin with Tab-per-Request
 * 
 * Maintains N persistent Chrome browsers connected to Browserless.
 * Requests are distributed round-robin across browsers.
 * Each browser has its own keepalive tab and independent lifecycle.
 * 
 * Benefits:
 *   - Isolation: if one Chrome crashes, others keep working
 *   - Higher concurrency: N browsers × M tabs = N×M parallel pages
 *   - Round-robin spreads load evenly
 *   - Each browser recycles independently after MAX_TABS_BEFORE_RECYCLE
 */

import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "puppeteer";
import type { FetchResult, HeaderPreset } from "./crawlerClients.js";

// Cast to any for puppeteer-extra TS compat
const puppeteer = puppeteerExtra as any;
puppeteer.use(StealthPlugin());

// ─── Config ──────────────────────────────────────────────────────
const POOL_SIZE = 4;                    // Number of persistent browsers
const MAX_TABS_BEFORE_RECYCLE = 200;    // Recycle a browser after this many tabs

// ─── Types ───────────────────────────────────────────────────────

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

// ─── Per-Browser Instance State ──────────────────────────────────

interface BrowserSlot {
  id: number;
  browser: Browser | null;
  keepalivePage: Page | null;
  connecting: Promise<void> | null;
  activeTabCount: number;
  tabsUsed: number;
  stale: boolean;
}

// ─── BrowserPool ─────────────────────────────────────────────────

class BrowserPool {
  private slots: BrowserSlot[] = [];
  private config: BrowserPoolConfig | null = null;
  private roundRobinIndex = 0;
  private recycleCount = 0;   // Total recycles across all slots

  constructor() {
    // Initialize empty slots
    for (let i = 0; i < POOL_SIZE; i++) {
      this.slots.push({
        id: i,
        browser: null,
        keepalivePage: null,
        connecting: null,
        activeTabCount: 0,
        tabsUsed: 0,
        stale: false,
      });
    }
  }

  /**
   * Connect all browser slots. Safe to call multiple times.
   */
  async connect(config: BrowserPoolConfig): Promise<void> {
    this.config = config;
    // Pre-warm all slots in parallel
    await Promise.all(this.slots.map(slot => this._ensureSlotConnected(slot)));
  }

  /**
   * Build the WebSocket endpoint URL for Browserless.
   */
  private _buildWsEndpoint(): string {
    const config = this.config!;
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

    return wsEndpoint;
  }

  /**
   * Connect a single slot to Browserless.
   */
  private async _connectSlot(slot: BrowserSlot): Promise<void> {
    // Prevent concurrent connect races on same slot
    if (slot.connecting) {
      await slot.connecting;
      return;
    }

    const doConnect = async () => {
      try {
        const wsEndpoint = this._buildWsEndpoint();
        console.log(`[BrowserPool] Slot ${slot.id}: Connecting to Browserless...`);

        slot.browser = await puppeteer.connect({
          browserWSEndpoint: wsEndpoint,
        }) as Browser;

        // Open keepalive tab to prevent Chrome from auto-closing
        slot.keepalivePage = await slot.browser.newPage();
        await slot.keepalivePage.goto('about:blank');

        // Reset per-instance counters
        slot.tabsUsed = 0;
        slot.stale = false;

        // Listen for disconnects
        slot.browser.on('disconnected', () => {
          console.log(`[BrowserPool] Slot ${slot.id}: Browser disconnected. Will reconnect on next request.`);
          slot.browser = null;
          slot.keepalivePage = null;
          slot.stale = false;
        });

        console.log(`[BrowserPool] Slot ${slot.id}: Connected. Keepalive tab open.`);

      } catch (e: any) {
        console.error(`[BrowserPool] Slot ${slot.id}: Failed to connect: ${e.message}`);
        slot.browser = null;
        slot.keepalivePage = null;
        throw e;
      }
    };

    slot.connecting = doConnect();
    try {
      await slot.connecting;
    } finally {
      slot.connecting = null;
    }
  }

  /**
   * Ensure a slot is connected — recycle if stale, reconnect if needed.
   */
  private async _ensureSlotConnected(slot: BrowserSlot): Promise<Browser> {
    if (!this.config) {
      throw new Error('[BrowserPool] Not configured. Call connect() first.');
    }

    // Recycle if stale and no active tabs
    if (slot.stale && slot.activeTabCount === 0 && slot.browser) {
      console.log(`[BrowserPool] Slot ${slot.id}: Recycling after ${slot.tabsUsed} tabs (recycle #${this.recycleCount + 1})`);
      await this._disconnectSlot(slot);
      this.recycleCount++;
    }

    if (!slot.browser || !slot.browser.isConnected()) {
      await this._connectSlot(slot);
    }

    return slot.browser!;
  }

  /**
   * Pick the next slot using round-robin.
   */
  private _pickSlot(): BrowserSlot {
    const slot = this.slots[this.roundRobinIndex % POOL_SIZE];
    this.roundRobinIndex++;
    return slot;
  }

  /**
   * Fetch a URL using a new tab in a round-robin selected browser.
   */
  async fetchInTab(url: string, options: TabFetchOptions = {}): Promise<FetchResult> {
    const slot = this._pickSlot();
    return this._fetchInSlot(slot, url, options, true);
  }

  private async _fetchInSlot(
    slot: BrowserSlot,
    url: string, 
    options: TabFetchOptions, 
    allowRetry: boolean
  ): Promise<FetchResult> {
    const browser = await this._ensureSlotConnected(slot);
    const { headers, renderDelayMs, responseType = "text" } = options;

    let page: Page | null = null;
    slot.activeTabCount++;
    slot.tabsUsed++;

    // Mark browser as stale if tab limit reached
    if (slot.tabsUsed >= MAX_TABS_BEFORE_RECYCLE && !slot.stale) {
      console.log(`[BrowserPool] Slot ${slot.id}: Tab limit reached (${slot.tabsUsed}/${MAX_TABS_BEFORE_RECYCLE}). Will recycle when all tabs close.`);
      slot.stale = true;
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

      // Wait for JS rendering if requested
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
      if (allowRetry && (!slot.browser || !slot.browser.isConnected())) {
        console.log(`[BrowserPool] Slot ${slot.id}: Browser disconnected during fetch of ${url}. Reconnecting and retrying...`);
        page = null; // Already dead, can't close
        return this._fetchInSlot(slot, url, options, false);
      }
      throw new Error(`[BrowserPool] Slot ${slot.id}: Tab fetch failed for ${url}: ${e.message}`);
    } finally {
      // Always close the tab and decrement
      slot.activeTabCount--;
      if (page) {
        try { await page.close(); } catch {}
      }
    }
  }

  /**
   * Disconnect a single slot.
   */
  private async _disconnectSlot(slot: BrowserSlot): Promise<void> {
    if (slot.keepalivePage) {
      try { await slot.keepalivePage.close(); } catch {}
      slot.keepalivePage = null;
    }
    if (slot.browser) {
      try { await slot.browser.disconnect(); } catch {}
      slot.browser = null;
    }
  }

  /**
   * Disconnect all browsers and clean up.
   */
  async disconnect(): Promise<void> {
    await Promise.all(this.slots.map(slot => this._disconnectSlot(slot)));
    console.log('[BrowserPool] All slots disconnected.');
  }

  /** Check if all browsers are connected */
  isConnected(): boolean {
    return this.slots.every(s => s.browser && s.browser.isConnected());
  }

  /** Get total active tab count across all browsers */
  getActiveTabCount(): number {
    return this.slots.reduce((sum, s) => sum + s.activeTabCount, 0);
  }

  /** Get pool status for health checks */
  getStatus(): {
    poolSize: number;
    connectedSlots: number;
    totalActiveTabs: number;
    totalTabsUsed: number;
    recycleCount: number;
    slots: { id: number; connected: boolean; activeTabs: number; tabsUsed: number; stale: boolean }[];
  } {
    return {
      poolSize: POOL_SIZE,
      connectedSlots: this.slots.filter(s => s.browser && s.browser.isConnected()).length,
      totalActiveTabs: this.getActiveTabCount(),
      totalTabsUsed: this.slots.reduce((sum, s) => sum + s.tabsUsed, 0),
      recycleCount: this.recycleCount,
      slots: this.slots.map(s => ({
        id: s.id,
        connected: !!(s.browser && s.browser.isConnected()),
        activeTabs: s.activeTabCount,
        tabsUsed: s.tabsUsed,
        stale: s.stale,
      })),
    };
  }
}

// Export singleton instance
export const browserPool = new BrowserPool();
