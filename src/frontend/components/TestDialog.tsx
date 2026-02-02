import React, { useState } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RefreshCw } from "lucide-react";

interface TestDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

export function TestDialog({ trigger, open, onOpenChange }: TestDialogProps) {
  const [testUrl, setTestUrl] = useState("https://httpbin.org/ip");
  const [testEngine, setTestEngine] = useState<"fast" | "browser">("fast");
  const [testResult, setTestResult] = useState<FetchResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Test URL Fetch</DialogTitle>
          <DialogDescription>
            Test the crawler with different engines.
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid gap-4 py-4">
          <div className="flex gap-4">
            <Input
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1"
            />
          </div>
          
          <div className="flex items-center gap-4">
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
            
            <Button onClick={runTest} disabled={testLoading} className="ml-auto min-w-[100px]">
              {testLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Fetch"}
            </Button>
          </div>

          {testResult && (
            <div className="mt-4 flex-1 min-h-[300px] overflow-auto border rounded-md bg-muted/50 p-4">
              <div className="flex justify-between items-center mb-2">
                <span className={`text-sm font-bold ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                  {testResult.success ? "Success" : "Failed"} 
                  {testResult.statusCode ? ` (${testResult.statusCode})` : ""}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {testResult.engineUsed}
                </span>
              </div>
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
