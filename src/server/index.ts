import { createApp } from "@mchen-lab/app-kit/backend";
import { createServer } from "http";
import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import { FastCrawler, BrowserCrawler, type FetchResult } from "./crawlerClients.js";
import { browserPool } from "./browserPool.js";
import { AdvancedCrawler, type AdvancedFetchRequest } from "./advancedOptions.js";
import { StealthCrawler } from "./stealthCrawler.js";
import { initializeDatabase } from "./db/database.js";
import { extractDomain, getProfile, upsertProfile, incrementHitCount, deleteProfile, getAllProfiles, type DomainProfileInput } from "./db/domainProfileRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load OpenAPI spec (once at startup, non-fatal if missing)
let openapiSpec: Record<string, unknown> = {};
try {
  const candidates = [
    path.resolve(__dirname, "../../openapi.json"),   // from src/server/
    path.resolve(process.cwd(), "openapi.json"),     // from project root
    path.resolve(__dirname, "../../../openapi.json"), // from dist/server/
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      openapiSpec = JSON.parse(fs.readFileSync(p, "utf-8"));
      console.log(`📄 Loaded OpenAPI spec from ${p}`);
      break;
    }
  }
  if (!openapiSpec.openapi) console.warn("⚠️  OpenAPI spec not found at any candidate path");
} catch (err) {
  console.warn(`⚠️  Failed to load OpenAPI spec: ${(err as Error).message}`);
}

// =============================================================================
// Config Types
// =============================================================================

interface GlobalConfig {
  browserlessUrl: string;
  proxyUrl: string;
  defaultEngine: "auto" | "fast" | "browser" | "stealth";
  browserStealth: boolean;
  browserHeadless: boolean;
}

const defaultConfig: GlobalConfig = {
  browserlessUrl: process.env.BROWSERLESS_URL || "ws://localhost:3000",
  proxyUrl: process.env.PROXY_URL || "http://localhost:31131",
  defaultEngine: "auto",
  browserStealth: true,
  browserHeadless: true,
};

// Initialize AppKit
const appKit = createApp({
  appName: "Crawler Service",
  defaultConfig: defaultConfig,
  disableStatic: true,
});

const app = appKit.app;
let globalConfig = appKit.config as GlobalConfig;

// Environment Variables
const PORT = process.env.PORT || 31171;
const startTime = Date.now();
const isProduction = process.env.NODE_ENV === "production";

// Version info from build
const VERSION = 'v' + (process.env.npm_package_version || "0.1.0") + (process.env.BUILD_METADATA || "");
const GIT_COMMIT = process.env.GIT_COMMIT || "";
const LOGS_DIR = appKit.getLogsDir();
const LOG_FILE_PATH = path.resolve(LOGS_DIR, "app.log");

// =============================================================================
// Logging Infrastructure
// =============================================================================

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  success?: boolean;
}

const logs: LogEntry[] = [];
const MAX_LOGS = 500;
const wsClients: Set<WebSocket> = new Set();

function addLog(level: string, message: string, success?: boolean) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    success,
  };
  
  logs.push(entry);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }

  const wsMessage = JSON.stringify({ type: "log", data: entry });
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(wsMessage);
    }
  });

  try {
    const logLine = `[${entry.timestamp}] [${entry.level}] ${entry.message}\n`;
    fs.appendFileSync(LOG_FILE_PATH, logLine);
  } catch (err) { }
}

export const logger = {
  info: (msg: string) => addLog("INFO", msg),
  warn: (msg: string) => addLog("WARN", msg),
  error: (msg: string) => addLog("ERROR", msg),
  debug: (msg: string) => addLog("DEBUG", msg),
  success: (msg: string) => addLog("INFO", msg, true),
  fail: (msg: string) => addLog("ERROR", msg, false),
};

// =============================================================================
// API Routes
// =============================================================================

// OpenAPI Spec
app.get("/api/openapi.json", (_req: Request, res: Response) => res.json(openapiSpec));

