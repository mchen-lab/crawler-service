import React, { useEffect, useState } from "react";
import { useAppKit } from "@mchen-lab/app-kit/frontend";
import logoImage from "./logo.png";
import { Layout } from "./components/Layout";
import { LogViewer } from "./components/LogViewer";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import { Send, CheckCircle2, XCircle } from "lucide-react";
import { TestDialog } from "./components/TestDialog";

interface SystemStatus {
  status: string;
  activeRequests: number;
  browserConnected: boolean;
  uptime: number;
}

function App() {
  const { version } = useAppKit();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    fetchStatus();
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

  return (
    <Layout
      logo={logoImage}
      statusBadges={
        status?.browserConnected ? (
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200 hover:bg-green-500/20">
            <CheckCircle2 className="h-3 w-3 mr-1.5" />
            Browserless
          </Badge>
        ) : (
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200 hover:bg-red-500/20">
            <XCircle className="h-3 w-3 mr-1.5" />
            Browserless
          </Badge>
        )
      }
    >
      {/* Button Bar */}
      <div className="flex items-center gap-4 mb-4">
        <Button onClick={() => setTestOpen(true)}>
          <Send className="h-4 w-4 mr-2" />
          Test Fetch
        </Button>
      </div>

      {/* Main Content - Log Viewer */}
      <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-background shadow-sm">
        <LogViewer />
      </div>

      {/* Dialogs */}
      <TestDialog open={testOpen} onOpenChange={setTestOpen} />
    </Layout>
  );
}

export default App;

