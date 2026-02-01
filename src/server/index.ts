import { createApp } from "@mchen-lab/app-kit/backend";
import { createServer } from "http";
import express, { type Request, type Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Define your config schema
interface AppConfig {
  // Add your config properties here
  exampleSetting: string;
}

// Default config values
const defaultConfig: AppConfig = {
  exampleSetting: "default-value",
};

// Initialize AppKit
const appKit = createApp({
  appName: "Crawler Service",
  defaultConfig: defaultConfig,
  disableStatic: true, // We serve our own static files
});

const app = appKit.app;

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
// Logging Infrastructure (Real-time WebSocket logs)
// =============================================================================

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const logs: LogEntry[] = [];
const MAX_LOGS = 500;
const wsClients: Set<WebSocket> = new Set();

/**
 * Add a log entry and broadcast to all connected WebSocket clients.
 * Use this throughout your application for real-time log visibility.
 */
function addLog(level: string, message: string) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
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

  // Persistent logging
  try {
    const logLine = `[${entry.timestamp}] [${entry.level}] ${entry.message}\n`;
    fs.appendFileSync(LOG_FILE_PATH, logLine);
  } catch (err) {
    // Silently continue
  }
}

// Log helper functions
export const logger = {
  info: (msg: string) => addLog("INFO", msg),
  warn: (msg: string) => addLog("WARN", msg),
  error: (msg: string) => addLog("ERROR", msg),
  debug: (msg: string) => addLog("DEBUG", msg),
};

// =============================================================================
// API Routes
// =============================================================================

// Status API
app.get("/api/status", (_req: Request, res: Response) => {
  const uptime = (Date.now() - startTime) / 1000;
  res.json({
    status: "online",
    uptime: uptime,
    timestamp: new Date().toISOString(),
    port: Number(PORT),
  });
});

// Version API
app.get("/api/version", (_req: Request, res: Response) => {
  res.json({
    version: VERSION,
    commit: GIT_COMMIT,
  });
});

// Logs API (REST endpoints for log management)
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

// Get log file content
app.get("/api/logs/file", async (_req: Request, res: Response) => {
  try {
    if (fs.existsSync(LOG_FILE_PATH)) {
      const content = fs.readFileSync(LOG_FILE_PATH, "utf-8");
      res.type("text/plain").send(content);
    } else {
      res.status(404).json({ error: "Log file not found" });
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to read log file" });
  }
});

// Example: Access config
app.get("/api/config-example", (_req: Request, res: Response) => {
  const config = appKit.config as AppConfig;
  res.json({ exampleSetting: config.exampleSetting });
});

// Example: Update config
app.post("/api/config-example", async (req: Request, res: Response) => {
  try {
    await appKit.updateConfig({ exampleSetting: req.body.exampleSetting });
    logger.info(`Config updated: exampleSetting = ${req.body.exampleSetting}`);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Failed to update config: ${error}`);
    res.status(500).json({ error: "Failed to update config" });
  }
});

// =============================================================================
// Server Startup & Frontend Integration
// =============================================================================

async function start() {
  await appKit.initialize();

  const server = createServer(app);

  // ==========================================================================
  // WebSocket server for real-time logs
  // Frontend LogViewer component connects to /ws/logs
  // ==========================================================================
  const wss = new WebSocketServer({ server, path: "/ws/logs" });
  wss.on("connection", (ws: WebSocket) => {
    wsClients.add(ws);
    // Send log history on connect
    ws.send(JSON.stringify({ type: "history", data: logs }));
    ws.on("close", () => wsClients.delete(ws));
  });

  // Frontend Serving Logic
  if (isProduction) {
    // Production: Serve built static files
    const distPath = path.join(__dirname, "../../dist");
    app.use(express.static(distPath));

    // SPA fallback
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    // Development: Use Vite middleware
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

      // Use Vite middleware for all routes except API
      app.use((req, res, next) => {
        if (req.path.startsWith("/api")) {
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
      console.error(`❌ Port ${PORT} is already in use. Please check for zombie processes.`);
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
