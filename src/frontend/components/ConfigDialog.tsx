import { useState, useEffect, ReactNode } from "react";
import { useAppKit } from "@mchen-lab/app-kit/frontend";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings } from "lucide-react";
import { toast } from "sonner";

/**
 * Tab configuration for ConfigDialog
 */
export interface ConfigTab {
  /** Unique identifier for the tab */
  id: string;
  /** Display label for the tab */
  label: string;
  /** Content to render in the tab panel */
  content: ReactNode;
}

interface ConfigDialogProps {
  /**
   * Array of tab configurations to render.
   * If not provided, shows a default placeholder.
   */
  tabs?: ConfigTab[];
  /**
   * Callback when save button is clicked.
   * Should return a Promise that resolves on success.
   */
  onSave?: () => Promise<void>;
  /**
   * Callback after dialog closes (after successful save)
   */
  onConfigUpdate?: () => void;
  /**
   * Dialog title (default: "Configuration")
   */
  title?: string;
  /**
   * Trigger button variant
   */
  triggerVariant?: "icon" | "button";
  /**
   * Custom trigger element (overrides triggerVariant)
   */
  trigger?: ReactNode;
}

/**
 * Enhanced ConfigDialog with Radix UI Dialog and Tabs support.
 * 
 * Example usage with tabs:
 * ```tsx
 * <ConfigDialog
 *   tabs={[
 *     { id: "general", label: "General", content: <GeneralSettings /> },
 *     { id: "advanced", label: "Advanced", content: <AdvancedSettings /> },
 *   ]}
 *   onSave={async () => {
 *     await fetch("/api/settings", { method: "POST", body: JSON.stringify(settings) });
 *   }}
 * />
 * ```
 */
export function ConfigDialog({ 
  tabs,
  onSave,
  onConfigUpdate,
  title = "Configuration",
  triggerVariant = "icon",
  trigger
}: ConfigDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { version, refreshSettings } = useAppKit();

  const handleSave = async () => {
    if (!onSave) {
      setOpen(false);
      return;
    }

    setLoading(true);
    try {
      await onSave();
      toast.success("Configuration saved successfully");
      setOpen(false);
      refreshSettings();
      if (onConfigUpdate) onConfigUpdate();
    } catch (error) {
      console.error("Failed to save:", error);
      toast.error("Failed to save configuration");
    } finally {
      setLoading(false);
    }
  };

  // Default trigger button
  const defaultTrigger = triggerVariant === "icon" ? (
    <Button 
      variant="ghost" 
      size="icon" 
      className="h-9 w-9 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full" 
      title={title}
    >
      <Settings className="h-5 w-5" />
    </Button>
  ) : (
    <Button variant="secondary">
      <Settings className="h-4 w-4 mr-2" />
      {title}
    </Button>
  );

  // Default placeholder content
  const defaultContent = (
    <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-600">
      <p>This is a placeholder for your application configuration.</p>
      <p className="mt-2">Provide the <code className="bg-slate-100 px-1 rounded">tabs</code> prop to add configuration sections.</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] h-[500px] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        
        {tabs && tabs.length > 0 ? (
          <Tabs defaultValue={tabs[0].id} className="flex-1 w-full flex flex-col min-h-0">
            <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
              ))}
            </TabsList>
            
            <div className="flex-1 min-h-0 relative">
              {tabs.map((tab) => (
                <TabsContent 
                  key={tab.id} 
                  value={tab.id} 
                  className="absolute inset-0 overflow-y-auto py-4"
                >
                  {tab.content}
                </TabsContent>
              ))}
            </div>
          </Tabs>
        ) : (
          <div className="flex-1 overflow-y-auto py-4">
            {defaultContent}
          </div>
        )}

        <DialogFooter className="mt-4 gap-2">
          <DialogClose asChild>
            <Button variant="outline" className="cursor-pointer">
              Cancel
            </Button>
          </DialogClose>
          <Button 
            type="submit" 
            onClick={handleSave} 
            disabled={loading} 
            className="bg-slate-900 text-white"
          >
            {loading ? "Saving..." : "Save Configuration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