// Status API
async function checkBrowserConnection(wsUrl: string): Promise<boolean> {
  try {
    // Convert ws:// to http:// for health check
    // Browserless typically exposes GET / or GET /sessions on the same port
    const httpUrl = wsUrl.replace(/^ws/, "http");
    
    // We'll use a short timeout to avoid hanging the status check
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1000);
    
    // Check root or a lightweight endpoint. Browserless often has /metrics or just /
    const res = await fetch(httpUrl, { 
      method: 'GET',
      signal: controller.signal 
    });
    
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

app.get("/api/status", async (_req: Request, res: Response) => {
  const browserConnected = await checkBrowserConnection(globalConfig.browserlessUrl);
  const poolStatus = browserPool.getStatus();
  
  res.json({
    status: "operational",
    activeRequests: 0,
    browserConnected,
    browserPool: poolStatus,
    uptime: (Date.now() - startTime) / 1000,
    timestamp: new Date().toISOString(),
  });
});

// Version API
app.get("/api/version", (_req: Request, res: Response) => {
  res.json({
    version: VERSION,
    commit: GIT_COMMIT,
  });
});

// Config API - Get current configuration
app.get("/api/config", (_req: Request, res: Response) => {
  res.json({
    browserlessUrl: globalConfig.browserlessUrl,
    proxyUrl: globalConfig.proxyUrl,
    defaultEngine: globalConfig.defaultEngine,
    browserStealth: globalConfig.browserStealth,
    browserHeadless: globalConfig.browserHeadless,
  });
});

// Config API - Update configuration
app.post("/api/config", async (req: Request, res: Response) => {
  try {
    const { browserlessUrl, proxyUrl, defaultEngine, browserStealth, browserHeadless } = req.body;
    
    if (browserlessUrl !== undefined) globalConfig.browserlessUrl = browserlessUrl;
    if (proxyUrl !== undefined) globalConfig.proxyUrl = proxyUrl;
    if (defaultEngine !== undefined) globalConfig.defaultEngine = defaultEngine;
    if (browserStealth !== undefined) globalConfig.browserStealth = browserStealth;
    if (browserHeadless !== undefined) globalConfig.browserHeadless = browserHeadless;
    
    await appKit.saveConfig();
    logger.info("Configuration updated");
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to update config: ${error}`);
    res.status(500).json({ error: "Failed to update config" });
  }
});

// Health API
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "healthy",
    browserlessUrl: globalConfig.browserlessUrl,
    proxyUrl: globalConfig.proxyUrl,
  });
});

// Logs API
app.get("/api/logs", (_req: Request, res: Response) => {
  res.json({ logs });
});

app.delete("/api/logs", (_req: Request, res: Response) => {
  logs.length = 0;
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.writeFileSync(LOG_FILE_PATH, "");
    }
  } catch (err) { }
  res.json({ success: true });
});

// =============================================================================
// Main Fetch API - Core Crawler Endpoint
// =============================================================================




async function start() {
  await appKit.initialize();
  globalConfig = appKit.config as GlobalConfig;

  // Initialize crawler database (domain profiles)
  initializeDatabase();

  // ---------------------------------------------------------------------------
  // Main Server (UI + API) - Port 31170
  // ---------------------------------------------------------------------------
  const mainPort = parseInt(process.env.PORT || "31170", 10);
  const mainServer = createServer(app);

  // WebSocket server for real-time logs (attached to main server)
  const wss = new WebSocketServer({ server: mainServer, path: "/ws/logs" });
  wss.on("connection", (ws: WebSocket) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: "history", data: logs }));
    ws.on("close", () => wsClients.delete(ws));
  });

  // Frontend Serving Logic
  if (isProduction) {
    const distPath = path.join(__dirname, "../../dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    try {
      const vite = await import("vite");
      const frontendDir = path.resolve(__dirname, "../frontend");
      const viteServer = await vite.createServer({
        server: { 
          middlewareMode: true,
          hmr: { server: mainServer }
        },
        appType: "spa",
        root: frontendDir,
        configFile: path.resolve(frontendDir, "../../vite.config.ts"),
      });

      app.use((req, res, next) => {
        if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
          return next();
        }
        viteServer.middlewares(req, res, next);
      });
      
      console.log("🔥 Hot reload enabled via Vite Middleware");
    } catch (e) {
      console.error("Failed to start Vite middleware", e);
    }
  }

  mainServer.listen(mainPort, "0.0.0.0", () => {
    console.log(`🚀 Main Server running on http://localhost:${mainPort}`);
    logger.info(`Main Server started on port ${mainPort}`);
  });

  // ---------------------------------------------------------------------------
  // Crawler API Server - Port 31171 (Dedicated)
  // ---------------------------------------------------------------------------
  const crawlerApiPort = parseInt(process.env.CRAWLER_API_PORT || "31171", 10);
  const crawlerApp = express();
  
  // Enable JSON body parsing for the crawler app
  crawlerApp.use(express.json());
  
  // Share the same fetch logic, but mount it on the dedicated app
  crawlerApp.post("/api/fetch", async (req: Request, res: Response) => {
    // We reuse the existing logic by forwarding the request or extracting the handler
    // Ideally, we should refactor the handler to a separate function.
    // For now, let's just invoke the main app handler logic via internal call or duplicate the route registration.
    // To keep it clean, let's extract the handler.
    
    // (See below for handler extraction implementation)
    // (See below for handler extraction implementation)
    await handleFetchRequest(req, res);
  });

  crawlerApp.post("/api/fetch/advanced", async (req: Request, res: Response) => {
      await handleAdvancedFetchRequest(req, res);
  });

  // OpenAPI spec on dedicated crawler API
  crawlerApp.get("/api/openapi.json", (_req, res) => res.json(openapiSpec));

  // Health check for crawler service
  crawlerApp.get("/health", (_req, res) => res.json({ status: "ok", type: "crawler-api" }));

  // Domain profile routes on dedicated API port
  crawlerApp.get("/api/domain-profiles", (_req, res) => {
    try { res.json({ success: true, profiles: getAllProfiles() }); }
    catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
  });
  crawlerApp.get("/api/domain-profiles/:domain", (req, res) => {
    const profile = getProfile(req.params.domain);
    if (!profile) { res.status(404).json({ success: false, error: "Not found" }); return; }
    res.json({ success: true, profile });
  });
  crawlerApp.post("/api/domain-profiles", (req, res) => {
    const { domain, engine, renderJs, renderDelayMs, preset } = req.body;
    if (!domain || !engine) { res.status(400).json({ success: false, error: "domain and engine required" }); return; }
    const profile = upsertProfile(domain, { engine, renderJs: renderJs ?? false, renderDelayMs: renderDelayMs ?? 0, preset: preset ?? null });
    res.json({ success: true, profile });
  });
  crawlerApp.delete("/api/domain-profiles/:domain", (req, res) => {
    const deleted = deleteProfile(req.params.domain);
    if (!deleted) { res.status(404).json({ success: false, error: "Not found" }); return; }
    res.json({ success: true });
  });

  crawlerApp.listen(crawlerApiPort, "0.0.0.0", () => {
    console.log(`🕷️ Crawler API Server running on http://localhost:${crawlerApiPort}`);
    logger.info(`Crawler API Server started on port ${crawlerApiPort}`);
  });

  // Pre-warm browser pool connection (non-blocking)
  if (globalConfig.browserlessUrl) {
    browserPool.connect({
      browserlessUrl: globalConfig.browserlessUrl,
      proxyUrl: globalConfig.proxyUrl,
      stealth: globalConfig.browserStealth,
      headless: globalConfig.browserHeadless,
    }).then(() => {
      console.log('🌐 Browser pool pre-warmed and ready');
    }).catch((e) => {
      console.warn(`⚠️ Browser pool pre-warm failed (will retry on first request): ${e.message}`);
    });
  }
}

// Markdown Utility
import { htmlToMarkdown, extractMainContent } from "./markdown.js";

// ...

interface FetchRequest {
  url: string;
  engine?: "auto" | "fast" | "browser" | "stealth";
  renderJs?: boolean;
  waitForJs?: boolean;
  renderDelayMs?: number;
  proxy?: string;
  headers?: Record<string, string>;
  preset?: "chrome";
  format?: "html" | "markdown" | "html-stripped";
  responseType?: "text" | "base64";
}

function processContentFormat(content: string, url: string, format?: string): { content: string, markdown?: string } {
    let finalContent = content;
    let finalMarkdown: string | undefined;

    if (format === "markdown") {
        try {
            finalMarkdown = htmlToMarkdown(content, url);
        } catch (e) {
            logger.error(`Markdown conversion failed: ${e}`);
        }
    } else if (format === "html-stripped") {
        try {
             // Extract main content (stripped HTML)
             const extracted = extractMainContent(content, url);
             if (extracted) {
                 finalContent = extracted.content;
             }
        } catch (e) {
             logger.error(`Stripped HTML conversion failed: ${e}`);
        }
    }

    return { content: finalContent, markdown: finalMarkdown };
}

// =============================================================================
// Content Quality Heuristics (for auto-retry escalation)
// =============================================================================

/** Check if fetched content looks like a real page vs an empty JS shell */
function isContentSufficient(content: string, statusCode: number): boolean {
  // Reject non-200 status codes that indicate blocking
  if (statusCode === 403 || statusCode === 429 || statusCode === 503) {
    return false;
  }

  // Too short — likely a JS shell or error page
  if (content.length < 500) {
    return false;
  }

  // Common SPA shell patterns (empty root container)
  const spaShellPatterns = [
    /<div\s+id=["'](?:root|app|__next|__nuxt)["']\s*>\s*<\/div>/i,
    /<body[^>]*>\s*<noscript>/i,
  ];
  for (const pattern of spaShellPatterns) {
    if (pattern.test(content)) {
      // If this pattern is found AND the content is short, it's a shell
      if (content.length < 2000) {
        return false;
      }
    }
  }

  // Positive signal: if we have decent text content, it's probably good
  // Count text-bearing tags as a proxy for real rendered content
  const textTagCount = (content.match(/<(p|h[1-6]|li|td|span|a|div)[^>]*>[^<]{10,}/gi) || []).length;
  if (textTagCount >= 3 && content.length >= 1000) {
    return true;
  }

  // If content is long enough (>5KB), accept it even without strong positive signals
  if (content.length > 5000) {
    return true;
  }

  // For shorter content (500-5000 chars), require at least some structural HTML
  const hasStructure = /<(table|ul|ol|article|section|main|header)/i.test(content);
  if (hasStructure) {
    return true;
  }

  // Default: accept anything above 500 chars (already passed the shell check)
  return true;
}

/** Run a single fetch attempt with given config */
async function attemptFetch(
  url: string,
  engineType: "fast" | "browser" | "stealth",
  options: {
    proxy: string;
    headers?: Record<string, string>;
    preset?: "chrome";
    responseType?: "text" | "base64";
    renderJs?: boolean;
    waitForJs?: boolean;
    renderDelayMs?: number;
  }
): Promise<FetchResult> {
  if (engineType === "stealth") {
    const crawler = new StealthCrawler({
      headless: globalConfig.browserHeadless,
      waitForJs: options.waitForJs ?? false,
      renderDelayMs: options.renderDelayMs ?? 2000,
      proxy: options.proxy,
    });
    return await crawler.fetch(url, options.headers, options.preset, options.responseType);
  } else if (engineType === "browser") {
    const crawler = new BrowserCrawler(globalConfig.browserlessUrl, options.proxy);
    return await crawler.fetch(url, options.headers, options.preset, options.responseType, options.renderDelayMs);
  } else {
    const crawler = new FastCrawler(options.proxy);
    return await crawler.fetch(url, options.headers, options.preset, options.responseType);
  }
}

/**
 * Attempt to unblock a URL using Browserless's /chrome/unblock REST API.
 * This is the nuclear option — Browserless handles CAPTCHA solving,
 * Cloudflare bypass, and full anti-bot measures internally.
 */
async function attemptUnblock(url: string): Promise<FetchResult> {
  const browserlessUrl = globalConfig.browserlessUrl;
  if (!browserlessUrl) {
    throw new Error('Browserless URL not configured, cannot use unblock');
  }

  // Convert ws:// to http:// for the REST API
  const httpBase = browserlessUrl
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/\/?$/, '');
  const unblockUrl = `${httpBase}/chrome/unblock`;

  logger.info(`[unblock] Calling Browserless unblock API: ${unblockUrl} for ${url}`);

  const response = await fetch(unblockUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      bestAttempt: true,
      content: true,
      cookies: false,
      screenshot: false,
      waitForTimeout: 5000,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'unknown error');
    throw new Error(`Unblock API returned ${response.status}: ${text}`);
  }

  const data = await response.json() as { content?: string; cookies?: any[] };
  const content = data.content || '';

  return {
    statusCode: 200,
    content,
    headers: {},
    url,
    engineUsed: 'browserless:unblock',
    responseType: 'text',
  };
}

