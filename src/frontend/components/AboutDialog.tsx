import React from 'react';

interface AboutDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  appName: string;
  version?: string;
  commit?: string;
  repoUrl?: string;
  description?: string;
}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onOpenChange,
  appName,
  version,
  commit,
  repoUrl,
  description
}) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b flex items-center justify-between bg-slate-50">
          <h2 className="text-lg font-semibold text-slate-900">About {appName}</h2>
          <button 
            onClick={() => onOpenChange(false)}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="space-y-1">
            <p className="text-sm text-slate-500 uppercase tracking-wider font-medium">Description</p>
            <p className="text-slate-700">{description || `Professional application powered by @mchen-lab/app-kit.`}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="space-y-1">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Version</p>
              <p className="text-sm font-mono bg-slate-100 px-2 py-0.5 rounded inline-block">v{version || '0.1.0'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Commit</p>
              <p className="text-sm font-mono bg-slate-100 px-2 py-0.5 rounded inline-block">{commit?.substring(0, 7) || 'unknown'}</p>
            </div>
          </div>

          {repoUrl && (
            <div className="pt-2">
              <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Repository</p>
              <a 
                href={repoUrl} 
                target="_blank" 
                rel="noreferrer"
                className="text-sm text-blue-600 hover:text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                {repoUrl.replace(/^https?:\/\//, '')}
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t flex justify-end">
          <button 
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
