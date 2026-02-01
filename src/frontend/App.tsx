import React, { useEffect, useState } from "react";
import { useAppKit } from "@mchen-lab/app-kit/frontend";
import { Layout } from "./components/Layout";
import { StatusCard } from "./components/StatusCard";
import { LogViewer } from "./components/LogViewer";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Activity, Globe, Send, Terminal, Settings, RefreshCw, CheckCircle2, XCircle, Shield } from "lucide-react";

interface SystemStatus {
  status: string;
  activeRequests: number;
  browserConnected: boolean;
  uptime: number;
}

interface SystemConfig {
  browserlessUrl: string;
  proxyUrl: string;
  defaultEngine: string;
}

interface FetchResult {
  success: boolean;
  statusCode?: number;
  content?: string;
  headers?: Record<string, string>;
  url?: string;
  engineUsed?: string;
  error?: string;
}

function App() {
  const { version, loading } = useAppKit();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [testUrl, setTestUrl] = useState("https://httpbin.org/ip");
  const [testEngine, setTestEngine] = useState<"fast" | "browser">("fast");
  const [testResult, setTestResult] = useState<FetchResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  useEffect(() => {
    fetchStatus();
    fetchConfig();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error("Failed to fetch status", e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      if (res.ok) setConfig(await res.json());
    } catch (e) {
      console.error("Failed to fetch config", e);
    }
  };

  const runTest = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: testUrl, engine: testEngine }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (e) {
      setTestResult({ success: false, error: String(e) });
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <Layout>
      {/* Header Status */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Crawler Service</h1>
        </div>
        <div className="flex items-center gap-4">
          {status?.browserConnected ? (
            <Badge variant="default" className="bg-green-600">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Browser Connected
            </Badge>
          ) : (
            <Badge variant="destructive">
              <XCircle className="h-3 w-3 mr-1" /> Browser Disconnected
            </Badge>
          )}
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-6">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="dashboard">
            <Activity className="h-4 w-4 mr-2" /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="test">
            <Send className="h-4 w-4 mr-2" /> Test
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Terminal className="h-4 w-4 mr-2" /> Logs
          </TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="h-4 w-4 mr-2" /> Config
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">System Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-primary/10 rounded-full">
                    <Activity className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold capitalize">{status?.status || "Unknown"}</p>
                    <p className="text-sm text-muted-foreground">
                      Uptime: {status?.uptime ? Math.floor(status.uptime) + "s" : "..."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Proxy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-500/10 rounded-full">
                    <Shield className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">Active</p>
                    <p className="text-sm text-muted-foreground truncate max-w-[150px]">
                      {config?.proxyUrl || "Not configured"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Version</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-emerald-500/10 rounded-full">
                    <Globe className="h-6 w-6 text-emerald-500" />
                  </div>
                  <div>
                    <p className="text-lg font-bold">{version?.version || "..."}</p>
                    <p className="text-sm text-muted-foreground font-mono">
                      {version?.commit?.substring(0, 7) || "..."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Test Fetch Tab */}
        <TabsContent value="test">
          <Card>
            <CardHeader>
              <CardTitle>Test URL Fetch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex gap-4 flex-wrap">
                <Input
                  value={testUrl}
                  onChange={(e) => setTestUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 min-w-[300px]"
                />
                <div className="flex items-center gap-2 border rounded-md p-1 bg-muted/50">
                  <Button
                    variant={testEngine === "fast" ? "default" : "ghost"}
                    onClick={() => setTestEngine("fast")}
                    size="sm"
                  >
                    Fast Lane
                  </Button>
                  <Button
                    variant={testEngine === "browser" ? "default" : "ghost"}
                    onClick={() => setTestEngine("browser")}
                    size="sm"
                  >
                    Browser
                  </Button>
                </div>
                <Button onClick={runTest} disabled={testLoading}>
                  {testLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Fetch"}
                </Button>
              </div>

              {testResult && (
                <div className="bg-muted rounded-lg p-4 font-mono text-sm overflow-auto max-h-[500px]">
                  <pre>{JSON.stringify(testResult, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <LogViewer />
        </TabsContent>

        {/* Config Tab */}
        <TabsContent value="config">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Browserless URL</label>
                  <p className="font-mono text-sm mt-1">{config?.browserlessUrl || "..."}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Proxy URL</label>
                  <p className="font-mono text-sm mt-1">{config?.proxyUrl || "..."}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Default Engine</label>
                  <p className="font-mono text-sm mt-1">{config?.defaultEngine || "auto"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}

export default App;