// =============================================================================
// Auto-Retry Escalation Pipeline
// =============================================================================

/** Escalation chain: each step specifies engine + proxy preference */
interface EscalationStep {
  engine: "fast" | "browser" | "stealth" | "unblock";
  renderJs: boolean;
  renderDelayMs: number;
  useProxy: boolean;
  label: string;
}

/**
 * Build the available escalation chain based on current config.
 * Proxy is treated as a variable — we try with proxy first, then without.
 */
function getAvailableEscalationChain(): EscalationStep[] {
  const hasProxy = !!globalConfig.proxyUrl;
  const hasBrowserless = !!globalConfig.browserlessUrl;

  const chain: EscalationStep[] = [];

  // Step 1: Fast + proxy (if proxy configured)
  if (hasProxy) {
    chain.push({ engine: "fast", renderJs: false, renderDelayMs: 0, useProxy: true, label: "Fast + Proxy" });
  }
  // Step 2: Fast + direct
  chain.push({ engine: "fast", renderJs: false, renderDelayMs: 0, useProxy: false, label: "Fast + Direct" });

  if (hasBrowserless) {
    // Step 3: Browser stealth + direct
    chain.push({ engine: "browser", renderJs: true, renderDelayMs: 2000, useProxy: false, label: "Browser Stealth + Direct" });
    // Step 4: Patchright stealth + direct (3s)
    chain.push({ engine: "stealth", renderJs: true, renderDelayMs: 3000, useProxy: false, label: "Patchright Stealth 3s + Direct" });
    // Step 5: Patchright stealth + direct (5s)
    chain.push({ engine: "stealth", renderJs: true, renderDelayMs: 5000, useProxy: false, label: "Patchright Stealth 5s + Direct" });
    // Step 6: Browserless unblock (nuclear)
    chain.push({ engine: "unblock", renderJs: true, renderDelayMs: 0, useProxy: false, label: "Browserless Unblock (nuclear)" });
  } else {
    // Patchright still works without Browserless
    chain.push({ engine: "stealth", renderJs: true, renderDelayMs: 3000, useProxy: false, label: "Patchright Stealth 3s + Direct" });
  }

  return chain;
}

