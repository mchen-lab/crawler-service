/**
 * Crawler Clients for Crawler Service
 * 
 * Provides two crawling strategies:
 * 1. FastCrawler - Uses axios with proxy support (equivalent to Python's curl_cffi)
 * 2. BrowserCrawler - Uses puppeteer-core to connect to browserless (equivalent to Python's playwright)
 */

import axios, { AxiosProxyConfig } from "axios";
import puppeteer from "puppeteer-core";

export interface FetchResult {
  statusCode: number;
  content: string;
  headers: Record<string, string>;
  url: string;
  engineUsed: string;
}

/**
 * Fast lane crawler using axios with proxy support.
 * Mimics curl_cffi behavior - fast HTTP requests without JS rendering.
 */
export class FastCrawler {
  private proxyUrl: string | null;

  constructor(proxyUrl?: string) {
    this.proxyUrl = proxyUrl || null;
  }

  async fetch(url: string): Promise<FetchResult> {
    const config: any = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true, // Don't throw on HTTP errors
    };

    // Configure proxy if provided
    if (this.proxyUrl) {
      const proxyParsed = new URL(this.proxyUrl);
      config.proxy = {
        host: proxyParsed.hostname,
        port: parseInt(proxyParsed.port) || 8080,
        protocol: proxyParsed.protocol.replace(":", ""),
      } as AxiosProxyConfig;
    }

    const response = await axios.get(url, config);

    return {
      statusCode: response.status,
      content: typeof response.data === "string" ? response.data : JSON.stringify(response.data),
      headers: response.headers as Record<string, string>,
      url: response.request?.res?.responseUrl || url,
      engineUsed: "fast",
    };
  }
}

/**
 * Browser lane crawler using puppeteer-core connected to browserless.
 * Mimics playwright behavior - full browser rendering with JS execution.
 */
export class BrowserCrawler {
  private browserlessUrl: string;
  private proxyUrl: string | null;

  constructor(browserlessUrl: string, proxyUrl?: string) {
    this.browserlessUrl = browserlessUrl;
    this.proxyUrl = proxyUrl || null;
  }

  async fetch(url: string): Promise<FetchResult> {
    let browser;
    
    try {
      // Connect to browserless instance
      browser = await puppeteer.connect({
        browserWSEndpoint: this.browserlessUrl,
      });

      const page = await browser.newPage();

      // Set user agent
      await page.setUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate to the page
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      if (!response) {
        throw new Error("No response received from page navigation");
      }

      const content = await page.content();
      const headers = response.headers();
      const finalUrl = page.url();

      await page.close();

      return {
        statusCode: response.status(),
        content,
        headers,
        url: finalUrl,
        engineUsed: "browser",
      };
    } finally {
      if (browser) {
        await browser.disconnect();
      }
    }
  }
}
