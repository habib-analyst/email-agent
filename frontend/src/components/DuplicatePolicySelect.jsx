import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export default function DuplicatePolicySelect({ className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Duplicate handling</p>
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3" /> Always active
        </span>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-[11px] dark:border-emerald-900/50 dark:bg-emerald-950/20">
        <span className="font-semibold text-emerald-800 dark:text-emerald-300">Permanent duplicate protection</span>
        <p className="mt-0.5 text-emerald-700/80 dark:text-emerald-400/80">
          Every send path checks permanent sent history immediately before Gmail sends. Previously contacted recipients cannot be sent again.
        </p>
      </div>
    </div>
  );
}
