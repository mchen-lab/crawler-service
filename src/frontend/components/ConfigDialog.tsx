import React, { useState, useEffect } from "react";
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
import { Switch } from "./ui/switch";
import { Settings } from "lucide-react";
import { toast } from "sonner";

interface ConfigDialogProps {
  trigger?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ConfigDialog({ trigger, isOpen, onOpenChange }: ConfigDialogProps) {
  const [browserlessUrl, setBrowserlessUrl] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [browserStealth, setBrowserStealth] = useState(true);
  const [browserHeadless, setBrowserHeadless] = useState(true);
  const [loading, setLoading] = useState(false);

  // Load config when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchConfig();
    }
  }, [isOpen]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setBrowserlessUrl(data.browserlessUrl || "");
        setProxyUrl(data.proxyUrl || "");
        setBrowserStealth(data.browserStealth ?? true);
        setBrowserHeadless(data.browserHeadless ?? true);
      }
    } catch (e) {
      toast.error("Failed to load config");
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          browserlessUrl, 
          proxyUrl,
          browserStealth,
          browserHeadless
        }),
      });
      
      if (res.ok) {
        toast.success("Configuration saved");
        onOpenChange?.(false);
      } else {
        throw new Error("Failed to save");
      }
    } catch (e) {
      toast.error("Failed to save configuration");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Configuration</DialogTitle>
          <DialogDescription>
            Update crawler service settings and anti-bot features.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="grid gap-2">
            <Label htmlFor="browserless-url">Browserless URL</Label>
            <Input
              id="browserless-url"
              value={browserlessUrl}
              onChange={(e) => setBrowserlessUrl(e.target.value)}
              placeholder="ws://localhost:3000"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="proxy-url">Proxy URL</Label>
            <Input
              id="proxy-url"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
              placeholder="http://proxy:8080"
            />
          </div>
          
          <div className="flex flex-col gap-4 border p-4 rounded-md bg-muted/20">
             <h4 className="font-medium text-sm text-muted-foreground mb-2">Anti-Bot Features</h4>
             
             <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="stealth-mode" className="text-base">Stealth Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Masks automation signals to avoid detection.
                  </p>
                </div>
                <Switch 
                  id="stealth-mode" 
                  checked={browserStealth} 
                  onCheckedChange={setBrowserStealth} 
                />
             </div>

             <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="headless-mode" className="text-base">Headless Mode</Label>
                  <p className="text-xs text-muted-foreground">
                    Run browser without UI. Turn off if getting blocked.
                  </p>
                </div>
                <Switch 
                  id="headless-mode" 
                  checked={browserHeadless} 
                  onCheckedChange={setBrowserHeadless} 
                />
             </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="submit" onClick={saveConfig} disabled={loading}>
            {loading ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
