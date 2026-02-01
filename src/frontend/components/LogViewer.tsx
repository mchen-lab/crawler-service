import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Log entry structure for the LogViewer.
 * Backend should send logs in this format via WebSocket.
 */
export interface LogEntry {
  timestamp: string;
  level: string;  // INFO, WARN, ERROR, DEBUG, or custom levels
  message: string;
}

interface LogViewerProps {
  /**
   * WebSocket endpoint path (default: /ws/logs)
   */
  wsPath?: string;
  /**
   * Title displayed in the header (default: backend/logs)
   */
  title?: string;
  /**
   * Custom height class (default: h-full)
   */
  height?: string;
  /**
   * API endpoint for clearing logs (optional, default: /api/logs)
   */
  clearEndpoint?: string;
}

/**
 * Generic LogViewer component that connects to a WebSocket endpoint
 * and displays real-time logs with auto-scroll functionality.
 * 
 * Backend should:
 * 1. Send { type: "history", data: LogEntry[] } on connection
 * 2. Send { type: "log", data: LogEntry } for each new log
 * 
 * Example backend setup:
 * ```typescript
 * const wss = new WebSocketServer({ server, path: "/ws/logs" });
 * wss.on("connection", (ws) => {
 *   ws.send(JSON.stringify({ type: "history", data: logs }));
 *   // Later: ws.send(JSON.stringify({ type: "log", data: newLog }));
 * });
 * ```
 */
export function LogViewer({ 
  wsPath = "/ws/logs", 
  title = "backend/logs",
  height = "h-full",
  clearEndpoint = "/api/logs"
}: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);

  useEffect(() => {
    let active = true;
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connectWebSocket = () => {
      // Guard: if effect is cleaned up, stop everything
      if (!active) return;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}${wsPath}`);
      
      ws.onopen = () => {
        if (active) setConnected(true);
      };

      ws.onmessage = (event) => {
        if (!active) return;
        const data = JSON.parse(event.data);
        if (data.type === "history") {
          setLogs(data.data);
        } else if (data.type === "log") {
          setLogs((prev) => {
            // De-duplicate: check if last log is identical
            const last = prev[prev.length - 1];
            if (last && last.message === data.data.message && last.timestamp === data.data.timestamp) {
              return prev;
            }
            return [...prev.slice(-499), data.data];
          });
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setConnected(false);
        // Only reconnect if this effect is still active
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
      };

      ws.onerror = () => {
        if (active) setConnected(false);
      };
    };
    
    connectWebSocket();
    
    return () => {
      active = false;
      if (ws) {
        ws.close();
        ws = null;
      }
      clearTimeout(reconnectTimeout);
    };
  }, [wsPath]);

  // Auto-scroll when new logs arrive and autoScroll is enabled
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current && !isUserScrolling.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect user scrolling to auto-pause/resume following
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    // Check if user scrolled away from bottom
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    
    if (!isAtBottom && autoScroll) {
      // User scrolled up, pause auto-scroll
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      // User scrolled back to bottom, resume auto-scroll
      setAutoScroll(true);
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    setAutoScroll(true);
  };

  const clearLogs = async () => {
    await fetch(clearEndpoint, { method: "DELETE" });
    setLogs([]);
  };

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
  };

  const getLevelStyle = (level: string) => {
    const normalized = level.toUpperCase();
    switch (normalized) {
      case "ERROR":
      case "CRITICAL":
        return "bg-red-500/10 text-red-400";
      case "WARN":
      case "WARNING":
        return "bg-yellow-500/10 text-yellow-400";
      case "DEBUG":
      case "TRACE":
        return "bg-purple-500/10 text-purple-400";
      case "GOST":
      case "PROXY":
        return "bg-blue-500/10 text-blue-400";
      case "SUCCESS":
        return "bg-emerald-500/10 text-emerald-400";
      default:
        return "bg-slate-500/10 text-slate-400";
    }
  };

  const renderLevelLabel = (level: string) => {
    const normalized = level.toUpperCase();
    if (normalized === "INFO") return "APP";
    return normalized;
  };

  return (
    <Card className={`${height} flex flex-col border-0 shadow-lg bg-slate-900 overflow-hidden`}>
      <CardHeader className="flex flex-row items-center justify-between py-3 px-5 border-b border-slate-800 bg-slate-950/50">
        <div className="flex items-center gap-3">
          {/* Terminal-style dots */}
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/50" />
          </div>
          <CardTitle className="text-sm font-mono text-slate-400 font-normal ml-2">{title}</CardTitle>
        </div>
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-500" : "text-red-500"}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            {connected ? "Live" : "Disconnected"}
          </div>
          <div className="h-4 w-px bg-slate-800" />
          <Button 
            variant="ghost" 
            size="sm" 
            className={`h-7 text-xs cursor-pointer ${autoScroll ? "text-blue-400 bg-blue-400/10 hover:bg-blue-400/20 hover:text-blue-300" : "text-slate-500 hover:text-slate-400"}`}
            onClick={scrollToBottom}
          >
            {autoScroll ? "Following" : "Scroll to Bottom"}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearLogs} className="h-7 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-800 cursor-pointer">Clear</Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0 bg-slate-900 relative">
        <div 
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900"
        >
          <div className="p-4 font-mono text-xs space-y-0.5 leading-relaxed">
            {logs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-2 py-20">
                <div className="w-12 h-1 bg-slate-800 animate-pulse rounded" />
                <p>Waiting for logs...</p>
              </div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="flex gap-3 px-1 py-0.5 hover:bg-white/5 rounded-sm transition-colors cursor-default group">
                  <span className="text-slate-600 shrink-0 select-none w-20 text-right">{formatTime(log.timestamp)}</span>
                  <span className={`shrink-0 font-bold w-12 text-center text-[10px] rounded px-1 self-start mt-0.5 ${getLevelStyle(log.level)}`}>
                    {renderLevelLabel(log.level)}
                  </span>
                  <span className="text-slate-300 break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
