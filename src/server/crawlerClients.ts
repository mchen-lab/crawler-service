/**
 * Crawler Clients for Crawler Service
 * 
 * Provides two crawling strategies using Crawlee:
 * 1. FastCrawler - Uses HttpCrawler (internally got-scraping) for fast HTTP requests.
 * 2. BrowserCrawler - Uses PuppeteerCrawler to connect to browserless.
 */

import { HttpCrawler, PuppeteerCrawler, ProxyConfiguration, Configuration } from "crawlee";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// Cast to any to avoid TS issues with NodeNext module resolution and missing types
const puppeteer = puppeteerExtra as any;

// Use stealth plugin for all puppeteer instances (local)
puppeteer.use(StealthPlugin());

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
 * Browser lane crawler using Crawlee's PuppeteerCrawler.
 * Connects to the external Browserless instance via WebSocket.
 */
export interface BrowserCrawlerOptions {
  stealth?: boolean;
  headless?: boolean;
}

export class BrowserCrawler {
  private browserlessUrl: string;
  private proxyUrl: string | null;
  private options: BrowserCrawlerOptions;

  private engineType: string = "crawlee:puppeteer:unknown";

  constructor(browserlessUrl: string, proxyUrl?: string, options: BrowserCrawlerOptions = {}) {
    this.browserlessUrl = browserlessUrl;
    this.proxyUrl = proxyUrl || null;
    this.options = { 
      stealth: options.stealth ?? true,
      headless: options.headless ?? true 
    };
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

    const crawler = new PuppeteerCrawler({
      proxyConfiguration,
      launchContext: {
        // Custom launcher to FORCE connect() but FALLBACK to launch()
        launcher: {
            launch: async (options: any) => {
                try {
                    // 1. Try connecting to browserless/remote if URL provided
                    if (this.browserlessUrl) {
                        let wsEndpoint = this.browserlessUrl;
                        const params: string[] = [];

                        if (this.proxyUrl) {
                            params.push(`--proxy-server=${encodeURIComponent(this.proxyUrl)}`);
                        }
                        if (this.options.stealth) {
                            params.push('stealth');
                        }
                        if (!this.options.headless) {
                            params.push('headless=false');
                        }

                        if (params.length > 0) {
                            const joinChar = wsEndpoint.includes('?') ? '&' : '?';
                            wsEndpoint = `${wsEndpoint}${joinChar}${params.join('&')}`;
                        }

                        console.log(`[BrowserCrawler] Connecting to remote: ${wsEndpoint}`);
                        // Use puppeteer-extra to connect (it works same as standard)
                        const browser = await puppeteer.connect({
                            ...options,
                            browserWSEndpoint: wsEndpoint,
                        });
                        this.engineType = "crawlee:browserless";
                        return browser;
                    }
                } catch (e: any) {
                    console.warn(`[BrowserCrawler] Failed to connect to ${this.browserlessUrl}, falling back to local launch. Error: ${e.message}`);
                }
                
                // 2. Fallback: Launch local Chrome (requires puppeteer package)
                console.log("[BrowserCrawler] Launching local browser...");
                this.engineType = "crawlee:local-puppeteer";
                // Use puppeteer-extra to launch (includes Stealth)
                return await puppeteer.launch({
                    ...options,
                    headless: this.options.headless ? "new" : false, // Use new headless mode
                    args: ["--no-sandbox", "--disable-setuid-sandbox"], // Safe defaults for local/docker
                });
            },
            product: "chrome",
            connect: puppeteer.connect,
            executablePath: puppeteer.executablePath,
            defaultArgs: puppeteer.defaultArgs,
        } as any,
      },
      // Important: prevent Crawlee from managing local browser processes incompatible with browserWSEndpoint
      requestHandler: async ({ page, response, request }) => {
        // Apply custom headers if provided
        if (request.headers && Object.keys(request.headers).length > 0) {
            // Puppeteer requires explicit setting of extra headers
            await page.setExtraHTTPHeaders(request.headers as Record<string, string>);
        }

        const content = await page.content();
        const headers = response?.headers() || {};
        const statusCode = response?.status() || 200;
        const finalUrl = page.url();

        result = {
          statusCode,
          content,
          headers: headers as Record<string, string>,
          url: finalUrl,
          engineUsed: this.engineType,
        };
      },
      errorHandler: async ({ error: e }) => {
          console.error("BrowserCrawler intermediate error:", e);
      },
      failedRequestHandler: async ({ error: e }) => {
        error = e as Error;
      },
    }, config);

    await crawler.run([{ url, headers: finalHeaders }]);

    if (error) throw error;
    if (!result) throw new Error("No result from browser crawler");
    return result;
  }
}
