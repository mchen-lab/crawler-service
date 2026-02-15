/**
 * Crawler Clients for Crawler Service
 * 
 * Provides two crawling strategies using Crawlee:
 * 1. FastCrawler - Uses HttpCrawler (internally got-scraping) for fast HTTP requests.
 * 2. BrowserCrawler - Uses PuppeteerCrawler to connect to browserless.
 */

import { HttpCrawler, ProxyConfiguration, Configuration } from "crawlee";
import { browserPool } from "./browserPool.js";

// --- Header Presets ---

export const CHROME_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Connection': 'keep-alive',
    'Sec-Ch-Ua': '"Not;A=Brand";v="99", "Google Chrome";v="91", "Chromium";v="91"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
};

export type HeaderPreset = "chrome" | undefined;

function getPresetHeaders(preset?: HeaderPreset): Record<string, string> {
    if (preset === 'chrome') return CHROME_HEADERS;
    return {};
}

// ----------------------

export interface FetchResult {
  statusCode: number;
  content: string;
  headers: Record<string, string>;
  url: string;
  engineUsed: string;
  responseType?: "text" | "base64";
}

/**
 * Fast lane crawler using Crawlee's HttpCrawler.
 * This internally uses got-scraping for browser-like headers and anti-blocking.
 */
export class FastCrawler {
  private proxyUrl: string | null;

  constructor(proxyUrl?: string) {
    this.proxyUrl = proxyUrl || null;
  }

  async fetch(url: string, headers?: Record<string, string>, preset?: HeaderPreset, responseType: "text" | "base64" = "text"): Promise<FetchResult> {
    let result: FetchResult | null = null;
    let error: Error | null = null;

    const proxyConfiguration = this.proxyUrl 
      ? new ProxyConfiguration({ proxyUrls: [this.proxyUrl] }) 
      : undefined;

    // Use ephemeral configuration to prevent queue persistence/deduplication across requests
    const config = new Configuration({
      persistStorage: false,
    });

    const finalHeaders = { ...getPresetHeaders(preset), ...headers };

    const crawler = new HttpCrawler({
      proxyConfiguration,
      // Allow image MIME types
      additionalMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif", "application/octet-stream"],
      // We only want to process the single request we add
      maxRequestsPerCrawl: 1,
      requestHandler: async ({ body, response, request }) => {
        let content = "";
        if (responseType === "base64") {
             // Crawlee/Got passes body as Buffer
             content = (body as Buffer).toString("base64");
        } else {
             content = body.toString();
        }

        result = {
          statusCode: response.statusCode || 0,
          content,
          headers: response.headers as Record<string, string>,
          url: response.url || request.url,
          engineUsed: "crawlee:http",
          responseType,
        };
      },
      errorHandler: async ({ error: e }) => {
        // Log intermediate errors if needed
        console.error("Crawler intermediate error:", e);
      },
      failedRequestHandler: async ({ error: e }) => {
        error = e as Error;
      },
    }, config);

    // Crawlee's request options support headers
    await crawler.run([{ url, headers: finalHeaders }]);

    if (error) throw error;
    if (!result) throw new Error("No result from crawler");
    return result;
  }
}

/**
 * Browser lane crawler using persistent BrowserPool.
 * Keeps one browser connected, each request opens/closes a tab.
 */
export interface BrowserCrawlerOptions {
  stealth?: boolean;
  headless?: boolean;
}

export class BrowserCrawler {
  private browserlessUrl: string;
  private proxyUrl: string | null;
  private options: BrowserCrawlerOptions;

  constructor(browserlessUrl: string, proxyUrl?: string, options: BrowserCrawlerOptions = {}) {
    this.browserlessUrl = browserlessUrl;
    this.proxyUrl = proxyUrl || null;
    this.options = { 
      stealth: options.stealth ?? true,
      headless: options.headless ?? true 
    };
  }

  async fetch(url: string, headers?: Record<string, string>, preset?: HeaderPreset, responseType: "text" | "base64" = "text", renderDelayMs?: number): Promise<FetchResult> {
    // Ensure pool is connected (lazy init — safe to call multiple times)
    await browserPool.connect({
      browserlessUrl: this.browserlessUrl,
      proxyUrl: this.proxyUrl || undefined,
      stealth: this.options.stealth,
      headless: this.options.headless,
    });

    const finalHeaders = { ...getPresetHeaders(preset), ...headers };

    return await browserPool.fetchInTab(url, {
      headers: Object.keys(finalHeaders).length > 0 ? finalHeaders : undefined,
      renderDelayMs,
      responseType,
    });
  }
}

