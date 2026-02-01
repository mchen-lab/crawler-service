import React from 'react';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';

interface StatusCardProps {
  port: string;
  items?: { label: string; value: string | number }[];
}

export function StatusCard({ port, items = [] }: StatusCardProps) {
  return (
    <Card className="flex flex-col border-0 shadow-sm bg-white overflow-hidden">
      <CardContent className="p-5">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div className="flex flex-col gap-1 min-w-[100px]">
            <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">Port</span>
            <span className="font-mono text-sm font-medium text-slate-900">{port}</span>
          </div>

          {items.map((item, i) => (
            <div key={i} className="flex flex-col gap-1 min-w-[100px]">
              <span className="text-[10px] uppercase text-slate-400 font-bold tracking-wider">{item.label}</span>
              <span className="font-mono text-sm font-medium text-slate-900">{item.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