async function handleFetchRequest(req: Request, res: Response) {
  const { url, engine = "auto", renderJs = false, waitForJs = false, renderDelayMs = 0, proxy, headers, preset, format = "html", responseType = "text" } = req.body as FetchRequest;

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  const targetProxy = proxy || globalConfig.proxyUrl;
  const domain = extractDomain(url);

  try {
    let result: FetchResult;

    // ─── Explicit engine override (non-auto) ──────────────────────────────
    if (engine !== "auto") {
      logger.info(`[explicit] engine=${engine}, url=${url}`);
      result = await attemptFetch(url, engine, {
        proxy: targetProxy,
        headers, preset, responseType,
        renderJs, waitForJs, renderDelayMs,
      });
    }

    // ─── Auto mode: check domain profile cache first ──────────────────────
    else {
      const cachedProfile = getProfile(domain);

      if (cachedProfile) {
        // Use cached winning config (request params can override via spread)
        logger.info(`[auto:cached] Using cached profile for ${domain}: engine=${cachedProfile.engine}, renderDelayMs=${cachedProfile.render_delay_ms}`);
        incrementHitCount(domain);

        const effectiveEngine = cachedProfile.engine as "fast" | "browser" | "stealth" | "unblock";
        const cachedProxy = cachedProfile.use_proxy ? globalConfig.proxyUrl : '';
        
        if (effectiveEngine === "unblock") {
          result = await attemptUnblock(url);
        } else {
          result = await attemptFetch(url, effectiveEngine, {
            proxy: cachedProxy,
            headers,
            preset: (cachedProfile.preset as "chrome" | undefined) || preset,
            responseType,
            renderJs: cachedProfile.render_js,
            renderDelayMs: cachedProfile.render_delay_ms,
          });
        }
      } else {
        // ─── Auto-retry escalation ──────────────────────────────────────
        // FORCE fast mode if responseType is base64
        if (responseType === "base64") {
          logger.info(`[auto:base64] Forcing fast lane for binary: ${url}`);
          result = await attemptFetch(url, "fast", {
            proxy: targetProxy, headers, preset, responseType,
          });
        } else {
          // Try escalation chain
          result = null as any;
          let winningStep: EscalationStep | null = null;

          for (const step of getAvailableEscalationChain()) {
            logger.info(`[auto:escalate] Trying ${step.label} for ${url}`);
            try {
              let attempt: FetchResult;

              // Route 'unblock' to its own function (REST API, not WebSocket)
              if (step.engine === "unblock") {
                attempt = await attemptUnblock(url);
              } else {
                const stepProxy = step.useProxy ? globalConfig.proxyUrl : '';
                attempt = await attemptFetch(url, step.engine, {
                  proxy: stepProxy,
                  headers,
                  preset: step.engine !== "fast" ? (preset || "chrome") : preset,
                  responseType,
                  renderJs: step.renderJs,
                  renderDelayMs: step.renderDelayMs,
                });
              }

              if (isContentSufficient(attempt.content, attempt.statusCode)) {
                result = attempt;
                winningStep = step;
                logger.success(`[auto:escalate] ${step.label} succeeded for ${url} (${attempt.content.length} chars)`);
                break;
              } else {
                logger.warn(`[auto:escalate] ${step.label} content insufficient (${attempt.content.length} chars, status ${attempt.statusCode}), escalating...`);
              }
            } catch (e: any) {
              logger.warn(`[auto:escalate] ${step.label} failed: ${e.message}, escalating...`);
            }
          }

          // If all escalation steps failed, throw
          if (!result) {
            throw new Error(`All auto-retry escalation steps failed for ${url}`);
          }

          // Cache the winning config — but only if it's NOT the default (fast + proxy).
          // Most sites work with the default, so we only store exceptions.
          const isDefault = winningStep && winningStep.engine === "fast" && winningStep.useProxy === true;
          if (winningStep && !isDefault) {
            const profileInput: DomainProfileInput = {
              engine: winningStep.engine,
              renderJs: winningStep.renderJs,
              renderDelayMs: winningStep.renderDelayMs,
              useProxy: winningStep.useProxy,
              preset: winningStep.engine !== "fast" ? "chrome" : null,
              lastStatusCode: result.statusCode,
            };
            upsertProfile(domain, profileInput);
            logger.info(`[auto:cached] Saved winning profile for ${domain}: engine=${winningStep.engine}, proxy=${winningStep.useProxy}`);
          }
        }
      }
    }

    logger.success(`Fetched ${url} - Status: ${result.statusCode} (${result.engineUsed})`);

    // Handle Conversions
    const { content: finalContent, markdown: finalMarkdown } = processContentFormat(result.content, url, format);

    res.json({
      success: true,
      statusCode: result.statusCode,
      content: finalContent,
      markdown: finalMarkdown,
      headers: result.headers,
      url: result.url,
      engineUsed: result.engineUsed,
    });
  } catch (error: any) {
    logger.fail(`Fetch failed for ${url}: ${error.message}`);
    res.json({
      success: false,
      error: error.message,
    });
  }
}

