import { createApp } from "@mchen-lab/app-kit/backend";
import { createServer } from "http";
import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import { FastCrawler, BrowserCrawler, type FetchResult } from "./crawlerClients.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Config Types
// =============================================================================

interface GlobalConfig {
  browserlessUrl: string;
  proxyUrl: string;
  defaultEngine: "auto" | "fast" | "browser";
}

const defaultConfig: GlobalConfig = {
  browserlessUrl: process.env.BROWSERLESS_URL || "ws://localhost:3000",
  proxyUrl: process.env.PROXY_URL || "http://localhost:31131",
  defaultEngine: "auto",
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
app.get("/api/status", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    activeRequests: 0,
    browserConnected: true, // TODO: Actually check browserless connection
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
  });
});

// Config API - Update configuration
app.post("/api/config", async (req: Request, res: Response) => {
  try {
    const { browserlessUrl, proxyUrl, defaultEngine } = req.body;
    
    if (browserlessUrl) globalConfig.browserlessUrl = browserlessUrl;
    if (proxyUrl) globalConfig.proxyUrl = proxyUrl;
    if (defaultEngine) globalConfig.defaultEngine = defaultEngine;
    
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
// Server Startup & Frontend Integration
// =============================================================================

async function start() {
  await appKit.initialize();
  globalConfig = appKit.config as GlobalConfig;

  const server = createServer(app);

  // WebSocket server for real-time logs
  const wss = new WebSocketServer({ server, path: "/ws/logs" });
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
          hmr: { server }
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

  server.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.error(`❌ Port ${PORT} is already in use.`);
    } else {
      console.error(`❌ Server error: ${err.message}`);
    }
  });

  server.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`🚀 Crawler Service running on http://localhost:${PORT}`);
    logger.info("Server started successfully");
  });
}

start().catch((err) => console.error("Startup failed", err));

