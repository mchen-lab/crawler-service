import React, { ReactNode } from 'react';
import { Button } from './ui/button';
import { Info, Settings } from 'lucide-react';
import { AboutDialog } from './AboutDialog';
import { ConfigDialog } from './ConfigDialog';
import { useAppKit } from '@mchen-lab/app-kit/frontend';

interface LayoutProps {
  children: ReactNode;
  title?: string;
  logo?: string;              // Optional logo image path - falls back to first letter if not provided
  statusBadges?: ReactNode;   // Slot for status badges (displayed after title)
  actionButtons?: ReactNode;  // Slot for action buttons (displayed before Settings/About)
}

export function Layout({ 
  children, 
  title = "Crawler Service",
  logo,
  statusBadges,
  actionButtons
}: LayoutProps) {
  const { version } = useAppKit();
  const [showAbout, setShowAbout] = React.useState(false);
  const [showConfig, setShowConfig] = React.useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Left side: Logo, Title, Status Badges */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              {logo ? (
                <img 
                  src={logo} 
                  alt={title} 
                  className="h-8 w-8 rounded-lg shadow-sm"
                />
              ) : (
                <div className="h-8 w-8 bg-slate-900 rounded-lg flex items-center justify-center shadow-sm">
                  <span className="text-white font-bold text-lg select-none">
                    {title.charAt(0)}
                  </span>
                </div>
              )}
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 hidden sm:block">
                {title}
              </h1>
            </div>

            {/* Status badges slot with divider */}
            {statusBadges && (
              <>
                <div className="h-6 w-px bg-slate-200" />
                <div className="flex items-center gap-2">
                  {statusBadges}
                </div>
              </>
            )}
          </div>

          {/* Right side: Action Buttons, Settings, About */}
          <div className="flex items-center gap-6">
            {/* Action buttons slot */}
            {actionButtons && (
              <div className="flex items-center gap-2">
                {actionButtons}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowConfig(true)}
                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full"
                title="Configuration"
              >
                <Settings className="h-5 w-5" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setShowAbout(true)}
                className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-full"
                title="About"
              >
                <Info className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6">
        <div className="flex flex-col gap-6">
          {children}
        </div>
      </main>

      <AboutDialog 
        isOpen={showAbout}
        onOpenChange={setShowAbout}
        appName={title}
        version={version?.version}
        commit={version?.commit}
      />
      
      <ConfigDialog 
        isOpen={showConfig}
        onOpenChange={setShowConfig}
      />
    </div>
  );
}
