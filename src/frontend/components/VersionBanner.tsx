import React from 'react';

interface VersionBannerProps {
  version?: string;
  commit?: string;
  appName?: string;
}

export const VersionBanner: React.FC<VersionBannerProps> = ({ version, commit, appName }) => {
  return (
    <div className="flex flex-col items-start gap-1 p-2 text-[10px] text-slate-500 opacity-70 hover:opacity-100 transition-opacity">
      {appName && <div className="font-semibold uppercase tracking-wider">{appName}</div>}
      <div className="flex items-center gap-2">
        <span>v{version || '0.0.0'}</span>
        {commit && (
          <>
            <span className="w-1 h-1 rounded-full bg-slate-200" />
            <code className="bg-slate-100 px-1 rounded">{commit.substring(0, 7)}</code>
          </>
        )}
      </div>
    </div>
  );
};