async function handleAdvancedFetchRequest(req: Request, res: Response) {
    const request = req.body as AdvancedFetchRequest;
    const { format = "html" } = request;
    
    // Validate
    if (!request.url) {
        res.status(400).json({ error: "URL is required" });
        return;
    }

    try {
        logger.info(`Starting Advanced Crawl: ${request.url}`);
        const crawler = new AdvancedCrawler(globalConfig.browserlessUrl, request.proxy || globalConfig.proxyUrl, {
            stealth: globalConfig.browserStealth,
            headless: globalConfig.browserHeadless
        });

        const result = await crawler.fetch(request);
        logger.success(`Advanced Crawl Finished: ${request.url}`);

        // Handle Conversions
        const { content: finalContent, markdown: finalMarkdown } = processContentFormat(result.content, request.url, format);
        
        // Merge conversion results
        const finalResult = {
            ...result,
            content: finalContent,
            markdown: finalMarkdown
        };

        res.json({ success: true, ...finalResult });

    } catch (error: any) {
        logger.fail(`Advanced Crawl Failed: ${error.message}`);
        res.json({ success: false, error: error.message });
    }
}

app.post("/api/fetch/advanced", handleAdvancedFetchRequest);

// Update the main app route to use the extracted handler
app.post("/api/fetch", handleFetchRequest);

