import { createApp } from "@mchen-lab/app-kit/backend";
import { createServer } from "http";
import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import { FastCrawler, BrowserCrawler, type FetchResult } from "./crawlerClients.js";
import { AdvancedCrawler, type AdvancedFetchRequest } from "./advancedOptions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Config Types
// =============================================================================

interface GlobalConfig {
  browserlessUrl: string;
  proxyUrl: string;
  defaultEngine: "auto" | "fast" | "browser";
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
  
  res.json({
    status: "operational",
    activeRequests: 0,
    browserConnected,
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

interface FetchRequest {
  url: string;
  engine?: "auto" | "fast" | "browser";
  renderJs?: boolean;
  proxy?: string;
  headers?: Record<string, string>;
  preset?: "chrome";
}

app.post("/api/fetch", async (req: Request, res: Response) => {
  const { url, engine = "auto", renderJs = false, proxy } = req.body as FetchRequest;

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  const targetProxy = proxy || globalConfig.proxyUrl;

  // Determine which engine to use
  let useBrowser = false;
  if (engine === "browser") {
    useBrowser = true;
  } else if (engine === "fast") {
    useBrowser = false;
  } else if (renderJs) {
    useBrowser = true;
  } else {
    // Auto mode: default to fast
    useBrowser = false;
  }

  try {
    let result: FetchResult;

    if (useBrowser) {
      logger.info(`Routing to Browser Lane: ${url}`);
      const crawler = new BrowserCrawler(globalConfig.browserlessUrl, targetProxy);
      result = await crawler.fetch(url);
    } else {
      logger.info(`Routing to Fast Lane: ${url}`);
      const crawler = new FastCrawler(targetProxy);
      result = await crawler.fetch(url);
    }

    logger.success(`Fetched ${url} - Status: ${result.statusCode} (${result.engineUsed})`);

    res.json({
      success: true,
      statusCode: result.statusCode,
      content: result.content,
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
});

// =============================================================================


async function start() {
  await appKit.initialize();
  globalConfig = appKit.config as GlobalConfig;

  // ---------------------------------------------------------------------------
  // Main Server (UI + API) - Port 31170
  // ---------------------------------------------------------------------------
  const mainPort = 31170;
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
  const crawlerApiPort = 31171;
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

  // Health check for crawler service
  crawlerApp.get("/health", (_req, res) => res.json({ status: "ok", type: "crawler-api" }));

  crawlerApp.listen(crawlerApiPort, "0.0.0.0", () => {
    console.log(`🕷️ Crawler API Server running on http://localhost:${crawlerApiPort}`);
    logger.info(`Crawler API Server started on port ${crawlerApiPort}`);
  });
}

// Markdown Utility
import { htmlToMarkdown, extractMainContent } from "./markdown.js";

// ...

interface FetchRequest {
  url: string;
  engine?: "auto" | "fast" | "browser";
  renderJs?: boolean;
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

async function handleFetchRequest(req: Request, res: Response) {
  const { url, engine = "auto", renderJs = false, proxy, headers, preset, format = "html", responseType = "text" } = req.body as FetchRequest;

  if (!url) {
    res.status(400).json({ error: "URL is required" });
    return;
  }

  const targetProxy = proxy || globalConfig.proxyUrl;

  // Determine which engine to use
  let useBrowser = false;
  if (engine === "browser") {
    useBrowser = true;
  } else if (engine === "fast") {
    useBrowser = false;
  } else if (renderJs) {
    useBrowser = true;
  } else {
    // Auto mode: default to fast
    useBrowser = false;
  }

  // FORCE fast mode if responseType is base64 (browser mode doesn't support binary efficienty yet)
  if (responseType === "base64" && useBrowser) {
    logger.warn(`base64 requested but engine was browser. Switching to fast engine for binary support.`);
    useBrowser = false;
  }

  try {
    let result: FetchResult;

    if (useBrowser) {
      logger.info(`Routing to Browser Lane: ${url} (preset: ${preset || "none"})`);
      const crawler = new BrowserCrawler(globalConfig.browserlessUrl, targetProxy);
      result = await crawler.fetch(url, headers, preset, responseType);
    } else {
      logger.info(`Routing to Fast Lane: ${url} (preset: ${preset || "none"})`);
      const crawler = new FastCrawler(targetProxy);
      result = await crawler.fetch(url, headers, preset, responseType);
    }

    logger.success(`Fetched ${url} - Status: ${result.statusCode} (${result.engineUsed})`);

    // Handle Conversions
    const { content: finalContent, markdown: finalMarkdown } = processContentFormat(result.content, url, format);

    res.json({
      success: true,
      statusCode: result.statusCode,
      content: finalContent,     // HTML (Raw or Stripped)
      markdown: finalMarkdown,   // Markdown if requested
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

start().catch((err) => console.error("Startup failed", err));


