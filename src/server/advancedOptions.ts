
import { PuppeteerCrawler, ProxyConfiguration, Configuration } from "crawlee";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { UploadServiceClient } from "@mchen-lab/service-clients";
import axios from "axios";
import FormData from "form-data";

// Cast to any to avoid TS issues with NodeNext module resolution
const puppeteer = puppeteerExtra as any;
puppeteer.use(StealthPlugin());

// --- Types ---

export interface AdvancedFetchRequest {
  url: string;
  proxy?: string;
  headers?: Record<string, string>;
  preset?: "chrome";
  format?: "html" | "markdown" | "html-stripped";
  
  // Advanced Options
  jsAction?: string; // JavaScript to execute after load
  apiPatterns?: string[]; // Regex patterns for API URLs to capture
  imagesToDownload?: string[]; // Image URLs to download using the browser context
  
  // Upload Config (target for downloaded images)
  uploadConfig?: {
    baseUrl: string;
    apiKey: string;
    bucket: string;
  };
}

export interface ApiCall {
  url: string;
  method: string;
  status: number;
  responseBody?: any; // JSON or string
  timestamp: number;
}

export interface ResourceResult {
  originalUrl: string;
  status: "success" | "error";
  uploadedUrl?: string; // URL from uploader-service
  error?: string;
  mimeType?: string;
  size?: number;
}

export interface AdvancedFetchResult {
  statusCode: number;
  content: string; // HTML
  markdown?: string; // Markdown content
  headers: Record<string, string>;
  url: string;
  engineUsed: string;
  
  // Advanced Results
  apiCalls?: ApiCall[];
  resources?: ResourceResult[];
}

