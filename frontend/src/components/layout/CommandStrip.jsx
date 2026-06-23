import React from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

export default function CommandStrip({ children }) {
  return (
    <details className="group rounded-2xl border border-[rgb(var(--border-subtle))] bg-[rgb(var(--surface-card))] shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="inline-flex items-center gap-2 text-xs font-bold text-[rgb(var(--text-primary))]">
          <SlidersHorizontal className="h-4 w-4 text-brand-500" />
          Your controls
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted">
          Open controls <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-[rgb(var(--border-subtle))] p-4">{children}</div>
    </details>
  );
}
