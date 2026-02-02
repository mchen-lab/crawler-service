/**
 * Crawler Clients for Crawler Service
 * 
 * Provides two crawling strategies using Crawlee:
 * 1. FastCrawler - Uses HttpCrawler (internally got-scraping) for fast HTTP requests.
 * 2. BrowserCrawler - Uses PuppeteerCrawler to connect to browserless.
 */

import { HttpCrawler, PuppeteerCrawler, ProxyConfiguration, Configuration } from "crawlee";
import puppeteer from "puppeteer";

export interface FetchResult {
  statusCode: number;
  content: string;
  headers: Record<string, string>;
  url: string;
  engineUsed: string;
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

  async fetch(url: string): Promise<FetchResult> {
    let result: FetchResult | null = null;
    let error: Error | null = null;

    const proxyConfiguration = this.proxyUrl 
      ? new ProxyConfiguration({ proxyUrls: [this.proxyUrl] }) 
      : undefined;

    // Use ephemeral configuration to prevent queue persistence/deduplication across requests
    const config = new Configuration({
      persistStorage: false,
    });

    const crawler = new HttpCrawler({
      proxyConfiguration,
      // We only want to process the single request we add
      maxRequestsPerCrawl: 1,
      requestHandler: async ({ body, response, request }) => {
        result = {
          statusCode: response.statusCode || 0,
          content: body.toString(),
          headers: response.headers as Record<string, string>,
          url: response.url || request.url,
          engineUsed: "crawlee:http",
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

    await crawler.run([url]);

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

  async fetch(url: string): Promise<FetchResult> {
    let result: FetchResult | null = null;
    let error: Error | null = null;

    const proxyConfiguration = this.proxyUrl 
      ? new ProxyConfiguration({ proxyUrls: [this.proxyUrl] }) 
      : undefined;

    // Use ephemeral configuration to prevent queue persistence/deduplication across requests
    const config = new Configuration({
      persistStorage: false,
    });

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
                return await puppeteer.launch({
                    ...options,
                    headless: true,
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

    await crawler.run([url]);

    if (error) throw error;
    if (!result) throw new Error("No result from browser crawler");
    return result;
  }
}