// =============================================================================
// Domain Profile API Routes
// =============================================================================

// List all cached domain profiles
app.get("/api/domain-profiles", (_req: Request, res: Response) => {
  try {
    const profiles = getAllProfiles();
    res.json({ success: true, profiles });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get profile for a specific domain
app.get("/api/domain-profiles/:domain", (req: Request, res: Response) => {
  try {
    const profile = getProfile(req.params.domain);
    if (!profile) {
      res.status(404).json({ success: false, error: "No profile found for this domain" });
      return;
    }
    res.json({ success: true, profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually set/update a domain profile
app.post("/api/domain-profiles", (req: Request, res: Response) => {
  try {
    const { domain, engine, renderJs, renderDelayMs, preset } = req.body;
    if (!domain || !engine) {
      res.status(400).json({ success: false, error: "domain and engine are required" });
      return;
    }
    const profile = upsertProfile(domain, {
      engine,
      renderJs: renderJs ?? false,
      renderDelayMs: renderDelayMs ?? 0,
      preset: preset ?? null,
    });
    logger.info(`Domain profile set manually: ${domain} → engine=${engine}`);
    res.json({ success: true, profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a domain profile
app.delete("/api/domain-profiles/:domain", (req: Request, res: Response) => {
  try {
    const deleted = deleteProfile(req.params.domain);
    if (!deleted) {
      res.status(404).json({ success: false, error: "No profile found for this domain" });
      return;
    }
    logger.info(`Domain profile deleted: ${req.params.domain}`);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

start().catch((err) => console.error("Startup failed", err));