// --- Header Presets (Reused) ---
const CHROME_HEADERS = {
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

function getPresetHeaders(preset?: "chrome"): Record<string, string> {
    if (preset === 'chrome') return CHROME_HEADERS;
    return {};
}

// --- API Capture Logic ---
class ApiCapture {
    patterns: RegExp[];
    captured: ApiCall[] = [];

    constructor(patterns: string[]) {
        this.patterns = patterns.map(p => new RegExp(p));
    }

    shouldCapture(url: string): boolean {
        return this.patterns.some(p => p.test(url));
    }

    async handleResponse(response: any) {
        const url = response.url();
        if (this.shouldCapture(url)) {
            let body = null;
            try {
                // Try JSON first, then text
                try {
                    body = await response.json();
                } catch {
                    body = await response.text();
                }
            } catch (e) {
                // Keep body null if failed
            }

            this.captured.push({
                url,
                method: response.request().method(),
                status: response.status(),
                responseBody: body,
                timestamp: Date.now()
            });
        }
    }
}

// --- Advanced Crawler ---

export class AdvancedCrawler {
    private browserlessUrl: string;
    private proxyUrl: string | null;
    private options: { stealth: boolean; headless: boolean };
    private engineType = "crawlee:puppeteer:advanced";

    constructor(browserlessUrl: string, proxyUrl?: string, options: { stealth?: boolean; headless?: boolean } = {}) {
        this.browserlessUrl = browserlessUrl;
        this.proxyUrl = proxyUrl || null;
        this.options = {
            stealth: options.stealth ?? true,
            headless: options.headless ?? true
        };
    }

    async fetch(request: AdvancedFetchRequest): Promise<AdvancedFetchResult> {
        let result: AdvancedFetchResult | null = null;
        let error: Error | null = null;

        const proxyConfiguration = this.proxyUrl 
            ? new ProxyConfiguration({ proxyUrls: [this.proxyUrl] }) 
            : undefined;

        const config = new Configuration({ persistStorage: false });
        const finalHeaders = { ...getPresetHeaders(request.preset), ...request.headers };

        // State for capture
        const apiCapture = request.apiPatterns ? new ApiCapture(request.apiPatterns) : null;
        let downloadedResources: ResourceResult[] = [];

        const crawler = new PuppeteerCrawler({
            proxyConfiguration,
            launchContext: {
                // Same custom launcher logic as BrowserCrawler
                launcher: {
                    launch: async (options: any) => {
                        // 1. Try Remote
                        if (this.browserlessUrl) {
                            try {
                                let wsEndpoint = this.browserlessUrl;
                                const params: string[] = [];
                                if (this.proxyUrl) params.push(`--proxy-server=${encodeURIComponent(this.proxyUrl)}`);
                                if (this.options.stealth) params.push('stealth');
                                if (!this.options.headless) params.push('headless=false');
                                
                                if (params.length > 0) {
                                    wsEndpoint += (wsEndpoint.includes('?') ? '&' : '?') + params.join('&');
                                }

                                console.log(`[AdvancedCrawler] Connecting to: ${wsEndpoint}`);
                                return await puppeteer.connect({ ...options, browserWSEndpoint: wsEndpoint });
                            } catch (e: any) {
                                console.warn(`[AdvancedCrawler] Remote connection failed: ${e.message}`);
                            }
                        }
                        // 2. Fallback Local
                        console.log("[AdvancedCrawler] Launching local browser...");
                        return await puppeteer.launch({
                            ...options,
                            headless: this.options.headless ? "new" : false,
                            args: ["--no-sandbox", "--disable-setuid-sandbox"],
                        });
                    },
                    product: "chrome",
                    connect: puppeteer.connect,
                    executablePath: puppeteer.executablePath,
                    defaultArgs: puppeteer.defaultArgs,
                } as any,
            },
            preNavigationHooks: [
                async ({ page }) => {
                    await page.setCacheEnabled(false);
                    // Setup API Capture
                    if (apiCapture) {
                        page.on('response', (resp) => apiCapture.handleResponse(resp));
                    }
                    // Apply Headers
                    if (Object.keys(finalHeaders).length > 0) {
                        await page.setExtraHTTPHeaders(finalHeaders);
                    }
                }
            ],
            requestHandler: async ({ page, response }) => {
                // 1. JS Injection
                if (request.jsAction) {
                    try {
                        console.log("[AdvancedCrawler] Executing custom JS");
                        await page.evaluate(request.jsAction);
                        // Wait a bit for JS effects (simple implicit wait)
                        await new Promise(r => setTimeout(r, 2000));
                    } catch (e: any) {
                        console.error(`[AdvancedCrawler] JS Execution failed: ${e.message}`);
                    }
                }

                // 2. Basic Content
                const content = await page.content();
                const headers = response?.headers() || {};
                const statusCode = response?.status() || 200;

                // 3. Image Downloading (Option 1: New Page in Context)
                if (request.imagesToDownload && request.imagesToDownload.length > 0) {
                    console.log(`[AdvancedCrawler] Downloading ${request.imagesToDownload.length} images...`);
                    const context = page.browserContext();
                    
                    // Process sequentially for safety, or batches
                    for (const imgUrl of request.imagesToDownload) {
                        let pageRef: any = null;
                        try {
                            pageRef = await context.newPage();
                            await pageRef.setCacheEnabled(false);
                            // Pass headers to image request too? Maybe not fully needed if cookies are shared, but good practice.
                            // Only if they are safe (don't override Accept unnecessarily, but Referer might be needed)
                            
                            // Go to image
                            const view = await pageRef.goto(imgUrl, { timeout: 30000, waitUntil: 'domcontentloaded' });
                            if (view && view.status() === 200) {
                                const buffer = await view.buffer();
                                const mimeType = view.headers()['content-type'] || 'application/octet-stream';
                                
                                // Upload Logic
                                let uploadedUrl = undefined;
                                if (request.uploadConfig) {
                                    uploadedUrl = await this.uploadImage(buffer, imgUrl, request.uploadConfig);
                                }

                                downloadedResources.push({
                                    originalUrl: imgUrl,
                                    status: "success",
                                    mimeType,
                                    size: buffer.length,
                                    uploadedUrl
                                });
                            } else {
                                downloadedResources.push({
                                    originalUrl: imgUrl,
                                    status: "error",
                                    error: `Status ${view?.status()}`
                                });
                            }
                        } catch (e: any) {
                            downloadedResources.push({
                                originalUrl: imgUrl,
                                status: "error",
                                error: e.message
                            });
                        } finally {
                            if (pageRef) await pageRef.close().catch(() => {});
                        }
                    }
                }

                result = {
                    statusCode,
                    content,
                    headers: headers as Record<string, string>,
                    url: page.url(),
                    engineUsed: this.engineType,
                    apiCalls: apiCapture?.captured,
                    resources: downloadedResources
                };
            },
            failedRequestHandler: async ({ error: e }) => { error = e as Error; }
        }, config);

        await crawler.run([{ url: request.url }]);

        if (error) throw error;
        if (!result) throw new Error("No result from advanced crawler");
        return result;
    }

    private async uploadImage(buffer: Buffer, originalUrl: string, config: { baseUrl: string, apiKey: string, bucket: string }): Promise<string | undefined> {
        try {
            // Manual axios upload since we might not have the full client setup or to verify direct functionality
            const formData = new FormData();
            
            // Generate filename
            const ext = originalUrl.split('.').pop()?.split('?')[0] || 'jpg';
            const filename = `crawl_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
            
            formData.append("files", buffer, filename);

            const uploadUrl = `${config.baseUrl}/api/files/${config.bucket}/upload`;
            const response = await axios.post(uploadUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'X-API-Key': config.apiKey
                }
            });

            if (response.data && response.data.files && response.data.files.length > 0) {
                return response.data.files[0].urls.original;
            }
        } catch (e: any) {
            console.error(`[AdvancedCrawler] Upload failed for ${originalUrl}: ${e.message}`);
        }
        return undefined;
    }
}
